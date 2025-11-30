// path: core/workflowrunner/execution/tests/manual-test.ts

import { executeWorkflowFromChannel } from '../executer';
import { ChannelExecutionRequest } from '../channel-adapter';
import { WorkflowGraph } from '../types';
import logger from '../../../../utils/logger';

async function runManualTest() {
  console.log('🧪 Manual Channel Integration Test');
  console.log('===================================\n');

  try {
    // Use actual database values
    const tenantId = 'HAOIH2OhNeJHc'; // From tenants table
    const agentId = 'YPBo9tBCSriGnYHV'; // From agents table
    const workflowId = '875b35a5-aae0-49a5-a154-9d1b1899beae'; // From agent_integrations
    const channelId = '5a3494a1-7724-460c-bbce-420462812d28'; // From agent_integrations (webchat integration id)
    const workspaceId = 'c4f809c1-fd57-4646-9e54-05a6dbe05b25';

    // Create a simple workflow definition
    const workflowDefinition: WorkflowGraph = {
      id: workflowId,
      name: 'Manual Test Workflow',
      agentId: agentId,
      nodes: [
        {
          triggerName: 'manual_trigger',
          id: 'trigger001',
          name: 'Manual Trigger',
          type: 'trigger',
          position: { x: 100, y: 100 },
          config: {
            triggerType: 'manual',
            channel: 'webchat'
          }
        },
        {
          triggerName: 'test_agent',
          id: 'agent001',
          name: 'Test Agent',
          type: 'ai_agent',
          nodeType: 'agent',
          integration: 'agent',
          function: 'execute',
          position: { x: 300, y: 100 },
          agentConfig: {
            systemPrompt: "You're a helpful test assistant. Keep responses short and friendly.",
            userPrompt: "User said: {{$json.channel_input.message}}",
            llm: {
              model: 'deepseek/deepseek-chat-v3.1:free',
              temperature: 0.7,
              maxTokens: 100,
            }
          }
        }
      ],
      edges: [
        { id: 'edge001', source: 'trigger001', target: 'agent001' }
      ]
    };

    const request: ChannelExecutionRequest = {
      workflowId: workflowId,
      workflowDefinition,
      input: {
        message: 'explain quaantum physics.',
        userId: 'test-user-001',
        sessionId: `session-${Date.now()}`,
        timestamp: new Date().toISOString()
      },
      channelId: channelId,
      channelType: 'webchat',
      agentId: agentId,
      tenantId: tenantId,
      originalMessage: {
        type: 'text',
        payload: { text: 'explain quaantum physics.' },
        userId: 'test-user-001',
        sessionId: `session-${Date.now()}`,
        timestamp: new Date().toISOString(),
        msgId: `msg-${Date.now()}`
      }
    };

    console.log('📤 REQUEST DETAILS');
    console.log('==================');
    console.log(`Tenant ID: ${request.tenantId} (reddy)`);
    console.log(`Workspace ID: ${workspaceId}`);
    console.log(`Agent ID: ${request.agentId} (new agent)`);
    console.log(`Workflow ID: ${request.workflowId}`);
    console.log(`Channel Type: ${request.channelType}`);
    console.log(`Channel ID: ${request.channelId}`);
    console.log(`\n📝 Input Message:`);
    console.log(`   "${request.input.message}"`);
    
    const agentNode = workflowDefinition.nodes[1];
    if (agentNode && 'agentConfig' in agentNode && agentNode.agentConfig) {
      console.log(`\n🤖 Agent Configuration:`);
      console.log(`   Model: ${agentNode.agentConfig.llm?.model || 'N/A'}`);
      console.log(`   System Prompt: "${agentNode.agentConfig.systemPrompt || 'N/A'}"`);
      console.log(`   User Prompt Template: "${agentNode.agentConfig.userPrompt || 'N/A'}"`);
      console.log(`   Temperature: ${agentNode.agentConfig.llm?.temperature || 'N/A'}`);
      console.log(`   Max Tokens: ${agentNode.agentConfig.llm?.maxTokens || 'N/A'}`);
    }
    console.log('\n⏳ Executing workflow...\n');

    const startTime = Date.now();
    const result = await executeWorkflowFromChannel(request);
    const duration = Date.now() - startTime;

    console.log('\n' + '='.repeat(80));
    console.log('📥 RESPONSE DETAILS');
    console.log('='.repeat(80));
    console.log(`✓ Success: ${result.success}`);
    console.log(`✓ Duration: ${duration}ms`);
    console.log(`✓ Execution ID: ${result.executionId}`);
    console.log(`✓ Model Used: ${result.model || 'N/A'}`);
    console.log(`✓ Timestamp: ${result.timestamp}`);
    
    console.log('\n📦 FULL RESULT OBJECT:');
    console.log(JSON.stringify(result, null, 2));

    if (result.executionContext?.nodeData) {
      console.log('\n' + '='.repeat(80));
      console.log('🔍 NODE DATA ANALYSIS');
      console.log('='.repeat(80));
      
      for (const [nodeName, nodeData] of Object.entries(result.executionContext.nodeData)) {
        console.log(`\n📌 Node: "${nodeName}"`);
        console.log('─'.repeat(40));
        
        if (nodeData && typeof nodeData === 'object') {
          const data = nodeData as any;
          
          // Show all available fields
          console.log(`Available fields: ${Object.keys(data).join(', ')}`);
          
          // Check for various output fields
          if (data.output) {
            console.log(`\n💬 OUTPUT: "${data.output}"`);
          }
          if (data.agentOutput) {
            console.log(`\n💬 AGENT OUTPUT: "${data.agentOutput}"`);
          }
          if (data.response) {
            console.log(`\n💬 RESPONSE: "${data.response}"`);
          }
          if (data.text) {
            console.log(`\n💬 TEXT: "${data.text}"`);
          }
          if (data.message) {
            console.log(`\n💬 MESSAGE: "${data.message}"`);
          }
          if (data.content) {
            console.log(`\n💬 CONTENT: "${data.content}"`);
          }
          
          // Show full data for this node
          console.log(`\n📄 Full Node Data:`);
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log('   (No data or invalid format)');
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎯 FINAL OUTPUT');
    console.log('='.repeat(80));
    
    if (result.success) {
      console.log(`\n✅ SUCCESS!`);
      console.log(`\n💬 AI Response: "${result.finalOutput}"`);
      console.log(`\n📊 Stats:`);
      console.log(`   - Execution Time: ${duration}ms`);
      console.log(`   - Response Length: ${result.finalOutput.length} characters`);
      console.log(`\n📋 Database Context:`);
      console.log(`   - Tenant: reddy (${tenantId})`);
      console.log(`   - Agent: new agent (${agentId})`);
      console.log(`   - Workspace: ${workspaceId}`);
      console.log(`   - Channel Integration: ${channelId}`);
    } else {
      console.log(`\n❌ FAILED!`);
      console.log(`\n⚠️ Error: ${result.error}`);
    }

    console.log('\n' + '='.repeat(80));

  } catch (error) {
    console.log('\n' + '='.repeat(80));
    console.log('💥 EXCEPTION OCCURRED');
    console.log('='.repeat(80));
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    
    if (error instanceof Error && error.stack) {
      console.log(`\nStack trace:\n${error.stack}`);
    }
    
    logger.error('Manual test failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// Run the manual test
runManualTest();