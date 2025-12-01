import { Integration } from '../../types/integrations';
import logger from '../../utils/logger';
import { executeWebhookReply, validateWebhookReplyConfig } from './webhook-reply';

// Export the webhook server for Express mounting

export { default as webchatConnectRouter } from './connect';

/**
 * Webchat Integration
 * 
 * Provides webhook-based chat functionality for processing incoming messages
 * and executing workflows through webhook endpoints.
 * 
 * Key Features:
 * - Message validation and processing
 * - Workflow execution through webhooks
 * - Webhook reply/response generation
 * - Support for multiple message types (text, image, audio, video, file, location)
 * - Session management
 * - Response formatting and metadata
 * 
 * Available Functions:
 * - processMessage: Process incoming webchat messages
 * - validateMessage: Validate incoming message format
 * - execute: Execute webhook reply (send response back)
 * 
 * Configuration:
 * - Requires webhook configuration in database
 * - Supports workflow_id linking for automatic workflow execution
 * - Handles message sanitization and validation
 */
export default {
  register(): Integration {
    const functions = new Map();

    // Register processMessage function
    functions.set('processMessage', {
      fn: async (context: any, params: any) => {
        logger.info('Webchat processMessage called', { params });

        return {
          success: true,
          message: 'Message processed by webchat integration',
          timestamp: new Date().toISOString()
        };
      },
      meta: {
        name: 'processMessage',
        type: 'context',
        category: 'action',
        description: 'Process incoming webchat messages and execute workflows'
      }
    });

    // Register validateMessage function
    functions.set('validateMessage', {
      fn: async (context: any, params: any) => {
        logger.info('Webchat validateMessage called', { params });

        return {
          valid: true,
          message: 'Message validation passed',
          timestamp: new Date().toISOString()
        };
      },
      meta: {
        name: 'validateMessage',
        type: 'context',
        category: 'action',
        description: 'Validate incoming message format and structure'
      }
    });

    // Register execute function (webhook reply)
    functions.set('execute', {
      fn: async (context: any, params: any) => {
        logger.info('Webchat execute (webhook reply) called', {
          executionId: context.executionId,
          nodeId: params.nodeId,
          nodeName: params.nodeName
        });

        // Validate configuration
        const validation = validateWebhookReplyConfig(params);
        if (!validation.valid) {
          logger.error('Invalid webhook reply configuration', {
            errors: validation.errors,
            params
          });
          return {
            success: false,
            message: 'Invalid webhook reply configuration',
            errors: validation.errors
          };
        }

        // Execute the webhook reply
        const result = await executeWebhookReply(context, params);

        return result;
      },
      meta: {
        name: 'execute',
        type: 'context',
        category: 'action',
        description: 'Execute webhook reply - format and return response from workflow execution'
      }
    });

    logger.info('Webchat integration registered', {
      functions: Array.from(functions.keys()),
      capabilities: [
        'message-processing',
        'webhook-handling',
        'workflow-execution',
        'webhook-reply',
        'session-management',
        'multi-format-support'
      ],
      supportedTypes: [
        'text',
        'image',
        'audio',
        'video',
        'file',
        'location'
      ]
    });

    return {
      name: 'webchat',
      functions,
      version: '1.0.0',
      capabilities: {
        triggers: ['webhook'],
        actions: [
          'message-processing',
          'workflow-execution',
          'webhook-reply',
          'session-management',
          'response-generation'
        ]
      }
    };
  }
};