// integrations/openai/index.ts
import { Integration } from '../../types/integrations';
import { generateWithTools, chatCompletion } from './agentFunctions';
import logger from '../../utils/logger';

/**
 * OpenAI Integration
 * 
 * Provides text generation capabilities using OpenAI's GPT models.
 * 
 * Available Functions:
 * - generateWithTools: Generate text with tool calling capabilities for agents
 * - chatCompletion: Simple chat completion for conversational responses
 * 
 * Configuration:
 * - Requires OPENAI_API_KEY environment variable
 * - Supports multiple GPT models (3.5-turbo, 4, 4-turbo, gpt-4o, etc.)
 * - Model is specified in workflow configuration, not hardcoded
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
        description: 'Generate text with tool calling capabilities for agents'
      }
    });
    
    functions.set('chatCompletion', {
      fn: chatCompletion,
      meta: {
        name: 'chatCompletion',
        type: 'context',
        category: 'action',
        description: 'Simple chat completion for conversational responses'
      }
    });

    logger.info('OpenAI integration registered', {
      functions: Array.from(functions.keys()),
      note: 'Model will be determined by workflow configuration'
    });

    return {
      name: 'openai',
      functions,
      version: '2.0.0',
      capabilities: {
        triggers: [],
        actions: ['text-generation', 'function-calling', 'agent-support']
      }
    };
  }
};