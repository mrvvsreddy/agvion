// path: core/workflowrunner/execution/tests/channel-integration-test.ts

import { executeWorkflowFromChannel } from '../executer';
import { ChannelExecutionRequest } from '../channel-adapter';
import { WorkflowGraph } from '../types';
import logger from '../../../../utils/logger';

/**
 * Test Suite for Channel Integration & OpenRouter Support
 * 
 * This test suite demonstrates and validates:
 * 1. Channel-based workflow execution
 * 2. OpenRouter LLM integration
 * 3. Response routing back to channels
 * 4. Error handling and fallbacks
 */

export class ChannelIntegrationTest {
  private testResults: Array<{
    testName: string;
    success: boolean;
    duration: number;
    error?: string;
    result?: any;
  }> = [];

  /**
   * Test 1: Basic Webchat Channel Integration
   */
  async testWebchatIntegration(): Promise<void> {
    const startTime = Date.now();
    const testName = 'Webchat Channel Integration';

    try {
      logger.info(`🧪 Starting test: ${testName}`);

      const workflowDefinition: WorkflowGraph = {
        id: 'test-webchat-workflow',
        name: 'Test Webchat Workflow',
        agentId: 'test-agent-123',
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
          nodeType: 'agent',
          integration: 'openrouter',
          position: { x: 300, y: 100 },
          agentConfig: {
            systemPrompt: "You're a helpful test assistant. Keep responses short and friendly.",
            userPrompt: "User said: {{$json.channel_input.message}}",
            llm: {
              model: 'deepseek/deepseek-chat-v3.1:free',
              temperature: 0.7,
              maxTokens: 200
            }
          }
        }
        ],
        edges: [
          { id: 'edge001', source: 'trigger001', target: 'agent001' }
        ]
      };

      const request: ChannelExecutionRequest = {
        workflowId: 'test-webchat-workflow',
        workflowDefinition,
        input: {
          message: 'Hello! This is a test message.',
          userId: 'test-user-123',
          sessionId: 'test-session-456',
          timestamp: new Date().toISOString()
        },
        channelId: 'webchat_test-user-123_test-session-456',
        channelType: 'webchat',
        agentId: 'test-agent-123',
        tenantId: 'test-tenant-456',
        originalMessage: {
          type: 'text',
          payload: { text: 'Hello! This is a test message.' },
          userId: 'test-user-123',
          sessionId: 'test-session-456',
          timestamp: new Date().toISOString(),
          msgId: `test-msg-${Date.now()}`
        }
      };

      const result = await executeWorkflowFromChannel(request);

      const duration = Date.now() - startTime;
      
      if (result.success) {
        logger.info(`✅ Test passed: ${testName}`, {
          duration,
          outputLength: result.finalOutput.length,
          model: result.model,
          executionId: result.executionId
        });

        this.testResults.push({
          testName,
          success: true,
          duration,
          result: {
            output: result.finalOutput,
            model: result.model,
            executionId: result.executionId
          }
        });
      } else {
        throw new Error(`Workflow execution failed: ${result.error}`);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`❌ Test failed: ${testName}`, {
        duration,
        error: errorMessage
      });

      this.testResults.push({
        testName,
        success: false,
        duration,
        error: errorMessage
      });
    }
  }

  /**
   * Test 2: HTTP Webhook Channel Integration
   */
  async testHttpWebhookIntegration(): Promise<void> {
    const startTime = Date.now();
    const testName = 'HTTP Webhook Channel Integration';

    try {
      logger.info(`🧪 Starting test: ${testName}`);

      const workflowDefinition: WorkflowGraph = {
        id: 'test-http-workflow',
        name: 'Test HTTP Webhook Workflow',
        agentId: 'test-agent-123',
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
            nodeType: 'agent',
            integration: 'openrouter',
            position: { x: 300, y: 100 },
            agentConfig: {
              systemPrompt: "You're a data processing assistant. Analyze the provided data and provide a brief summary.",
              userPrompt: "Process this data: {{$json.channel_input.payload}}",
              llm: {
                model: 'deepseek/deepseek-chat-v3.1:free',
                temperature: 0.3,
                maxTokens: 150
              }
            }
          }
        ],
        edges: [
          { id: 'edge001', source: 'trigger001', target: 'agent001' }
        ]
      };

      const request: ChannelExecutionRequest = {
        workflowId: 'test-http-workflow',
        workflowDefinition,
        input: {
          payload: {
            name: 'Test Data',
            value: 42,
            items: ['item1', 'item2', 'item3'],
            metadata: {
              source: 'test',
              timestamp: new Date().toISOString()
            }
          },
          webhookId: 'test-webhook-789',
          timestamp: new Date().toISOString()
        },
        channelId: 'test-webhook-789',
        channelType: 'http',
        agentId: 'test-agent-123',
        tenantId: 'test-tenant-456'
      };

      const result = await executeWorkflowFromChannel(request);

      const duration = Date.now() - startTime;
      
      if (result.success) {
        logger.info(`✅ Test passed: ${testName}`, {
          duration,
          outputLength: result.finalOutput.length,
          model: result.model,
          executionId: result.executionId
        });

        this.testResults.push({
          testName,
          success: true,
          duration,
          result: {
            output: result.finalOutput,
            model: result.model,
            executionId: result.executionId
          }
        });
      } else {
        throw new Error(`Workflow execution failed: ${result.error}`);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`❌ Test failed: ${testName}`, {
        duration,
        error: errorMessage
      });

      this.testResults.push({
        testName,
        success: false,
        duration,
        error: errorMessage
      });
    }
  }

  /**
   * Test 3: OpenRouter Model Fallback
   */
  async testOpenRouterFallback(): Promise<void> {
    const startTime = Date.now();
    const testName = 'OpenRouter Model Fallback';

    try {
      logger.info(`🧪 Starting test: ${testName}`);

      const workflowDefinition: WorkflowGraph = {
        id: 'test-fallback-workflow',
        name: 'Test OpenRouter Fallback Workflow',
        agentId: 'test-agent-123',
        nodes: [
          {
            triggerName: 'test_trigger',
            id: 'trigger001',
            name: 'Test Trigger',
            type: 'trigger',
            position: { x: 100, y: 100 },
            config: {
              triggerType: 'test',
              channel: 'test'
            }
          },
          {
            triggerName: 'fallback_agent',
            id: 'agent001',
            name: 'Fallback Agent',
            type: 'ai_agent',
            nodeType: 'agent',
            integration: 'openrouter',
            position: { x: 300, y: 100 },
            agentConfig: {
              systemPrompt: "You're a test assistant. Respond with a simple greeting.",
              userPrompt: "Say hello!",
              llm: {
                model: 'non-existent-model', // This should trigger fallback
                temperature: 0.5,
                maxTokens: 100
              }
            }
          }
        ],
        edges: [
          { id: 'edge001', source: 'trigger001', target: 'agent001' }
        ]
      };

      const request: ChannelExecutionRequest = {
        workflowId: 'test-fallback-workflow',
        workflowDefinition,
        input: {
          testData: 'fallback test'
        },
        channelId: 'test-fallback-channel',
        channelType: 'http',
        agentId: 'test-agent-123',
        tenantId: 'test-tenant-456'
      };

      const result = await executeWorkflowFromChannel(request);

      const duration = Date.now() - startTime;
      
      if (result.success) {
        logger.info(`✅ Test passed: ${testName}`, {
          duration,
          outputLength: result.finalOutput.length,
          model: result.model,
          executionId: result.executionId
        });

        this.testResults.push({
          testName,
          success: true,
          duration,
          result: {
            output: result.finalOutput,
            model: result.model,
            executionId: result.executionId
          }
        });
      } else {
        throw new Error(`Workflow execution failed: ${result.error}`);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`❌ Test failed: ${testName}`, {
        duration,
        error: errorMessage
      });

      this.testResults.push({
        testName,
        success: false,
        duration,
        error: errorMessage
      });
    }
  }

  /**
   * Test 4: Error Handling
   */
  async testErrorHandling(): Promise<void> {
    const startTime = Date.now();
    const testName = 'Error Handling';

    try {
      logger.info(`🧪 Starting test: ${testName}`);

      // Test with invalid workflow definition
      const request: ChannelExecutionRequest = {
        workflowId: 'invalid-workflow',
        workflowDefinition: undefined as any, // This should trigger an error
        input: {
          message: 'This should fail'
        },
        channelId: 'error-test-channel',
        channelType: 'webchat',
        agentId: 'test-agent-123',
        tenantId: 'test-tenant-456'
      };

      const result = await executeWorkflowFromChannel(request);

      const duration = Date.now() - startTime;
      
      // We expect this to fail gracefully
      if (!result.success && result.error) {
        logger.info(`✅ Test passed: ${testName}`, {
          duration,
          error: result.error
        });

        this.testResults.push({
          testName,
          success: true,
          duration,
          result: {
            error: result.error,
            handledGracefully: true
          }
        });
      } else {
        throw new Error('Expected error handling test to fail gracefully');
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`❌ Test failed: ${testName}`, {
        duration,
        error: errorMessage
      });

      this.testResults.push({
        testName,
        success: false,
        duration,
        error: errorMessage
      });
    }
  }

  /**
   * Test 5: Multiple Concurrent Executions
   */
  async testConcurrentExecutions(): Promise<void> {
    const startTime = Date.now();
    const testName = 'Concurrent Executions';

    try {
      logger.info(`🧪 Starting test: ${testName}`);

      const workflowDefinition: WorkflowGraph = {
        id: 'test-concurrent-workflow',
        name: 'Test Concurrent Workflow',
        agentId: 'test-agent-123',
        nodes: [
          {
            triggerName: 'concurrent_trigger',
            id: 'trigger001',
            name: 'Concurrent Trigger',
            type: 'trigger',
            position: { x: 100, y: 100 },
            config: {
              triggerType: 'concurrent',
              channel: 'test'
            }
          },
          {
            triggerName: 'concurrent_agent',
            id: 'agent001',
            name: 'Concurrent Agent',
            type: 'ai_agent',
            nodeType: 'agent',
            integration: 'openrouter',
            position: { x: 300, y: 100 },
            agentConfig: {
              systemPrompt: "You're a test assistant. Respond with just 'OK'.",
              userPrompt: "Respond with OK",
              llm: {
                model: 'deepseek/deepseek-chat-v3.1:free',
                temperature: 0.7,
                maxTokens: 50
              }
            }
          }
        ],
        edges: [
          { id: 'edge001', source: 'trigger001', target: 'agent001' }
        ]
      };

      // Run 5 concurrent executions
      const promises = Array.from({ length: 5 }, (_, i) => {
        const request: ChannelExecutionRequest = {
          workflowId: 'test-concurrent-workflow',
          workflowDefinition,
          input: {
            message: `Concurrent test ${i + 1}`,
            userId: `test-user-${i + 1}`,
            sessionId: `test-session-${i + 1}`
          },
          channelId: `concurrent-test-${i + 1}`,
          channelType: 'webchat',
          agentId: 'test-agent-123',
          tenantId: 'test-tenant-456'
        };

        return executeWorkflowFromChannel(request);
      });

      const results = await Promise.all(promises);
      const successfulResults = results.filter(r => r.success);

      const duration = Date.now() - startTime;
      
      if (successfulResults.length >= 3) { // At least 3 should succeed
        logger.info(`✅ Test passed: ${testName}`, {
          duration,
          totalExecutions: results.length,
          successfulExecutions: successfulResults.length,
          successRate: `${((successfulResults.length / results.length) * 100).toFixed(1)}%`
        });

        this.testResults.push({
          testName,
          success: true,
          duration,
          result: {
            totalExecutions: results.length,
            successfulExecutions: successfulResults.length,
            successRate: `${((successfulResults.length / results.length) * 100).toFixed(1)}%`
          }
        });
      } else {
        throw new Error(`Not enough successful concurrent executions: ${successfulResults.length}/${results.length}`);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`❌ Test failed: ${testName}`, {
        duration,
        error: errorMessage
      });

      this.testResults.push({
        testName,
        success: false,
        duration,
        error: errorMessage
      });
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    logger.info('🚀 Starting Channel Integration Test Suite');

    const testStartTime = Date.now();

    // Run tests sequentially to avoid overwhelming the system
    await this.testWebchatIntegration();
    await this.testHttpWebhookIntegration();
    await this.testOpenRouterFallback();
    await this.testErrorHandling();
    await this.testConcurrentExecutions();

    const totalDuration = Date.now() - testStartTime;
    const passedTests = this.testResults.filter(r => r.success).length;
    const totalTests = this.testResults.length;

    logger.info('🏁 Test Suite Completed', {
      totalDuration,
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      successRate: `${((passedTests / totalTests) * 100).toFixed(1)}%`
    });

    // Print detailed results
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    
    this.testResults.forEach((result, index) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const duration = `${result.duration}ms`;
      
      console.log(`${index + 1}. ${result.testName}`);
      console.log(`   Status: ${status}`);
      console.log(`   Duration: ${duration}`);
      
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      if (result.result) {
        console.log(`   Result: ${JSON.stringify(result.result, null, 2)}`);
      }
      
      console.log('');
    });

    console.log(`Overall Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  }

  /**
   * Get test results
   */
  getTestResults() {
    return this.testResults;
  }
}

// Export for use in other modules
export default ChannelIntegrationTest;

// Example usage (commented out to avoid execution during import)
/*
async function runTests() {
  const testSuite = new ChannelIntegrationTest();
  await testSuite.runAllTests();
}

// Uncomment to run tests
// runTests().catch(console.error);
*/
