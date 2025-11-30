// path: core/workflowrunner/execution/examples/channel-integration-example.ts

import logger from '../../../../utils/logger';
import { executeWorkflowFromChannel } from '../executer';
import { ChannelExecutionRequest } from '../channel-adapter';
import { WorkflowGraph } from '../types';

/**
 * Example: Channel Integration with Workflow Executor
 * 
 * This example demonstrates how to use the new channel integration features:
 * 1. Execute workflows from channel requests
 * 2. Use OpenRouter for all LLM operations
 * 3. Send responses back to originating channels
 * 
 * Architecture Flow:
 * Channel Message → executeWorkflowFromChannel() → Workflow Executor → OpenRouter → Channel Response
 */

export class ChannelIntegrationExample {
  /**
   * Example: Execute workflow from webchat channel
   */
  async executeFromWebchat(
    workflowId: string,
    message: string,
    userId: string,
    sessionId: string,
    agentId: string,
    tenantId: string
  ) {
    logger.info('Executing workflow from webchat channel', {
      workflowId,
      message,
      userId,
      sessionId,
      agentId,
      tenantId
    });

    // Create a sample workflow definition
    const workflowDefinition: WorkflowGraph = {
      id: workflowId,
      name: 'Webchat AI Assistant',
      agentId,
      nodes: [
        {
          triggerName: 'webchat_trigger',
          id: 'trigger001',
          name: 'Webchat Trigger',
          type: 'trigger',
          position: { x: 100, y: 100 },
          config: {
            triggerType: 'webchat',
            channel: 'webchat'
          }
        },
        {
          triggerName: 'ai_assistant',
          id: 'agent001',
          name: 'AI Assistant',
          type: 'ai_agent',
          integration: 'openrouter',
          position: { x: 300, y: 100 },
          config: {
            model: 'deepseek/deepseek-chat-v3.1:free',
            temperature: 0.7,
            maxTokens: 1000,
            systemPrompt: "You're a helpful AI assistant. Provide concise, helpful responses.",
            userPrompt: "User message: {{$json.channel_input.message}}"
          }
        },
        {
          triggerName: 'send_reply',
          id: 'reply001',
          name: 'Send Reply',
          type: 'action',
          integration: 'webchat',
          position: { x: 500, y: 100 },
          config: {
            action: 'send_response',
            sourceNode: 'agent001'
          }
        }
      ],
      edges: [
        { id: 'edge001', source: 'trigger001', target: 'agent001' },
        { id: 'edge002', source: 'agent001', target: 'reply001' }
      ]
    };

    // Create channel execution request
    const request: ChannelExecutionRequest = {
      workflowId,
      workflowDefinition,
      input: {
        message,
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        messageType: 'text'
      },
      channelId: `webchat_${userId}_${sessionId}`,
      channelType: 'webchat',
      agentId,
      tenantId,
      originalMessage: {
        type: 'text',
        payload: { text: message },
        userId,
        sessionId,
        timestamp: new Date().toISOString(),
        msgId: `msg_${Date.now()}`
      }
    };

    try {
      // Execute workflow from channel
      const result = await executeWorkflowFromChannel(request);

      logger.info('Webchat workflow execution completed', {
        workflowId,
        userId,
        sessionId,
        success: result.success,
        outputLength: result.finalOutput.length,
        model: result.model,
        executionId: result.executionId
      });

      return {
        success: result.success,
        response: result.finalOutput,
        model: result.model,
        executionId: result.executionId,
        timestamp: result.timestamp
      };

    } catch (error) {
      logger.error('Webchat workflow execution failed', {
        workflowId,
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Example: Execute workflow from HTTP webhook
   */
  async executeFromHttpWebhook(
    workflowId: string,
    payload: Record<string, unknown>,
    webhookId: string,
    agentId: string,
    tenantId: string
  ) {
    logger.info('Executing workflow from HTTP webhook', {
      workflowId,
      webhookId,
      agentId,
      tenantId,
      payloadKeys: Object.keys(payload)
    });

    // Create a sample workflow definition for HTTP webhook
    const workflowDefinition: WorkflowGraph = {
      id: workflowId,
      name: 'HTTP Webhook Processor',
      agentId,
      nodes: [
        {
          triggerName: 'http_trigger',
          id: 'trigger001',
          name: 'HTTP Trigger',
          type: 'trigger',
          position: { x: 100, y: 100 },
          config: {
            triggerType: 'http',
            channel: 'http'
          }
        },
        {
          triggerName: 'data_processor',
          id: 'agent001',
          name: 'Data Processor',
          type: 'ai_agent',
          integration: 'openrouter',
          position: { x: 300, y: 100 },
          config: {
            model: 'deepseek/deepseek-chat-v3.1:free',
            temperature: 0.3,
            maxTokens: 500,
            systemPrompt: "You're a data processing assistant. Analyze the provided data and provide insights.",
            userPrompt: "Process this data: {{$json.channel_input.payload}}"
          }
        },
        {
          triggerName: 'http_response',
          id: 'response001',
          name: 'HTTP Response',
          type: 'action',
          integration: 'http',
          position: { x: 500, y: 100 },
          config: {
            action: 'send_response',
            sourceNode: 'agent001',
            responseFormat: 'json'
          }
        }
      ],
      edges: [
        { id: 'edge001', source: 'trigger001', target: 'agent001' },
        { id: 'edge002', source: 'agent001', target: 'response001' }
      ]
    };

    // Create channel execution request
    const request: ChannelExecutionRequest = {
      workflowId,
      workflowDefinition,
      input: {
        payload,
        webhookId,
        timestamp: new Date().toISOString(),
        source: 'http_webhook'
      },
      channelId: webhookId,
      channelType: 'http',
      agentId,
      tenantId
    };

    try {
      // Execute workflow from channel
      const result = await executeWorkflowFromChannel(request);

      logger.info('HTTP webhook workflow execution completed', {
        workflowId,
        webhookId,
        success: result.success,
        outputLength: result.finalOutput.length,
        model: result.model,
        executionId: result.executionId
      });

      return {
        success: result.success,
        response: result.finalOutput,
        model: result.model,
        executionId: result.executionId,
        timestamp: result.timestamp
      };

    } catch (error) {
      logger.error('HTTP webhook workflow execution failed', {
        workflowId,
        webhookId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Example: Test different message types through webchat
   */
  async testDifferentMessageTypes(
    workflowId: string,
    agentId: string,
    tenantId: string
  ) {
    const testMessages = [
      'Hello! How are you?',
      'What is the weather like today?',
      'Can you help me with a coding problem?',
      'Tell me a joke!',
      'What are the benefits of using OpenRouter?'
    ];

    logger.info('Testing different message types through webchat', {
      workflowId,
      agentId,
      tenantId,
      messageCount: testMessages.length
    });

    const results = [];

    for (let i = 0; i < testMessages.length; i++) {
      const message = testMessages[i];
      const userId = `test_user_${i + 1}`;
      const sessionId = `session_${Date.now()}_${i}`;

      try {
        const result = await this.executeFromWebchat(
          workflowId,
          message || 'Hello',
          userId,
          sessionId,
          agentId,
          tenantId
        );

        results.push({
          message,
          userId,
          sessionId,
          success: result.success,
          response: result.response || result.error,
          model: result.model,
          executionId: result.executionId
        });

        // Small delay between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.push({
          message,
          userId,
          sessionId,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info('Message type testing completed', {
      workflowId,
      agentId,
      tenantId,
      totalMessages: testMessages.length,
      successfulResponses: results.filter(r => r.success).length,
      failedResponses: results.filter(r => !r.success).length
    });

    return results;
  }

  /**
   * Example: Complete workflow execution demonstration
   */
  async runCompleteExample() {
    const workflowId = 'example-channel-workflow';
    const agentId = 'example-agent-123';
    const tenantId = 'example-tenant-456';
    const userId = 'demo-user-789';
    const sessionId = 'demo-session-101';
    const testMessage = 'Hello! Can you help me understand how this channel integration works?';

    logger.info('Running complete channel integration example', {
      workflowId,
      agentId,
      tenantId,
      userId,
      sessionId,
      testMessage
    });

    try {
      // Execute workflow from webchat
      const result = await this.executeFromWebchat(
        workflowId,
        testMessage,
        userId,
        sessionId,
        agentId,
        tenantId
      );

      if (result.success) {
        logger.info('Complete example completed successfully', {
          originalMessage: testMessage,
          aiResponse: result.response,
          model: result.model,
          executionId: result.executionId,
          timestamp: result.timestamp
        });

        return {
          success: true,
          workflowId,
          originalMessage: testMessage,
          aiResponse: result.response,
          model: result.model,
          executionId: result.executionId,
          timestamp: result.timestamp
        };
      } else {
        throw new Error(`Workflow execution failed: ${result.error}`);
      }

    } catch (error) {
      logger.error('Complete example failed', {
        error: error instanceof Error ? error.message : String(error),
        workflowId,
        agentId,
        tenantId,
        userId
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Export for use in other modules
export default ChannelIntegrationExample;

// Example usage (commented out to avoid execution during import)
/*
async function runExample() {
  const example = new ChannelIntegrationExample();
  
  // Run the complete example
  const result = await example.runCompleteExample();
  
  if (result.success) {
    console.log('✅ Channel integration example completed successfully!');
    console.log(`📝 Original: ${result.originalMessage}`);
    console.log(`🤖 AI Response: ${result.aiResponse}`);
    console.log(`🔧 Model: ${result.model}`);
    console.log(`🆔 Execution ID: ${result.executionId}`);
  } else {
    console.log('❌ Example failed:', result.error);
  }
}

// Uncomment to run the example
// runExample().catch(console.error);
*/
