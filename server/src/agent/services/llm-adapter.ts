// path: agent/services/llm-adapter.ts

import logger from '../../utils/logger';
import { 
  LLMAdapter, 
  LLMRequest, 
  LLMResponse, 
  WorkflowExecutionContext,
  ToolDescription 
} from './types';

/**
 * LLM Adapter Interface
 * 
 * Provides a unified interface for different LLM providers (OpenRouter, OpenAI, etc.)
 * to generate text responses during workflow execution.
 * 
 * Key Features:
 * - Unified LLM request/response handling
 * - Automatic fallback to free tier models
 * - Tool calling support for compatible models
 * - Usage tracking and cost optimization
 */
export class LLMAdapterService {
  private static instance: LLMAdapterService;
  private adapters: Map<string, LLMAdapter> = new Map();

  constructor() {
    this.registerDefaultAdapters();
  }

  public static getInstance(): LLMAdapterService {
    if (!LLMAdapterService.instance) {
      LLMAdapterService.instance = new LLMAdapterService();
    }
    return LLMAdapterService.instance;
  }

  /**
   * Register an LLM adapter
   */
  public registerAdapter(adapter: LLMAdapter): void {
    this.adapters.set(adapter.name, adapter);
    logger.info('LLM adapter registered', { 
      name: adapter.name,
      totalAdapters: this.adapters.size 
    });
  }

  /**
   * Get an LLM adapter by name
   */
  public getAdapter(providerName: string): LLMAdapter | null {
    return this.adapters.get(providerName) || null;
  }

  /**
   * Generate text using the specified LLM provider
   */
  public async generate(
    providerName: string,
    request: LLMRequest,
    context: WorkflowExecutionContext
  ): Promise<LLMResponse> {
    const adapter = this.getAdapter(providerName);
    
    if (!adapter) {
      logger.error('LLM adapter not found', { providerName });
      return {
        output: 'I apologize, but the AI service is not available.',
        model: 'unknown',
        timestamp: new Date().toISOString(),
        success: false
      };
    }

    try {
      logger.info('Generating text using LLM adapter', {
        providerName,
        adapterName: adapter.name,
        model: request.model,
        executionId: context.executionId,
        hasTools: !!(request.tools && request.tools.length > 0)
      });

      return await adapter.generate(request, context);
    } catch (error) {
      logger.error('LLM adapter generation failed', {
        providerName,
        adapterName: adapter.name,
        model: request.model,
        error: error instanceof Error ? error.message : String(error),
        executionId: context.executionId
      });

      return {
        output: 'I apologize, but I encountered an error generating a response.',
        model: request.model,
        timestamp: new Date().toISOString(),
        success: false
      };
    }
  }

  /**
   * Register default LLM adapters
   */
  private registerDefaultAdapters(): void {
    // OpenRouter adapter
    this.registerAdapter({
      name: 'openrouter',
      generate: async (request: LLMRequest, context: WorkflowExecutionContext) => {
        try {
          // Import OpenRouter integration dynamically to avoid circular dependencies
          const openrouterIntegration = await import('../../integrations/openrouter');
          const integration = openrouterIntegration.default.register();
          
          // Get the generateWithTools function
          const generateFunction = integration.functions.get('generateWithTools');
          if (!generateFunction) {
            throw new Error('OpenRouter generateWithTools function not found');
          }

          // Prepare the agent config for OpenRouter
          const agentConfig = {
            systemPrompt: request.systemPrompt,
            userPrompt: request.userPrompt,
            model: request.model,
            temperature: request.temperature || 0.7,
            maxTokens: request.maxTokens || 500,
            tools: request.tools || [],
            apiKey: request.credentials?.apiKey || process.env.OPENROUTER_API_KEY,
            fallbackModel: 'deepseek/deepseek-chat-v3.1:free',
            skipFallback: false
          };

          // Execute the OpenRouter function
          const result = await generateFunction.fn(context, agentConfig);
          
          // Extract the response
          let output = 'I apologize, but I could not generate a response.';
          let model = request.model;
          let usage;

          if (result && typeof result === 'object') {
            const resultObj = result as any;
            
            // Extract output text - check for null/undefined explicitly
            if (resultObj.json?.output !== null && resultObj.json?.output !== undefined) {
              output = resultObj.json.output;
            } else if (resultObj.json?.agentOutput !== null && resultObj.json?.agentOutput !== undefined) {
              output = resultObj.json.agentOutput;
            } else if (resultObj.json?.response !== null && resultObj.json?.response !== undefined) {
              output = resultObj.json.response;
            } else if (typeof resultObj.json === 'string') {
              output = resultObj.json;
            }

            // Extract model information
            if (resultObj.json?.model) {
              model = resultObj.json.model;
            }

            // Extract usage information
            if (resultObj.json?.usage) {
              usage = {
                promptTokens: resultObj.json.usage.prompt_tokens || 0,
                completionTokens: resultObj.json.usage.completion_tokens || 0,
                totalTokens: resultObj.json.usage.total_tokens || 0
              };
            }
          }

          logger.info('OpenRouter generation completed', {
            model,
            outputLength: output.length,
            executionId: context.executionId,
            usage
          });

          return {
            output,
            model,
            usage: usage ?? undefined,
            timestamp: new Date().toISOString(),
            success: true
          };

        } catch (error) {
          logger.error('OpenRouter generation failed', {
            model: request.model,
            error: error instanceof Error ? error.message : String(error),
            executionId: context.executionId
          });

          // Fallback to simple chat completion
          try {
            const openrouterIntegration = await import('../../integrations/openrouter');
            const integration = openrouterIntegration.default.register();
            
            const chatFunction = integration.functions.get('chatCompletion');
            if (chatFunction) {
              const chatConfig = {
                systemPrompt: request.systemPrompt,
                userPrompt: request.userPrompt,
                model: 'deepseek/deepseek-chat-v3.1:free', // Use free model as fallback
                temperature: request.temperature || 0.7,
                maxTokens: request.maxTokens || 500,
                apiKey: process.env.OPENROUTER_API_KEY
              };

              const fallbackResult = await chatFunction.fn(context, chatConfig);
              
              if (fallbackResult && typeof fallbackResult === 'object') {
                const resultObj = fallbackResult as any;
                const output = (resultObj.json?.output !== null && resultObj.json?.output !== undefined) 
                  ? resultObj.json.output 
                  : (resultObj.json?.response !== null && resultObj.json?.response !== undefined)
                    ? resultObj.json.response
                    : 'I apologize, but I could not generate a response.';
                
                return {
                  output,
                  model: 'deepseek/deepseek-chat-v3.1:free',
                  timestamp: new Date().toISOString(),
                  success: true
                };
              }
            }
          } catch (fallbackError) {
            logger.error('OpenRouter fallback also failed', {
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              executionId: context.executionId
            });
          }

          return {
            output: 'I apologize, but I encountered an error generating a response.',
            model: request.model,
            timestamp: new Date().toISOString(),
            success: false
          };
        }
      }
    });

    logger.info('Default LLM adapters registered', {
      adapters: Array.from(this.adapters.keys())
    });
  }

  /**
   * Get all registered provider names
   */
  public getRegisteredProviders(): readonly string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Check if a provider is supported
   */
  public isProviderSupported(providerName: string): boolean {
    return this.adapters.has(providerName);
  }

  /**
   * Get recommended free models for a provider
   */
  public getFreeModels(providerName: string): readonly string[] {
    switch (providerName) {
      case 'openrouter':
        return [
          'deepseek/deepseek-chat-v3.1:free',
          'openai/gpt-3.5-turbo',
          'anthropic/claude-3-haiku',
          'meta-llama/llama-3.1-8b-instruct:free',
          'google/gemini-flash-1.5'
        ];
      default:
        return [];
    }
  }
}

export default LLMAdapterService.getInstance();
