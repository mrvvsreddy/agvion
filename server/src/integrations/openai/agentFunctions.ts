// integrations/openai/agentFunctions.ts
import { ExecutionContext } from '../../types/context';
import { IntegrationFunction } from '../../types/integrations';
import logger from '../../utils/logger';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
}

interface ToolDescription {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

interface AgentConfig {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDescription[];
  apiKey?: string; // per-call api key override
}

interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

interface OpenAIChoice {
  message: {
    content: string | null;
    function_call?: OpenAIFunctionCall;
  };
  finish_reason: string;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate text with tool calling capabilities for agents
 */
export const generateWithTools: IntegrationFunction = async (
  context: ExecutionContext,
  config: AgentConfig
): Promise<ExecutionContext> => {
  const startTime = Date.now();
  
  try {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const {
      systemPrompt,
      userPrompt,
      model = 'gpt-4',
      temperature = 0.7,
      maxTokens = 1500,
      tools = []
    } = config;

    logger.info('Generating agent response with tools', {
      agentId: context.agentId,
      model,
      temperature,
      maxTokens,
      toolsCount: tools.length,
      executionId: context.executionId
    });

    // Build messages array
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    // Prepare tools for OpenAI function calling
    const functions = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));

    const payload: any = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    }; 

    // Add function calling if tools are available
    if (functions.length > 0) {
      payload.functions = functions;
      payload.function_call = 'auto';
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const responseData = await response.json() as OpenAIResponse;
    const choice = responseData.choices[0];
    
    if (!choice) {
      throw new Error('No response choice received from OpenAI');
    }
    
    let content = choice.message.content || '';
    let functionCall = choice.message.function_call;
    let toolCalls: any[] = [];

    // Parse function calls if present
    if (functionCall) {
      try {
        const args = JSON.parse(functionCall.arguments);
        toolCalls.push({
          toolName: functionCall.name,
          input: args,
          reasoning: `Agent decided to use ${functionCall.name} based on the user query`
        });
      } catch (error) {
        logger.warn('Failed to parse function call arguments', {
          functionCall,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const tokensUsed = responseData.usage?.total_tokens || 0;
    const executionTime = Date.now() - startTime;

    logger.info('Agent response generated successfully', {
      model,
      tokensUsed,
      executionTime,
      contentLength: content.length,
      toolCallsCount: toolCalls.length,
      executionId: context.executionId
    });

    return {
      ...context,
      variables: {
        ...context.variables,
        agentResponse: content,
        toolCalls,
        reasoning: `Generated response using ${model} with ${toolCalls.length} tool calls`,
        confidence: 0.8,
        totalTokens: tokensUsed,
        model,
        executionTime
      },
      stepResults: {
        ...context.stepResults,
        'openai-generateWithTools': {
          success: true,
          data: {
            response: content,
            toolCalls,
            reasoning: `Generated response using ${model} with ${toolCalls.length} tool calls`,
            confidence: 0.8,
            totalTokens: tokensUsed,
            model,
            executionTime
          },
          timestamp: new Date().toISOString(),
          duration: executionTime,
          executionId: context.executionId || 'unknown',
          stepId: 'openai-generateWithTools'
        }
      }
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Failed to generate agent response', {
      error: errorMessage,
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
        'openai-generateWithTools': {
          success: false,
          error: errorMessage,
          data: {
            response: 'I apologize, but I encountered an error while processing your request.',
            toolCalls: [],
            totalTokens: 0,
            executionTime
          },
          timestamp: new Date().toISOString(),
          duration: executionTime,
          executionId: context.executionId || 'unknown',
          stepId: 'openai-generateWithTools'
        }
      }
    };
  }
};

/**
 * Simple chat completion for conversational responses
 */
export const chatCompletion: IntegrationFunction = async (
  context: ExecutionContext,
  config: any
): Promise<ExecutionContext> => {
  const startTime = Date.now();
  
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const {
      systemPrompt = 'You are a helpful assistant.',
      userMessage,
      model = 'gpt-4',
      temperature = 0.7,
      maxTokens = 1000
    } = config;

    if (!userMessage) {
      throw new Error('userMessage is required');
    }

    logger.info('Generating chat completion', {
      agentId: context.agentId,
      model,
      temperature,
      maxTokens,
      executionId: context.executionId
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    const payload = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const responseData = await response.json() as OpenAIResponse;
    const content = responseData.choices[0]?.message?.content || 'Unable to generate response.';
    const tokensUsed = responseData.usage?.total_tokens || 0;
    const executionTime = Date.now() - startTime;

    logger.info('Chat completion generated successfully', {
      model,
      tokensUsed,
      executionTime,
      contentLength: content.length,
      executionId: context.executionId
    });

    return {
      ...context,
      variables: {
        ...context.variables,
        chatResponse: content,
        totalTokens: tokensUsed,
        model,
        executionTime
      },
      stepResults: {
        ...context.stepResults,
        'openai-chatCompletion': {
          success: true,
          data: {
            response: content,
            totalTokens: tokensUsed,
            model,
            executionTime
          },
          timestamp: new Date().toISOString(),
          duration: executionTime,
          executionId: context.executionId || 'unknown',
          stepId: 'openai-chatCompletion'
        }
      }
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    logger.error('Failed to generate chat completion', {
      error: errorMessage,
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
        'openai-chatCompletion': {
          success: false,
          error: errorMessage,
          data: {
            response: 'I apologize, but I encountered an error while processing your request.',
            totalTokens: 0,
            executionTime
          },
          timestamp: new Date().toISOString(),
          duration: executionTime,
          executionId: context.executionId || 'unknown',
          stepId: 'openai-chatCompletion'
        }
      }
    };
  }
};

/**
 * Parse tool calls from OpenAI function calling response
 */
// Tool-call parsing and tool formatting moved to execution/tools to decouple executor from OpenAI integration
