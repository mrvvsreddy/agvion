# AgentFlowService Rewrite - Architecture Documentation

## Overview

The `AgentFlowService` has been completely rewritten to follow the execution pattern from `executer.ts` while integrating with channels and LLM providers through a clean adapter pattern.

## Architecture

```
Input Channel (webchat/slack/whatsapp)
  ↓ message with workflow request
AgentFlowService (orchestrator)
  ↓ converts FlowDefinition to WorkflowGraph
Workflow Executor (sequential execution)
  ↓ executes nodes in dependency order
LLM Adapter (OpenRouter integration)
  ↓ generates AI responses
Channel Adapter (response formatting)
  ↓ sends back to same channel
Output Channel (webchat/slack/whatsapp)
```

## Key Changes

### 1. Removed Direct LLM Dependencies
- ❌ **Before**: Direct OpenAI SDK calls in AgentFlowService
- ✅ **After**: All LLM calls go through OpenRouter integration via LLM Adapter

### 2. Channel Integration
- ❌ **Before**: Tightly coupled to specific channels
- ✅ **After**: Channel adapter pattern for unified input/output handling

### 3. Execution Model
- ❌ **Before**: Complex branching logic in AgentFlowService
- ✅ **After**: Simple sequential execution following executer.ts pattern

### 4. Separation of Concerns
- ❌ **Before**: Monolithic service handling everything
- ✅ **After**: Modular components with clear responsibilities

## File Structure

```
server/src/agent/services/
├── types.ts                    # Type definitions matching executer.ts
├── channel-adapter.ts          # Channel integration interface
├── llm-adapter.ts             # LLM provider interface (OpenRouter)
├── workflow-executor.ts       # Sequential workflow execution
├── AgentFlowService.ts        # Main orchestrator service
└── examples/
    └── webchat-workflow-example.ts  # Complete usage example
```

## Components

### 1. Types (`types.ts`)
- Workflow execution types matching executer.ts interfaces
- Channel message/response types
- LLM request/response types
- Legacy FlowDefinition compatibility

### 2. Channel Adapter (`channel-adapter.ts`)
- Unified interface for different communication channels
- Supports webchat, slack, whatsapp (extensible)
- Handles message processing and response delivery

### 3. LLM Adapter (`llm-adapter.ts`)
- Unified interface for different LLM providers
- Currently supports OpenRouter integration
- Automatic fallback to free tier models
- Usage tracking and cost optimization

### 4. Workflow Executor (`workflow-executor.ts`)
- Sequential execution following executer.ts pattern
- Dependency-based node execution order
- Security limits and resource management
- Template variable resolution

### 5. AgentFlowService (`AgentFlowService.ts`)
- Main orchestrator service
- Converts FlowDefinition to WorkflowGraph
- Handles webhook message processing
- Manages flow CRUD operations

## Usage Example

```typescript
import AgentFlowService from './AgentFlowService';

const agentFlowService = AgentFlowService.getInstance();

// Process incoming webchat message
const result = await agentFlowService.processWebhookMessage(
  'agent-123',
  'webchat',
  {
    payload: { text: 'Hello!' },
    userId: 'user-456',
    sessionId: 'session-789'
  }
);

if (result.success) {
  console.log('Response:', result.response.response);
  console.log('Model:', result.response.model);
}
```

## Workflow Definition

The service maintains compatibility with the existing FlowDefinition format while internally converting to the new WorkflowGraph format:

```typescript
const flowDefinition: FlowDefinition = {
  trigger: {
    type: 'webchat',
    channel: 'webchat',
    config: { auto_respond: false }
  },
  workflow: {
    integrations: [
      {
        id: 'trigger001',
        name: 'Webchat Trigger',
        type: 'trigger',
        integration: 'webchat',
        // ... trigger configuration
      },
      {
        id: 'agent001',
        name: 'AI Agent',
        type: 'ai_agent',
        integration: 'openrouter',
        data: {
          model: 'deepseek/deepseek-chat-v3.1:free',
          systemPrompt: "You're a helpful assistant.",
          userPrompt: "{{$json.trigger001.message}}"
        }
      }
    ],
    edges: [
      { id: 'edge001', source: 'trigger001', target: 'agent001' }
    ]
  },
  prompt: {
    model: 'deepseek/deepseek-chat-v3.1:free',
    system_prompt: "You're a helpful assistant.",
    user_prompt_template: "{{$json.trigger001.message}}"
  },
  credentials: {
    api_keys: {
      openrouter: 'YOUR_OPENROUTER_API_KEY'
    }
  }
};
```

## Integration Points

### 1. Webchat Integration
- Uses existing webhook server (`webchat/webhook-server.ts`)
- Processes messages through AgentFlowService
- Returns responses in webhook format

### 2. OpenRouter Integration
- Uses existing OpenRouter integration (`openrouter/agentFunctions.ts`)
- Supports both `generateWithTools` and `chatCompletion` functions
- Automatic fallback to free tier models

### 3. Database Integration
- Uses existing repositories (`AgentFlowsRepository`, `AgentIntegrationsRepository`)
- Maintains compatibility with existing database schema
- No database migrations required

## Security Features

- Input validation and sanitization
- Template injection protection
- Resource limits (execution time, memory usage)
- Prototype pollution protection
- Safe object operations

## Error Handling

- Graceful degradation on LLM failures
- Fallback responses for channel errors
- Comprehensive logging for debugging
- Timeout protection for long-running workflows

## Performance

- Sequential execution for predictable behavior
- Resource cleanup and memory management
- Execution tracking and monitoring
- Configurable limits and timeouts

## Migration Guide

### For Existing Code
1. **No breaking changes** - existing FlowDefinition format is maintained
2. **Database schema unchanged** - no migrations required
3. **API compatibility** - same method signatures

### For New Integrations
1. Use the new adapter pattern for channels
2. Implement LLM providers through the LLM adapter
3. Follow the WorkflowGraph format for complex workflows

## Testing

See `examples/webchat-workflow-example.ts` for:
- Complete workflow creation
- Message processing
- Response handling
- Error scenarios

## Future Enhancements

1. **Additional Channels**: Slack, WhatsApp, Discord adapters
2. **More LLM Providers**: OpenAI direct, Anthropic, local models
3. **Advanced Workflows**: Conditional logic, loops, parallel execution
4. **Monitoring**: Metrics, tracing, performance analytics
5. **Caching**: Response caching, model result caching

## Success Criteria ✅

- [x] AgentFlowService no longer has direct LLM SDK dependencies
- [x] All LLM calls go through OpenRouter
- [x] Workflows can be triggered from channels and respond back
- [x] Simple, maintainable execution model like executer.ts
- [x] Type-safe interfaces between components
- [x] Production-grade error handling
- [x] Complete example showing workflow execution through webchat channel
