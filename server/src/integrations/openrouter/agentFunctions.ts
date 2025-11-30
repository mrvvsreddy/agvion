// path: integrations/openrouter/agentFunctions.ts
import { ExecutionContext } from '../../types/context';
import { IntegrationFunction } from '../../types/integrations';
import logger from '../../utils/logger';
import 'dotenv/config';  

interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'function';
  readonly content: string;
  readonly name?: string;
}

interface ToolDescription {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: string;
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

interface AgentConfig {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolDescription[];
  readonly apiKey?: string; // per-call api key override
  readonly fallbackModel?: string; // free tier fallback
  readonly skipFallback?: boolean; // force specific model
  readonly messages?: readonly {
    readonly role: 'system' | 'user' | 'assistant' | 'function';
    readonly content: string;
    readonly toolCalls?: readonly {
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }[];
    readonly toolCallId?: string;
  }[];
  readonly toolChoice?: 'auto' | 'required' | 'none';
}

interface OpenRouterFunctionCall {
  readonly name: string;
  readonly arguments: string;
}

interface OpenRouterChoice {
  readonly message: {
    readonly content: string | null;
    readonly function_call?: OpenRouterFunctionCall;
    readonly tool_calls?: readonly {
      readonly id: string;
      readonly type: 'function';
      readonly function: OpenRouterFunctionCall;
    }[];
  };
  readonly finish_reason: string;
}

interface OpenRouterUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
}

interface OpenRouterResponse {
  readonly choices: readonly OpenRouterChoice[];
  readonly usage?: OpenRouterUsage;
  readonly model?: string; // actual model used (may differ from requested)
}

interface OpenRouterErrorDetail {
  readonly code: string;
  readonly message: string;
  readonly type?: string;
}

interface OpenRouterError {
  readonly error: OpenRouterErrorDetail;
}

interface ModelCapability {
  readonly supportsTools: boolean;
  readonly maxTokens: number;
  readonly costPer1kTokens: number;
  readonly isFree: boolean;
}

// OpenRouter model capabilities registry
const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'openai/gpt-3.5-turbo': {
    supportsTools: true,
    maxTokens: 16385,
    costPer1kTokens: 0.0005,
    isFree: true
  },
  'qwen/qwen3-235b-a22b:free': {
    supportsTools: true,
    maxTokens: 131072,
    costPer1kTokens: 0,
    isFree: true
  },
  'deepseek/deepseek-chat-v3.1:free': {
    supportsTools: true,
    maxTokens: 131072,
    costPer1kTokens: 0,
    isFree: true
  },
  'qwen/qwen3-coder:free': {
    supportsTools: false,
    maxTokens: 131072,
    costPer1kTokens: 0,
    isFree: true
  }
} as const;

interface GenerationResult {
  readonly content: string;
  readonly toolCalls: readonly ToolCall[];
  readonly modelUsed: string;
  readonly tokensUsed: number;
  readonly executionTime: number;
  readonly isFallback: boolean;
}

interface ToolCall {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly reasoning: string;
}

interface GenerationError extends Error {
  readonly code?: string;
  readonly type?: string;
  readonly modelAttempted: string;
  readonly isFallback: boolean;
}

// Base payload type for OpenRouter requests
interface BaseOpenRouterPayload {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly max_tokens: number;
  readonly temperature: number;
  readonly top_p: 1;
  readonly frequency_penalty: 0;
  readonly presence_penalty: 0;
}

// Extended payload with function calling capabilities
interface FunctionCallingPayload extends BaseOpenRouterPayload {
  readonly functions: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: string;
      readonly properties: Record<string, unknown>;
      readonly required?: readonly string[];
    };
  }[];
  readonly function_call: 'auto';
}

// Extended payload with tool calling capabilities
interface ToolCallingPayload extends BaseOpenRouterPayload {
  readonly tools: readonly {
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly description: string;
      readonly parameters: {
        readonly type: string;
        readonly properties: Record<string, unknown>;
        readonly required?: readonly string[];
      };
    };
  }[];
  readonly tool_choice: 'auto' | 'required' | 'none';
}

type OpenRouterPayload = BaseOpenRouterPayload | FunctionCallingPayload | ToolCallingPayload;

/**
 * Type-safe error creation helper
 */
function createGenerationError(
  message: string,
  modelAttempted: string,
  isFallback: boolean,
  code?: string,
  type?: string
): GenerationError {
  const error = new Error(message) as GenerationError;
  
  // Use Object.defineProperty to set readonly properties
  Object.defineProperty(error, 'code', {
    value: code,
    writable: false,
    enumerable: true,
    configurable: false
  });
  
  Object.defineProperty(error, 'modelAttempted', {
    value: modelAttempted,
    writable: false,
    enumerable: true,
    configurable: false
  });
  
  Object.defineProperty(error, 'isFallback', {
    value: isFallback,
    writable: false,
    enumerable: true,
    configurable: false
  });
  
  if (type !== undefined) {
    Object.defineProperty(error, 'type', {
      value: type,
      writable: false,
      enumerable: true,
      configurable: false
    });
  }
  
  return error;
}

/**
 * Determine if model supports tool calling
 */
function supportsToolCalling(model: string): boolean {
  const capability = MODEL_CAPABILITIES[model];
  return capability?.supportsTools ?? false;
}

/**
 * Get fallback model for free tier users
 */
function getFallbackModel(originalModel: string, requiresTools: boolean): string {
  // If original model is already free, no fallback needed
  const originalCapability = MODEL_CAPABILITIES[originalModel];
  if (originalCapability?.isFree) {
    return originalModel;
  }

  // Find appropriate fallback
  if (requiresTools) {
    return 'openai/gpt-3.5-turbo'; // Free model with tool support
  }

  return 'meta-llama/llama-3.1-8b-instruct:free'; // Free general purpose model
}

/**
 * Type guard for function calling payload
 */
function isFunctionCallingPayload(payload: OpenRouterPayload): payload is FunctionCallingPayload {
  return 'functions' in payload && 'function_call' in payload;
}

/**
 * Create function calling payload
 */
function createFunctionCallingPayload(
  basePayload: BaseOpenRouterPayload,
  functions: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: string;
      readonly properties: Record<string, unknown>;
      readonly required?: readonly string[];
    };
  }[]
): FunctionCallingPayload {
  return {
    ...basePayload,
    functions,
    function_call: 'auto'
  } as const;
}

/**
 * Make OpenRouter API request with proper error handling
 */
async function makeOpenRouterRequest(
  payload: OpenRouterPayload,
  apiKey: string,
  model: string
): Promise<GenerationResult> {
  const startTime = Date.now();

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3000',
      'X-Title': process.env.OPENROUTER_TITLE || 'Workflow Engine'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorData: OpenRouterError | Record<string, unknown> = {};
    try {
      errorData = await response.json() as OpenRouterError;
    } catch {
      // Ignore JSON parse errors
    }

    const errorMessage = `OpenRouter API error: ${response.status} - ${
      'error' in errorData && typeof errorData.error === 'object' && errorData.error !== null
        ? (errorData.error as OpenRouterErrorDetail).message
        : 'Unknown error'
    }`;

    const errorCode = 'error' in errorData && typeof errorData.error === 'object' && errorData.error !== null
      ? (errorData.error as OpenRouterErrorDetail).code
      : `HTTP_${response.status}`;

    throw createGenerationError(errorMessage, model, false, errorCode);
  }

  const responseData = await response.json() as OpenRouterResponse;
  const choice = responseData.choices[0];
  
  if (!choice) {
    throw createGenerationError('No response choice received from OpenRouter', model, false);
  }
  
  const content = choice.message.content ?? '';
  const toolCalls: ToolCall[] = [];

  // Parse tool calls if present (new format)
  if (choice.message.tool_calls && Array.isArray(choice.message.tool_calls)) {
    toolCalls.push(...choice.message.tool_calls.map((tc: {
      readonly id: string;
      readonly type: 'function';
      readonly function: OpenRouterFunctionCall;
    }) => ({
      toolName: tc.function.name,
      input: typeof tc.function.arguments === 'string' 
        ? JSON.parse(tc.function.arguments) 
        : tc.function.arguments,
      reasoning: `Agent decided to use ${tc.function.name} based on the user query`
    })));
  }

  const executionTime = Date.now() - startTime;
  const tokensUsed = responseData.usage?.total_tokens ?? 0;
  const modelUsed = responseData.model ?? model;

  return {
    content,
    toolCalls,
    modelUsed,
    tokensUsed,
    executionTime,
    isFallback: modelUsed !== model
  };
}

/**
 * Generate text with tool calling capabilities for agents using Universal Format
 * Supports OpenRouter's free tier with automatic fallback
 */
export const generateWithTools: IntegrationFunction = async (
  context: ExecutionContext,
  config: AgentConfig
): Promise<ExecutionContext> => {
  const startTime = Date.now();

   // 🔍 ADD THIS DEBUG LOG
   logger.debug('OpenRouter received config', {
    executionId: context.executionId,
    configKeys: Object.keys(config),
    hasConfigApiKey: !!config.apiKey,
    configApiKeyType: typeof config.apiKey,
    configApiKeyLength: typeof config.apiKey === 'string' ? config.apiKey.length : 0,
    hasEnvApiKey: !!process.env.OPENROUTER_API_KEY,
    envApiKeyLength: process.env.OPENROUTER_API_KEY?.length || 0
  });
  
  try {
    // Prioritize environment variable
const apiKey = process.env.OPENROUTER_API_KEY || config.apiKey;
      // 🔍 ADD THIS DEBUG LOG
      logger.debug('API Key resolution result', {
        executionId: context.executionId,
        finalHasApiKey: !!apiKey,
        finalApiKeyLength: apiKey?.length || 0,
        source: config.apiKey ? 'config' : (apiKey ? 'env' : 'none')
      });
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Handle Universal Format inputs
    const {
      model,
      messages,
      tools,
      toolChoice,
      temperature = 0.7,
      maxTokens = 1500,
      fallbackModel,
      skipFallback = false,
      systemPrompt,
      userPrompt
    } = config;

    // Accept tools from multiple shapes:
    // - Universal (name/description/parameters) expected on config.tools
    // - Fallback to (config as any).tools if already in OpenAI schema, or to (config as any).openaiTools
    const universalTools: readonly ToolDescription[] = Array.isArray(tools) && tools.length > 0 && (tools as any[])[0]?.name
      ? (tools as unknown as ToolDescription[])
      : Array.isArray((config as any).openaiTools)
        ? ((config as any).openaiTools as any[]).map(t => t.function).map((fn: any) => ({
            name: fn?.name,
            description: fn?.description || 'No description provided',
            parameters: fn?.parameters || { type: 'object', properties: {} }
          }))
        : Array.isArray((config as any).functions)
          ? ((config as any).functions as any[]).map((fn: any) => ({
              name: fn?.name,
              description: fn?.description || 'No description provided',
              parameters: fn?.parameters || { type: 'object', properties: {} }
            }))
          : [];

    const requiresTools = universalTools.length > 0;
    const modelSupportsTools = supportsToolCalling(model);

    // Warn if tools requested but model doesn't support them
    if (requiresTools && !modelSupportsTools) {
      logger.warn('Tools requested but model does not support function calling', {
        model,
        toolsCount: tools?.length || 0,
        executionId: context.executionId
      });
    }

    logger.info('Generating agent response with OpenRouter', {
      agentId: context.agentId,
      model,
      temperature,
      maxTokens,
      toolsCount: universalTools.length,
      supportsTools: modelSupportsTools,
      executionId: context.executionId
    });

    // Convert Universal Format to OpenRouter format
    let openRouterMessages: ChatMessage[] = [];
    
    // If messages are provided, use them directly
    if (messages && Array.isArray(messages) && messages.length > 0) {
      openRouterMessages = (messages || []).map((msg: {
        readonly role: 'system' | 'user' | 'assistant' | 'function';
        readonly content: string;
        readonly toolCalls?: readonly {
          readonly id: string;
          readonly name: string;
          readonly arguments: Record<string, unknown>;
        }[];
        readonly toolCallId?: string;
      }) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.toolCalls && { tool_calls: msg.toolCalls.map((tc: {
          readonly id: string;
          readonly name: string;
          readonly arguments: Record<string, unknown>;
        }) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments)
          }
        })) }),
        ...(msg.toolCallId && { tool_call_id: msg.toolCallId })
      }));
    }
    // If systemPrompt and userPrompt are provided, build messages from them
    else if (systemPrompt || userPrompt) {
      if (systemPrompt) {
        openRouterMessages.push({
          role: 'system',
          content: systemPrompt
        });
      }
      if (userPrompt) {
        openRouterMessages.push({
          role: 'user',
          content: userPrompt
        });
      }
    }
    // If neither messages nor prompts are provided, throw error
    else {
      throw new Error('No messages or prompts provided for OpenRouter');
    }

    // Convert Universal tools to OpenRouter tools format
    const openRouterTools = universalTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));

    const basePayload: BaseOpenRouterPayload = {
      model,
      messages: openRouterMessages,
      max_tokens: maxTokens,
      temperature,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    };

    // Create appropriate payload based on tool calling capability
   // ✅ Improved payload construction for DeepSeek v3.1+ compatibility
const payload: OpenRouterPayload = (openRouterTools.length > 0 && modelSupportsTools)
? {
    ...basePayload,
    tools: openRouterTools,
    tool_choice: toolChoice === 'auto' ? 'auto' : toolChoice === 'required' ? 'required' : 'none',
    // 👇 Legacy compatibility (DeepSeek sometimes still expects this)
    functions: openRouterTools.map(t => t.function),
    function_call: 'auto'
  } as ToolCallingPayload
: basePayload;



    let result: GenerationResult;
    let attemptedFallback = false;

    try {
      result = await makeOpenRouterRequest(payload, apiKey, model);
    } catch (error) {
      // Try fallback if not explicitly disabled and we have a fallback strategy
      if (!skipFallback && (fallbackModel || !MODEL_CAPABILITIES[model]?.isFree)) {
        const fallback = fallbackModel ?? getFallbackModel(model, requiresTools ?? false);
        attemptedFallback = true;

        logger.info('Primary model failed, attempting fallback', {
          originalModel: model,
          fallbackModel: fallback,
          error: error instanceof Error ? error.message : String(error),
          executionId: context.executionId
        });

        try {
          // Update payload for fallback model
          const fallbackSupportsTools = supportsToolCalling(fallback);
          const fallbackBasePayload: BaseOpenRouterPayload = {
            ...basePayload,
            model: fallback
          };
          
          const fallbackPayload: OpenRouterPayload = (tools && tools.length > 0 && fallbackSupportsTools)
            ? {
                ...fallbackBasePayload,
                tools: openRouterTools,
                tool_choice: toolChoice === 'auto' ? 'auto' : toolChoice === 'required' ? 'required' : 'none'
              } as ToolCallingPayload
            : fallbackBasePayload;

          result = await makeOpenRouterRequest(fallbackPayload, apiKey, fallback);
          result = { ...result, isFallback: true };
        } catch (fallbackError) {
          // Both primary and fallback failed - enhance the error with fallback info
          if (fallbackError instanceof Error) {
            const enhancedError = createGenerationError(
              fallbackError.message,
              fallback,
              true,
              (fallbackError as GenerationError).code,
              (fallbackError as GenerationError).type
            );
            throw enhancedError;
          }
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }

    const totalExecutionTime = Date.now() - startTime;

    logger.info('Agent response generated successfully', {
      model: result.modelUsed,
      originalModel: model,
      isFallback: result.isFallback,
      attemptedFallback,
      tokensUsed: result.tokensUsed,
      executionTime: totalExecutionTime,
      contentLength: result.content.length,
      toolCallsCount: result.toolCalls.length,
      executionId: context.executionId
    });

    return {
      ...context,
      variables: {
        ...context.variables,
        agentResponse: result.content,
        toolCalls: result.toolCalls,
        reasoning: `Generated response using ${result.modelUsed}${result.isFallback ? ' (fallback)' : ''} with ${result.toolCalls.length} tool calls`,
        confidence: result.isFallback ? 0.7 : 0.8,
        totalTokens: result.tokensUsed,
        model: result.modelUsed,
        originalModel: model,
        isFallback: result.isFallback,
        executionTime: totalExecutionTime
      },
      stepResults: {
        ...context.stepResults,
        'openrouter-generateWithTools': {
          success: true,
          data: {
            response: result.content,
            toolCalls: result.toolCalls,
            reasoning: `Generated response using ${result.modelUsed}${result.isFallback ? ' (fallback)' : ''} with ${result.toolCalls.length} tool calls`,
            confidence: result.isFallback ? 0.7 : 0.8,
            totalTokens: result.tokensUsed,
            model: result.modelUsed,
            originalModel: model,
            isFallback: result.isFallback,
            executionTime: totalExecutionTime,
            attemptedFallback
          },
          timestamp: new Date().toISOString(),
          duration: totalExecutionTime,
          executionId: context.executionId ?? 'unknown',
          stepId: 'openrouter-generateWithTools'
        }
      }
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const generationError = error as GenerationError;
    
    logger.error('Failed to generate agent response', {
      error: errorMessage,
      code: generationError.code,
      modelAttempted: generationError.modelAttempted ?? config.model,
      isFallback: generationError.isFallback ?? false,
      agentId: context.agentId,
      executionTime,
      executionId: context.executionId
    });

    return {
      ...context,
      variables: {
        ...context.variables,
        agentResponse: 'I apologize, but I encountered an error while processing your request.',
        toolCalls: [],
        error: errorMessage,
        totalTokens: 0,
        executionTime
      },
      stepResults: {
        ...context.stepResults,
        'openrouter-generateWithTools': {
          success: false,
          error: errorMessage,
          data: {
            response: 'I apologize, but I encountered an error while processing your request.',
            toolCalls: [],
            totalTokens: 0,
            executionTime,
            modelAttempted: generationError.modelAttempted ?? config.model,
            isFallback: generationError.isFallback ?? false
          },
          timestamp: new Date().toISOString(),
          duration: executionTime,
          executionId: context.executionId ?? 'unknown',
          stepId: 'openrouter-generateWithTools'
        }
      }
    };
  }
};

/**
 * Simple chat completion for conversational responses
 * Supports OpenRouter's free tier with automatic model selection
 */
export const chatCompletion: IntegrationFunction = async (
  context: ExecutionContext,
  config: Record<string, unknown>
): Promise<ExecutionContext> => {
  const startTime = Date.now();
  
  try {
    // Prefer API key provided via node credentials/config, then env var
    const apiKey = (config.apiKey as string) ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Type-safe config extraction with defaults
    const systemPrompt = typeof config.systemPrompt === 'string' 
      ? config.systemPrompt 
      : 'You are a helpful assistant.';
    // Accept both userMessage and userPrompt keys
    const userMessage = typeof config.userMessage === 'string'
      ? (config.userMessage as string)
      : (typeof config.userPrompt === 'string' ? (config.userPrompt as string) : undefined);
    const model = typeof config.model === 'string' 
      ? config.model 
      : 'openai/gpt-3.5-turbo'; // Default to free tier
    const temperature = typeof config.temperature === 'number' 
      ? config.temperature 
      : 0.7;
    const maxTokens = typeof config.maxTokens === 'number' 
      ? config.maxTokens 
      : 1000;
    const fallbackModel = typeof config.fallbackModel === 'string' 
      ? config.fallbackModel 
      : undefined;
    const skipFallback = typeof config.skipFallback === 'boolean' 
      ? config.skipFallback 
      : false;

    if (!userMessage) {
      throw new Error('userMessage is required');
    }

    logger.info('Generating chat completion with OpenRouter', {
      agentId: context.agentId,
      model,
      temperature,
      maxTokens,
      executionId: context.executionId
    });

    const messages: readonly ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ] as const;

    const payload: BaseOpenRouterPayload = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    };

    let result: GenerationResult;
    let attemptedFallback = false;

    try {
      result = await makeOpenRouterRequest(payload, apiKey, model);
    } catch (error) {
      // Try fallback for chat completion
      if (!skipFallback && (fallbackModel || !MODEL_CAPABILITIES[model]?.isFree)) {
        const fallback = fallbackModel ?? getFallbackModel(model, false);
        attemptedFallback = true;

        logger.info('Primary model failed, attempting fallback for chat', {
          originalModel: model,
          fallbackModel: fallback,
          error: error instanceof Error ? error.message : String(error),
          executionId: context.executionId
        });

        const fallbackPayload: BaseOpenRouterPayload = { ...payload, model: fallback };
        result = await makeOpenRouterRequest(fallbackPayload, apiKey, fallback);
        result = { ...result, isFallback: true };
      } else {
        throw error;
      }
    }

    const totalExecutionTime = Date.now() - startTime;

    logger.info('Chat completion generated successfully', {
      model: result.modelUsed,
      originalModel: model,
      isFallback: result.isFallback,
      attemptedFallback,
      tokensUsed: result.tokensUsed,
      executionTime: totalExecutionTime,
      contentLength: result.content.length,
      executionId: context.executionId
    });

    return {
      ...context,
      variables: {
        ...context.variables,
        chatResponse: result.content,
        totalTokens: result.tokensUsed,
        model: result.modelUsed,
        originalModel: model,
        isFallback: result.isFallback,
        executionTime: totalExecutionTime
      },
      stepResults: {
        ...context.stepResults,
        'openrouter-chatCompletion': {
          success: true,
          data: {
            response: result.content,
            totalTokens: result.tokensUsed,
            model: result.modelUsed,
            originalModel: model,
            isFallback: result.isFallback,
            executionTime: totalExecutionTime,
            attemptedFallback
          },
          timestamp: new Date().toISOString(),
          duration: totalExecutionTime,
          executionId: context.executionId ?? 'unknown',
          stepId: 'openrouter-chatCompletion'
        }
      }
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const generationError = error as GenerationError;
    
    logger.error('Failed to generate chat completion', {
      error: errorMessage,
      code: generationError.code,
      modelAttempted: generationError.modelAttempted ?? 'unknown',
      isFallback: generationError.isFallback ?? false,
      agentId: context.agentId,
      executionTime,
      executionId: context.executionId
    });

    return {
      ...context,
      variables: {
        ...context.variables,
        chatResponse: 'I apologize, but I encountered an error while processing your request.',
        error: errorMessage,
        totalTokens: 0,
        executionTime
      },
      stepResults: {
        ...context.stepResults,
        'openrouter-chatCompletion': {
          success: false,
          error: errorMessage,
          data: {
            response: 'I apologize, but I encountered an error while processing your request.',
            totalTokens: 0,
            executionTime,
            modelAttempted: generationError.modelAttempted ?? 'unknown',
            isFallback: generationError.isFallback ?? false
          },
          timestamp: new Date().toISOString(),
          duration: executionTime,
          executionId: context.executionId ?? 'unknown',
          stepId: 'openrouter-chatCompletion'
        }
      }
    };
  }
};