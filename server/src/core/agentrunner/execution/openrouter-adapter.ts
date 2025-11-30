// path: core/workflowrunner/execution/openrouter-adapter.ts

import logger from '../../../utils/logger';
import { WorkflowExecutionContext } from './types';
import 'dotenv/config';  

// ============================================================================
// OPENROUTER INTEGRATION TYPES
// ============================================================================

export interface OpenRouterRequest {
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly OpenRouterTool[];
  readonly toolChoice?: 'auto' | 'required' | 'none';
  readonly apiKey?: string;
  readonly fallbackModel?: string;
  readonly skipFallback?: boolean;
}

export interface OpenRouterMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'function';
  readonly content: string;
  readonly name?: string;
}

export interface OpenRouterTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: string;
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

type NormalizedToolCall = {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly reasoning?: string;
};

export interface OpenRouterResponse {
  readonly output: string;
  readonly model: string;
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly timestamp: string;
  readonly success: boolean;
  readonly toolCalls?: readonly NormalizedToolCall[];
}

// ============================================================================
// ERROR MESSAGES
// ============================================================================

const ERROR_MESSAGES = {
  NO_RESPONSE: 'Unable to get response from AI. Please try again.',
  GENERATION_FAILED: 'AI generation failed. Please try again.',
  FUNCTION_NOT_FOUND: 'OpenRouter not configured properly.',
  INVALID_RESPONSE: 'Invalid response from AI. Please try again.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.'
} as const;

// ============================================================================
// OPENROUTER ADAPTER
// ============================================================================

export class OpenRouterAdapter {
  private static instance: OpenRouterAdapter;

  constructor() {}

  public static getInstance(): OpenRouterAdapter {
    if (!OpenRouterAdapter.instance) {
      OpenRouterAdapter.instance = new OpenRouterAdapter();
    }
    return OpenRouterAdapter.instance;
  }

  /**
   * Get error message based on error type
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('not found')) return ERROR_MESSAGES.FUNCTION_NOT_FOUND;
      if (msg.includes('invalid')) return ERROR_MESSAGES.INVALID_RESPONSE;
      if (msg.includes('extract')) return ERROR_MESSAGES.NO_RESPONSE;
    }
    return ERROR_MESSAGES.UNKNOWN_ERROR;
  }

  /**
   * Clean special tokens from model output
   */
  private cleanModelOutput(output: string): string {
    if (!output) return output;
    
    // Remove DeepSeek special tokens
    let cleaned = output
      .replace(/<\|redacted_begin_of_sentence\|>/g, '')
      .replace(/<\|redacted_end_of_sentence\|>/g, '')
      .replace(/<\|redacted_fim_begin\|>/g, '')
      .replace(/<\|redacted_fim_hole\|>/g, '')
      .replace(/<\|redacted_fim_end\|>/g, '');
    
    // Remove other common special tokens
    cleaned = cleaned
      .replace(/<\|im_start\|>/g, '')
      .replace(/<\|im_end\|>/g, '')
      .replace(/<\|endoftext\|>/g, '')
      .replace(/\[INST\]/g, '')
      .replace(/\[\/INST\]/g, '');
    
    // Trim whitespace
    return cleaned.trim();
  }

  /**
   * Extract output from response
   */
  private extractOutput(resultObj: unknown): string | null {
    if (!resultObj || typeof resultObj !== 'object') {
      return null;
    }

    const result = resultObj as Record<string, unknown>;

    // PRIORITY 1: Check direct variables (where OpenRouter integration puts it)
    if (result.variables && typeof result.variables === 'object') {
      const vars = result.variables as Record<string, unknown>;
      
      if (typeof vars.agentResponse === 'string') return vars.agentResponse;
      if (typeof vars.chatResponse === 'string') return vars.chatResponse;
      if (typeof vars.response === 'string') return vars.response;
      if (typeof vars.output === 'string') return vars.output;
      
      // Check variables.json (alternative structure)
      if (vars.json && typeof vars.json === 'object') {
        const json = vars.json as Record<string, unknown>;
        if (json.agent001 && typeof json.agent001 === 'object') {
          const agent = json.agent001 as Record<string, unknown>;
          if (typeof agent.output === 'string') return agent.output;
          if (typeof agent.response === 'string') return agent.response;
        }
      }
    }
    
    // Check nodeData
    if (result.nodeData && typeof result.nodeData === 'object') {
      const nodeData = result.nodeData as Record<string, unknown>;
      if (nodeData.agent001 && typeof nodeData.agent001 === 'object') {
        const agent = nodeData.agent001 as Record<string, unknown>;
        if (typeof agent.output === 'string') return agent.output;
        if (typeof agent.response === 'string') return agent.response;
      }
    }
    
    // Check choices (OpenAI format)
    if (Array.isArray(result.choices) && result.choices.length > 0) {
      const choice = result.choices[0] as Record<string, unknown>;
      if (choice.message && typeof choice.message === 'object') {
        const message = choice.message as Record<string, unknown>;
        if (typeof message.content === 'string') return message.content;
      }
    }
    
    // Check direct fields
    if (typeof result.output === 'string') return result.output;
    if (typeof result.content === 'string') return result.content;
    if (typeof result.text === 'string') return result.text;
    
    // Check json field
    if (result.json && typeof result.json === 'object') {
      const json = result.json as Record<string, unknown>;
      if (typeof json.output === 'string') return json.output;
      if (typeof json.agentOutput === 'string') return json.agentOutput;
      if (typeof json.response === 'string') return json.response;
    }
    
    if (typeof result.json === 'string') return result.json;
    
    return null;
  }

  /**
   * Extract tool calls from adapter result
   */
  private extractToolCalls(resultObj: unknown): ReadonlyArray<NormalizedToolCall> {
    if (!resultObj || typeof resultObj !== 'object') {
      return [];
    }

    const result = resultObj as Record<string, unknown>;
    const collected: NormalizedToolCall[] = [];
    const seen = new Set<string>();

    const tryAddToolCall = (candidate: unknown): void => {
      if (!candidate || typeof candidate !== 'object') {
        return;
      }

      const entry = candidate as Record<string, unknown>;
      const name =
        typeof entry.toolName === 'string' && entry.toolName.trim().length > 0
          ? entry.toolName
          : typeof entry.name === 'string' && entry.name.trim().length > 0
            ? entry.name
            : entry.function && typeof entry.function === 'object' && entry.function !== null && typeof (entry.function as Record<string, unknown>).name === 'string'
              ? (entry.function as Record<string, unknown>).name as string
              : undefined;

      if (!name) {
        return;
      }

      const reasoning = typeof entry.reasoning === 'string' ? entry.reasoning : undefined;

      let args: Record<string, unknown> = {};
      const input = entry.input;
      const rawArguments = entry.arguments;

      if (input && typeof input === 'object' && !Array.isArray(input)) {
        args = input as Record<string, unknown>;
      } else if (typeof rawArguments === 'string') {
        try {
          args = JSON.parse(rawArguments) as Record<string, unknown>;
        } catch (error) {
          logger.warn('Failed to parse tool call arguments string', {
            raw: rawArguments,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
        args = rawArguments as Record<string, unknown>;
      } else if (entry.function && typeof entry.function === 'object') {
        const fn = entry.function as Record<string, unknown>;
        if (typeof fn.arguments === 'string') {
          try {
            args = JSON.parse(fn.arguments) as Record<string, unknown>;
          } catch (error) {
            logger.warn('Failed to parse nested function arguments string', {
              raw: fn.arguments,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else if (fn.arguments && typeof fn.arguments === 'object' && !Array.isArray(fn.arguments)) {
          args = fn.arguments as Record<string, unknown>;
        }
      }

      const key = `${name}:${JSON.stringify(args)}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      collected.push(reasoning ? { name, arguments: args, reasoning } : { name, arguments: args });
    };

    const variables = result.variables;
    if (variables && typeof variables === 'object') {
      const toolCalls = (variables as Record<string, unknown>).toolCalls;
      if (Array.isArray(toolCalls)) {
        toolCalls.forEach(tryAddToolCall);
      }

      const varsJson = (variables as Record<string, unknown>).json;
      if (varsJson && typeof varsJson === 'object') {
        Object.values(varsJson as Record<string, unknown>).forEach((value: unknown) => {
          if (value && typeof value === 'object') {
            const nested = (value as Record<string, unknown>).toolCalls;
            if (Array.isArray(nested)) {
              nested.forEach(tryAddToolCall);
            }
          }
        });
      }
    }

    const directToolCalls = (result as Record<string, unknown>).toolCalls;
    if (Array.isArray(directToolCalls)) {
      directToolCalls.forEach(tryAddToolCall);
    }

    const stepResults = result.stepResults;
    if (stepResults && typeof stepResults === 'object') {
      const openRouterStep = (stepResults as Record<string, unknown>)['openrouter-generateWithTools'];
      if (openRouterStep && typeof openRouterStep === 'object') {
        const data = (openRouterStep as Record<string, unknown>).data;
        if (data && typeof data === 'object') {
          const stepToolCalls = (data as Record<string, unknown>).toolCalls;
          if (Array.isArray(stepToolCalls)) {
            stepToolCalls.forEach(tryAddToolCall);
          }
        }
      }
    }

    return collected;
  }

  /**
   * Extract usage info
   */
  private extractUsage(resultObj: unknown): OpenRouterResponse['usage'] {
    const defaultUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };

    if (!resultObj || typeof resultObj !== 'object') {
      return defaultUsage;
    }

    const result = resultObj as Record<string, unknown>;

    // Check variables.json (where OpenRouter integration stores it)
    if (result.variables && typeof result.variables === 'object') {
      const vars = result.variables as Record<string, unknown>;
      
      if (vars.json && typeof vars.json === 'object') {
        const json = vars.json as Record<string, unknown>;
        if (json.agent001 && typeof json.agent001 === 'object') {
          const agent = json.agent001 as Record<string, unknown>;
          if (agent.usage && typeof agent.usage === 'object') {
            const u = agent.usage as Record<string, unknown>;
            return {
              promptTokens: (typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 
                           typeof u.promptTokens === 'number' ? u.promptTokens : 0),
              completionTokens: (typeof u.completion_tokens === 'number' ? u.completion_tokens :
                               typeof u.completionTokens === 'number' ? u.completionTokens : 0),
              totalTokens: (typeof u.total_tokens === 'number' ? u.total_tokens :
                          typeof u.totalTokens === 'number' ? u.totalTokens : 0)
            };
          }
        }
      }

      // Check variables directly
      if (typeof vars.totalTokens === 'number') {
        return {
          promptTokens: typeof vars.promptTokens === 'number' ? vars.promptTokens : 0,
          completionTokens: typeof vars.completionTokens === 'number' ? vars.completionTokens : 0,
          totalTokens: vars.totalTokens
        };
      }
    }

    // Check usage field
    if (result.usage && typeof result.usage === 'object') {
      const u = result.usage as Record<string, unknown>;
      return {
        promptTokens: (typeof u.prompt_tokens === 'number' ? u.prompt_tokens :
                     typeof u.promptTokens === 'number' ? u.promptTokens : 0),
        completionTokens: (typeof u.completion_tokens === 'number' ? u.completion_tokens :
                         typeof u.completionTokens === 'number' ? u.completionTokens : 0),
        totalTokens: (typeof u.total_tokens === 'number' ? u.total_tokens :
                    typeof u.totalTokens === 'number' ? u.totalTokens : 0)
      };
    }

    // Check json.usage
    if (result.json && typeof result.json === 'object') {
      const json = result.json as Record<string, unknown>;
      if (json.usage && typeof json.usage === 'object') {
        const u = json.usage as Record<string, unknown>;
        return {
          promptTokens: (typeof u.prompt_tokens === 'number' ? u.prompt_tokens :
                       typeof u.promptTokens === 'number' ? u.promptTokens : 0),
          completionTokens: (typeof u.completion_tokens === 'number' ? u.completion_tokens :
                           typeof u.completionTokens === 'number' ? u.completionTokens : 0),
          totalTokens: (typeof u.total_tokens === 'number' ? u.total_tokens :
                      typeof u.totalTokens === 'number' ? u.totalTokens : 0)
        };
      }
    }

    return defaultUsage;
  }

  /**
   * Generate text using OpenRouter
   */
  public async generate(
    request: OpenRouterRequest,
    context: WorkflowExecutionContext
  ): Promise<OpenRouterResponse> {
    try {
      logger.info('Generating text using OpenRouter', {
        model: request.model,
        executionId: context.executionId,
        messageCount: request.messages.length,
        hasTools: !!(request.tools && request.tools.length > 0)
      });

      // Import OpenRouter integration
      const openrouterIntegration = await import('../../../integrations/openrouter');
      const integration = openrouterIntegration.default.register();
      
      // Get function
     // Decide which integration function to use
let generateFunction;

// If tools are defined and allowed, use the tool-capable function
if (request.tools && request.tools.length > 0 && request.toolChoice !== 'none') {
  generateFunction = integration.functions.get('generateWithTools');
} else {
  // Otherwise, use the standard chat completion function
  generateFunction = integration.functions.get('chatCompletion');
}

// Safety check
if (!generateFunction) {
  throw new Error(ERROR_MESSAGES.FUNCTION_NOT_FOUND);
}

      // Prepare config
      const agentConfig = {
        systemPrompt: this.extractSystemPrompt(request.messages),
        userPrompt: this.extractUserPrompt(request.messages),
        model: request.model,
        temperature: request.temperature || 0.7,
        maxTokens: request.maxTokens || 500,
        tools: request.tools || [],
        toolChoice: request.toolChoice ?? (request.tools && request.tools.length > 0 ? 'auto' : undefined),
        apiKey: request.apiKey || process.env.OPENROUTER_API_KEY,
        messages: request.messages
      };

      // Execute
      const compatibleContext = { ...context, stepResults: {} };
      const result = await generateFunction.fn(compatibleContext, agentConfig);
      
      // Debug log
      logger.debug('OpenRouter result', {
        executionId: context.executionId,
        hasResult: !!result,
        resultKeys: result ? Object.keys(result) : [],
        hasVariables: !!(result as unknown as Record<string, unknown>)?.variables,
        hasNodeData: !!(result as unknown as Record<string, unknown>)?.nodeData,
        variablesKeys: (result as unknown as Record<string, unknown>)?.variables ? 
          Object.keys((result as unknown as Record<string, unknown>).variables as Record<string, unknown>) : [],
        preview: JSON.stringify(result, null, 2).substring(0, 1000)
      });
      
      if (!result || typeof result !== 'object') {
        logger.error('OpenRouter returned invalid result', {
          executionId: context.executionId,
          resultType: typeof result
        });
        throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
      }

      const output = this.extractOutput(result);
      const toolCalls = this.extractToolCalls(result);
      
      if (!output) {
        logger.error('Failed to extract output from OpenRouter result', {
          executionId: context.executionId,
          resultKeys: Object.keys(result),
          resultType: typeof result,
          resultPreview: JSON.stringify(result, null, 2).substring(0, 2000)
        });
        throw new Error(ERROR_MESSAGES.NO_RESPONSE);
      }

      // Clean special tokens from output
      const cleanedOutput = this.cleanModelOutput(output);

      // Validate response structure
      if (!cleanedOutput || cleanedOutput.trim().length === 0) {
        logger.error('OpenRouter returned empty response after cleaning', {
          executionId: context.executionId,
          originalLength: output.length,
          cleanedLength: cleanedOutput.length
        });
        throw new Error(ERROR_MESSAGES.NO_RESPONSE);
      }

      const usage = this.extractUsage(result);
      const resultObj = result as unknown as Record<string, unknown>;
      const model = (typeof resultObj.model === 'string' ? resultObj.model :
                    resultObj.json && typeof resultObj.json === 'object' && 
                    typeof (resultObj.json as Record<string, unknown>).model === 'string' ?
                    (resultObj.json as Record<string, unknown>).model as string :
                    request.model);

      logger.info('OpenRouter completed', {
        model,
        outputLength: cleanedOutput.length,
        executionId: context.executionId,
        usage,
        toolCallCount: toolCalls.length
      });

      return {
        output: cleanedOutput,
        model: model as string,
        usage,
        timestamp: new Date().toISOString(),
        success: true,
        ...(toolCalls.length > 0 ? { toolCalls } : {})
      } as OpenRouterResponse;

    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      
      logger.error('OpenRouter failed', {
        model: request.model,
        error: error instanceof Error ? error.message : String(error),
        executionId: context.executionId,
        stack: error instanceof Error ? error.stack : undefined
      });

      // Throw the error instead of returning it as a response
      throw new Error(errorMessage);
    }
  }

  /**
   * Extract system prompt from messages
   */
  private extractSystemPrompt(messages: readonly OpenRouterMessage[]): string {
    const systemMessage = messages.find(msg => msg.role === 'system');
    return systemMessage?.content || '';
  }

  /**
   * Extract user prompt from messages
   */
  private extractUserPrompt(messages: readonly OpenRouterMessage[]): string {
    const userMessages = messages.filter(msg => msg.role === 'user');
    return userMessages.map(msg => msg.content).join('\n');
  }

  /**
   * Build messages from node
   */
  public buildMessagesFromNode(
    node: Record<string, unknown>,
    context: WorkflowExecutionContext
  ): readonly OpenRouterMessage[] {
    const messages: OpenRouterMessage[] = [];

    // Add system prompt
    if (node.agentConfig && typeof node.agentConfig === 'object') {
      const agentConfig = node.agentConfig as Record<string, unknown>;
      if (typeof agentConfig.systemPrompt === 'string') {
        messages.push({
          role: 'system',
          content: this.resolveTemplateVariables(agentConfig.systemPrompt, context)
        });
      }

      // Add user prompt
      if (typeof agentConfig.userPrompt === 'string') {
        messages.push({
          role: 'user',
          content: this.resolveTemplateVariables(agentConfig.userPrompt, context)
        });
      }
    }

    // Fallback: use trigger data
    if (messages.length === 0) {
      const triggerData = this.findTriggerData(context);
      if (triggerData) {
        // Try multiple possible fields for user input
        const userInput = triggerData.message || triggerData.text || triggerData.content || triggerData.input;
        if (typeof userInput !== 'undefined') {
          messages.push({
            role: 'user',
            content: String(userInput)
          });
        }
      }
    }

    return messages;
  }

  /**
   * Resolve template variables
   */
  private resolveTemplateVariables(template: string, context: WorkflowExecutionContext): string {
    return template.replace(/\{\{\s*\$json\.([^}]+)\s*\}\}/g, (match, path) => {
      const parts = path.split('.');
      if (parts.length >= 2) {
        const nodeName = parts[0];
        const fieldName = parts[1];
        
        const nodeData = context.nodeData[nodeName];
        if (nodeData && typeof nodeData === 'object') {
          const data = nodeData as Record<string, unknown>;
          const fieldValue = data[fieldName];
          if (fieldValue !== undefined) {
            return String(fieldValue);
          }
        }
      }
      return match;
    });
  }

  /**
   * Find trigger data
   */
  private findTriggerData(context: WorkflowExecutionContext): Record<string, unknown> | null {
    // Look for trigger data in multiple ways
    for (const [key, value] of Object.entries(context.nodeData)) {
      if (value && typeof value === 'object') {
        const data = value as Record<string, unknown>;
        
        // Check if this is trigger data by looking for common trigger fields
        if (data.source === 'trigger' || 
            data.triggerType || 
            key.toLowerCase().includes('trigger') || 
            key.toLowerCase().includes('channel_input') ||
            key.toLowerCase().includes('webchat')) {
          return data;
        }
      }
    }
    
    // Also check variables for trigger data
    if (context.variables && typeof context.variables === 'object') {
      const vars = context.variables as Record<string, unknown>;
      if (vars.json && typeof vars.json === 'object') {
        const jsonVars = vars.json as Record<string, unknown>;
        for (const [key, value] of Object.entries(jsonVars)) {
          if (value && typeof value === 'object') {
            const data = value as Record<string, unknown>;
            if (data.source === 'trigger' || data.triggerType) {
              return data;
            }
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Get free models
   */
  public getFreeModels(): readonly string[] {
    return ['deepseek/deepseek-chat-v3.1:free'];
  }
}

export default OpenRouterAdapter.getInstance();