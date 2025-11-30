// path: integrations/openrouter/index.ts
import { Integration } from '../../types/integrations';
import { generateWithTools, chatCompletion } from './agentFunctions';
import logger from '../../utils/logger';

/**
 * OpenRouter Integration
 * 
 * Provides multi-provider AI text generation through OpenRouter's unified API.
 * 
 * Key Features:
 * - Access to 200+ AI models from multiple providers (OpenAI, Anthropic, Meta, Google, etc.)
 * - Free tier support with automatic fallback to free models
 * - Tool calling support for compatible models
 * - Transparent pricing and usage tracking
 * 
 * Available Functions:
 * - generateWithTools: Generate text with tool calling capabilities for agents
 * - chatCompletion: Simple chat completion for conversational responses
 * 
 * Configuration:
 * - Requires OPENROUTER_API_KEY environment variable
 * - Optional OPENROUTER_REFERER and OPENROUTER_TITLE for attribution
 * - Supports all OpenRouter models with automatic capability detection
 * - Free tier models: gpt-3.5-turbo, claude-3-haiku, llama-3.1-8b-instruct, gemini-flash-1.5
 * 
 * Free Tier Benefits:
 * - $0.10 daily credit for new users
 * - Access to select models at no cost
 * - Automatic fallback when quotas exceeded
 * - No API key required for basic usage (but recommended for tracking)
 * 
 * Environment Variables:
 * - OPENROUTER_API_KEY: Your OpenRouter API key (required)
 * - OPENROUTER_REFERER: Your app URL for attribution (optional)
 * - OPENROUTER_TITLE: Your app name for attribution (optional)
 */
export default {
  register(): Integration {
    const functions = new Map();
    
    // Register agent-specific functions
    functions.set('generateWithTools', {
      fn: generateWithTools,
      meta: {
        name: 'generateWithTools',
        type: 'context',
        category: 'action',
        description: 'Generate text with tool calling capabilities using OpenRouter models. Supports automatic fallback to free tier models.'
      }
    });
    
    functions.set('chatCompletion', {
      fn: chatCompletion,
      meta: {
        name: 'chatCompletion',
        type: 'context',
        category: 'action',
        description: 'Simple chat completion for conversational responses. Automatically uses cost-effective models with free tier support.'
      }
    });

    logger.info('OpenRouter integration registered', {
      functions: Array.from(functions.keys()),
      capabilities: [
        'multi-provider access',
        'free tier support',
        'automatic fallback',
        'tool calling (select models)',
        '200+ models available'
      ],
      freeModels: [
        'openai/gpt-3.5-turbo',
        'anthropic/claude-3-haiku', 
        'meta-llama/llama-3.1-8b-instruct:free',
        'google/gemini-flash-1.5'
      ],
      note: 'Model selection and pricing determined by workflow configuration. Free tier available with $0.10 daily credit.'
    });

    return {
      name: 'openrouter',
      functions,
      version: '1.0.0',
      capabilities: {
        triggers: [],
        actions: [
          'text-generation', 
          'function-calling', 
          'agent-support',
          'multi-provider',
          'free-tier',
          'cost-optimization'
        ]
      }
    };
  }
};