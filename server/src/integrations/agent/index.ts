// path: integrations/agent/index.ts
import { Integration } from '../../types/integrations';
import { executeAgentIntegration } from '../../core/agentrunner/execution/agent-executor';
import logger from '../../utils/logger';

/**
 * Agent Integration
 * 
 * Provides AI agent execution capabilities for workflow nodes.
 * This integration allows workflows to include AI agent nodes that can:
 * - Execute with LLM providers (OpenAI, OpenRouter, etc.)
 * - Use tools and memory
 * - Process semantic data references
 * 
 * Available Functions:
 * - execute: Execute an AI agent node with the configured LLM and tools
 */
export default {
  register(): Integration {
    const functions = new Map();
    
    // Register agent execution function
    functions.set('execute', {
      fn: executeAgentIntegration,
      meta: {
        name: 'execute',
        type: 'context',
        category: 'action',
        description: 'Execute an AI agent node with LLM capabilities, tools, and memory'
      }
    });

    logger.info('Agent integration registered', {
      functions: Array.from(functions.keys()),
      capabilities: [
        'LLM execution',
        'tool calling',
        'memory management',
        'semantic data resolution'
      ]
    });

    return {
      name: 'agent',
      functions,
      version: '1.0.0',
      capabilities: {
        triggers: [],
        actions: ['agent-execution', 'llm-generation', 'tool-calling', 'memory']
      }
    };
  }
};

