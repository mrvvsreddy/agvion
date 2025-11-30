# Channel Integration & OpenRouter Support for Workflow Executor

## Overview

The workflow executor has been enhanced with channel integration and OpenRouter support, enabling workflows to receive requests from various channels (webchat, HTTP, Slack, WhatsApp) and automatically delegate all LLM operations to OpenRouter instead of direct SDK calls.

## Architecture

```
Channel Message → executeWorkflowFromChannel() → Workflow Executor → OpenRouter → Channel Response
```

### Key Components

1. **Channel Adapter** (`channel-adapter.ts`) - Manages communication with different channels
2. **OpenRouter Adapter** (`openrouter-adapter.ts`) - Handles all LLM operations through OpenRouter
3. **Enhanced Executor** (`executer.ts`) - Orchestrates workflow execution with channel support
4. **Type Definitions** (`types.ts`) - Extended with channel and OpenRouter types

## Features

### ✅ Channel Integration
- **Multi-channel Support**: Webchat, HTTP, Slack, WhatsApp
- **Automatic Response Routing**: Responses sent back to originating channel
- **Channel Registry**: Centralized management of channel adapters
- **Type-safe Interfaces**: Full TypeScript support for channel operations

### ✅ OpenRouter Integration
- **Automatic LLM Detection**: Identifies nodes requiring LLM processing
- **Fallback Support**: Graceful degradation to free models
- **Tool Integration**: Supports OpenRouter's tool calling capabilities
- **Usage Tracking**: Token usage monitoring and reporting

### ✅ Enhanced Workflow Execution
- **Channel Context**: Channel information flows through execution context
- **Response Handlers**: Built-in response sending capabilities
- **Error Handling**: Comprehensive error handling with channel notifications
- **Security**: Maintains all existing security features

## Usage Examples

### 1. Execute Workflow from Webchat Channel

```typescript
import { executeWorkflowFromChannel } from './executer';
import { ChannelExecutionRequest } from './channel-adapter';

const request: ChannelExecutionRequest = {
  workflowId: 'webchat-assistant',
  workflowDefinition: workflowGraph,
  input: {
    message: 'Hello! How can you help me?',
    userId: 'user123',
    sessionId: 'session456'
  },
  channelId: 'webchat_user123_session456',
  channelType: 'webchat',
  agentId: 'agent789',
  tenantId: 'tenant101',
  originalMessage: {
    type: 'text',
    payload: { text: 'Hello! How can you help me?' },
    userId: 'user123',
    sessionId: 'session456',
    timestamp: new Date().toISOString()
  }
};

const result = await executeWorkflowFromChannel(request);
console.log('Response:', result.finalOutput);
```

### 2. Execute Workflow from HTTP Webhook

```typescript
const httpRequest: ChannelExecutionRequest = {
  workflowId: 'data-processor',
  workflowDefinition: workflowGraph,
  input: {
    payload: { data: 'some data to process' },
    webhookId: 'webhook123'
  },
  channelId: 'webhook123',
  channelType: 'http',
  agentId: 'agent789',
  tenantId: 'tenant101'
};

const result = await executeWorkflowFromChannel(httpRequest);
```

### 3. Custom Channel Adapter

```typescript
import { ChannelAdapter, ChannelRegistry } from './channel-adapter';

class CustomChannelAdapter implements ChannelAdapter {
  name = 'custom';
  
  async send(response: ChannelResponse, context: ChannelSendContext): Promise<void> {
    // Custom implementation
    console.log('Sending to custom channel:', response.text);
  }
  
  isAvailable(): boolean {
    return true;
  }
}

// Register the custom adapter
const registry = ChannelRegistry.getInstance();
registry.registerChannel(new CustomChannelAdapter());
```

## API Reference

### ChannelExecutionRequest

```typescript
interface ChannelExecutionRequest {
  readonly workflowId: string;
  readonly workflowDefinition?: WorkflowGraph;
  readonly input: Record<string, unknown>;
  readonly channelId: string;
  readonly channelType: 'webchat' | 'slack' | 'http' | 'whatsapp';
  readonly agentId: string;
  readonly tenantId: string;
  readonly originalMessage?: ChannelMessage;
}
```

### WorkflowExecutionResult

```typescript
interface WorkflowExecutionResult {
  readonly success: boolean;
  readonly finalOutput: string;
  readonly executionId: string;
  readonly model?: string;
  readonly timestamp: string;
  readonly error?: string;
  readonly executionContext?: Record<string, unknown>;
}
```

### OpenRouterRequest

```typescript
interface OpenRouterRequest {
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly OpenRouterTool[];
  readonly apiKey?: string;
  readonly fallbackModel?: string;
  readonly skipFallback?: boolean;
}
```

## LLM Node Detection

The executor automatically detects nodes that require LLM processing:

```typescript
function isLLMNode(node: GraphNode): boolean {
  return (
    isAgentNode(node) ||
    node.type === 'llm' ||
    node.integration === 'openai' ||
    node.integration === 'anthropic' ||
    node.integration === 'openrouter' ||
    node.config?.requiresLLM === true ||
    node.config?.model !== undefined
  );
}
```

## Channel Registry

The channel registry manages all available channel adapters:

```typescript
// Get registry instance
const registry = ChannelRegistry.getInstance();

// Register a new channel
registry.registerChannel(new CustomChannelAdapter());

// Send response to channel
await registry.sendResponse(
  'webchat',
  'channel123',
  { type: 'text', text: 'Hello!' },
  sendContext
);

// Check if channel is supported
const isSupported = registry.isChannelSupported('webchat');
```

## OpenRouter Configuration

### Free Models Available

- `deepseek/deepseek-chat-v3.1:free`
- `openai/gpt-3.5-turbo`
- `anthropic/claude-3-haiku`
- `meta-llama/llama-3.1-8b-instruct:free`
- `google/gemini-flash-1.5`

### Usage Example

```typescript
const openRouterRequest: OpenRouterRequest = {
  model: 'deepseek/deepseek-chat-v3.1:free',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7,
  maxTokens: 500,
  fallbackModel: 'deepseek/deepseek-chat-v3.1:free'
};

const response = await openRouterAdapter.generate(openRouterRequest, context);
```

## Error Handling

### Channel Errors

```typescript
try {
  await executeWorkflowFromChannel(request);
} catch (error) {
  // Error is automatically sent to channel if possible
  console.error('Workflow execution failed:', error);
}
```

### OpenRouter Errors

```typescript
// Automatic fallback to free models
const response = await openRouterAdapter.generate(request, context);
if (!response.success) {
  console.error('OpenRouter generation failed:', response.error);
}
```

## Security Features

- **Prototype Pollution Protection**: Maintained from original executor
- **Input Validation**: All channel inputs are validated
- **Size Limits**: Enforced on workflow data and responses
- **Execution Timeouts**: Prevents runaway executions
- **Resource Management**: Automatic cleanup of stale executions

## Migration Guide

### From Direct LLM Calls

**Before:**
```typescript
// Direct OpenAI call
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

**After:**
```typescript
// OpenRouter integration
const response = await openRouterAdapter.generate({
  model: 'deepseek/deepseek-chat-v3.1:free',
  messages: [{ role: 'user', content: 'Hello!' }]
}, context);
```

### From Manual Channel Handling

**Before:**
```typescript
// Manual channel response
await webhookServer.sendResponse(userId, response);
```

**After:**
```typescript
// Automatic channel integration
const result = await executeWorkflowFromChannel({
  channelType: 'webchat',
  channelId: userId,
  // ... other properties
});
```

## Testing

### Run Channel Integration Example

```typescript
import { ChannelIntegrationExample } from './examples/channel-integration-example';

const example = new ChannelIntegrationExample();

// Test webchat integration
const result = await example.executeFromWebchat(
  'test-workflow',
  'Hello!',
  'user123',
  'session456',
  'agent789',
  'tenant101'
);

console.log('Result:', result);
```

### Run Complete Example

```typescript
const completeResult = await example.runCompleteExample();
if (completeResult.success) {
  console.log('✅ Channel integration working!');
  console.log('Response:', completeResult.aiResponse);
} else {
  console.log('❌ Error:', completeResult.error);
}
```

## Performance Considerations

- **Concurrent Executions**: Supports up to 10,000 active executions
- **Memory Management**: Automatic cleanup of stale executions
- **Response Caching**: Channel responses are optimized for performance
- **Fallback Strategy**: OpenRouter fallback ensures high availability

## Monitoring & Logging

All operations are logged with comprehensive context:

```typescript
logger.info('Executing workflow from channel', {
  executionId,
  workflowId,
  channelId,
  channelType,
  agentId,
  tenantId
});

logger.info('OpenRouter generation completed', {
  model,
  outputLength,
  executionId,
  usage
});
```

## Future Enhancements

- **Streaming Responses**: Real-time response streaming
- **Channel-specific Templates**: Custom response formatting per channel
- **Advanced Routing**: Intelligent channel selection based on context
- **Analytics Integration**: Detailed usage analytics and reporting

## Support

For issues or questions regarding the channel integration and OpenRouter support:

1. Check the example files in `examples/` directory
2. Review the comprehensive logging output
3. Test with the provided example implementations
4. Verify OpenRouter API key configuration

The implementation maintains full backward compatibility while providing powerful new channel integration capabilities.
