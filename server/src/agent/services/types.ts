// path: agent/services/types.ts

export interface KnowledgeUploadInput {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
  knowledgeBaseId: string; // uuid
  agentId: string;
  tenantId: string;
}

export interface KnowledgeUploadResult {
  fileId: string;
  fileName: string;
  chunkCount: number;
  contentLength: number;
  status: 'success';
}

export interface KnowledgeEditInput {
  fileId: string;
  newContent: string;
  agentId: string;
  tenantId: string;
}

export interface KnowledgeEditResult {
  chunkCount: number;
}

export interface KnowledgeSearchInput {
  query: string;
  knowledgeBaseId: string;
  agentId: string;
  tenantId: string;
  fileNames?: string[];
  limit?: number;
  threshold?: number;
}

export interface KnowledgeSearchResultItem {
  chunk_id: string;
  chunk_text: string;
  similarity: number;
  file_id: string;
  file_name: string;
  file_type: string;
  chunk_index: number;
  metadata: Record<string, any>;
}

import { ExecutionContext } from '../../types/context';

// ============================================================================
// WORKFLOW EXECUTION TYPES (Based on executer.ts pattern)
// ============================================================================

export interface WorkflowNode {
  readonly id: string;
  readonly name: string;
  readonly type: 'trigger' | 'ai_agent' | 'action' | 'tool';
  readonly triggerName?: string;
  readonly nodeType?: string;
  readonly integration?: string | undefined;
  readonly function?: string | undefined;
  readonly position: { readonly x: number; readonly y: number };
  readonly disabled?: boolean;
  readonly config?: Record<string, unknown>;
  readonly agentConfig?: AgentNodeConfig;
  readonly credentials?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface WorkflowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type?: string | undefined;
}

export interface WorkflowGraph {
  readonly id: string;
  readonly name: string;
  readonly agentId: string;
  readonly tenantId?: string;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// AGENT NODE CONFIGURATION
// ============================================================================

export interface AgentNodeConfig {
  readonly llm: {
    readonly model: string;
    readonly provider: string;
    readonly integration: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly credentials?: Record<string, unknown>;
  };
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly tools?: {
    readonly enabled: boolean;
    readonly maxIterations?: number;
    readonly tools?: readonly ToolDescription[];
  };
}

export interface ToolDescription {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: string;
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

// ============================================================================
// EXECUTION CONTEXT & TRACKING
// ============================================================================

export interface WorkflowExecutionContext extends ExecutionContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly startTime: number;
  readonly status: 'running' | 'completed' | 'failed';
  readonly nodeData: Record<string, unknown>;
  readonly variables: Record<string, unknown>;
  readonly executionMetadata: ExecutionMetadata;
}

export interface ExecutionMetadata {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly startTime: number;
}

export interface WorkflowExecutionTracker {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly startTime: number;
  readonly status: 'running' | 'completed' | 'failed';
}

// ============================================================================
// NODE EXECUTION RESULTS
// ============================================================================

export interface NodeExecutionResult {
  readonly success: boolean;
  readonly result?: NodeResult;
  readonly error?: string;
  readonly duration: number;
}

export interface NodeResult {
  readonly json: Record<string, unknown>;
  readonly binary?: unknown;
}

export interface NodeResultWithMetadata extends NodeResult {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly executionTime: number;
  readonly timestamp: string;
  readonly success: boolean;
  readonly source: string;
}

// ============================================================================
// TRIGGER DATA INJECTION
// ============================================================================

export interface TriggerDataInjection {
  readonly nodeId?: string;
  readonly nodeName: string;
  readonly triggerType: string;
  readonly data: Record<string, unknown>;
}

export interface TriggerDataWithMetadata extends Record<string, unknown> {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly timestamp: string;
  readonly source: string;
  readonly triggerType: string;
}

// ============================================================================
// CHANNEL INTEGRATION TYPES
// ============================================================================

export interface ChannelMessage {
  readonly type: 'text' | 'image' | 'audio' | 'video' | 'file' | 'location';
  readonly payload: {
    readonly text?: string;
    readonly url?: string;
    readonly mimeType?: string;
  };
  readonly userId: string;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly msgId?: string;
}

export interface ChannelResponse {
  readonly type: 'text';
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly processMessage: (message: ChannelMessage, context: WorkflowExecutionContext) => Promise<ChannelResponse>;
  readonly sendResponse: (response: ChannelResponse, context: WorkflowExecutionContext) => Promise<void>;
}

// ============================================================================
// LLM INTEGRATION TYPES
// ============================================================================

export interface LLMRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly model: string;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly tools?: readonly ToolDescription[] | undefined;
  readonly credentials?: Record<string, unknown> | undefined;
}

export interface LLMResponse {
  readonly output: string;
  readonly model: string;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  } | undefined;
  readonly timestamp: string;
  readonly success: boolean;
}

export interface LLMAdapter {
  readonly name: string;
  readonly generate: (request: LLMRequest, context: WorkflowExecutionContext) => Promise<LLMResponse>;
}

// ============================================================================
// WORKFLOW DEFINITION (Legacy compatibility)
// ============================================================================

export interface IntegrationData extends Record<string, unknown> {
  readonly label: string;
  readonly event?: string;
  readonly filters?: {
    readonly messageType?: string[];
    readonly excludeBots?: boolean;
  };
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly userPrompt?: string;
  readonly tools?: Array<{
    readonly name: string;
    readonly description: string;
    readonly integration: string;
    readonly parameters: {
      readonly query: string;
      readonly topK: number;
      readonly minScore: number;
      readonly collection: string;
    };
  }>;
  readonly memory?: {
    readonly enabled: boolean;
    readonly type: string;
    readonly windowSize: number;
    readonly sessionKey: string;
    readonly storage: string;
    readonly ttl: number;
  };
  readonly action?: string;
  readonly to?: string;
  readonly text?: string;
  readonly replyTo?: string;
  readonly sourceNode?: string;
  readonly responseType?: 'text' | 'json' | 'custom';
  readonly includeMetadata?: boolean;
}

export interface WorkflowIntegration {
  readonly id: string;
  readonly name: string;
  readonly type: 'trigger' | 'ai_agent' | 'action';
  readonly integration: string;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly data: IntegrationData;
  readonly function?: string;
}

export interface FlowDefinition {
  readonly trigger: {
    readonly type: 'webhook' | 'whatsapp' | 'slack' | 'webchat';
    readonly channel: string;
    readonly config?: {
      readonly auto_respond?: boolean;
      readonly wait_for_agent?: boolean;
      readonly [key: string]: unknown;
    };
  };
  readonly workflow: {
    readonly id?: string;
    readonly name?: string;
    readonly integrations: readonly WorkflowIntegration[];
    readonly edges: readonly WorkflowEdge[];
    readonly variables?: Record<string, string>;
  };
  readonly prompt: {
    readonly model: string;
    readonly system_prompt: string;
    readonly user_prompt_template?: string;
    readonly max_tokens?: number;
    readonly temperature?: number;
  };
  readonly credentials?: {
    readonly api_keys?: Record<string, string>;
    readonly webhook_secrets?: Record<string, string>;
    readonly webchat_secrets?: Record<string, string>;
    readonly memory?: {
      readonly integrationName: string;
      readonly tableName: string;
      readonly sessionId: string;
      readonly operation: string[];
      readonly type: string;
    };
    readonly tools?: {
      readonly enabled: boolean;
      readonly maxIterations: number;
      readonly tools: any[];
    };
  };
  readonly sanitization?: {
    readonly input_validation?: {
      readonly max_length: number;
      readonly allowed_characters: string;
    };
    readonly output_validation?: {
      readonly max_length: number;
    };
    readonly allowed_actions?: string[];
  };
}

// ============================================================================
// SERVICE RESPONSE TYPES
// ============================================================================

export interface CreateFlowRequest {
  readonly agentId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description?: string;
  readonly workflow_data: FlowDefinition | WorkflowGraph;
  readonly isDefault?: boolean;
}

export interface CreateFlowResponse {
  readonly success: boolean;
  readonly flow?: {
    readonly id: string;
    readonly agent_id: string;
    readonly tenant_id: string;
    readonly name: string;
    readonly description: string | null;
    readonly is_default: boolean;
    readonly workflow_data: FlowDefinition;
    readonly version: number;
    readonly status: string;
    readonly created_at: string;
    readonly updated_at: string;
  };
  readonly message?: string;
}

export interface GetFlowsResponse {
  readonly success: boolean;
  readonly flows?: Array<{
    readonly id: string;
    readonly agent_id: string;
    readonly tenant_id: string;
    readonly name: string;
    readonly description: string | null;
    readonly is_default: boolean;
    readonly workflow_data: FlowDefinition;
    readonly version: number;
    readonly status: string;
    readonly created_at: string;
    readonly updated_at: string;
  }>;
  readonly message?: string;
}

export interface ProcessWebhookResponse {
  readonly success: boolean;
  readonly response?: {
    readonly response: string;
    readonly finalOutput: string;
    readonly model: string;
    readonly timestamp: string;
    readonly executionContext: Record<string, unknown>;
    readonly error?: string;
  };
  readonly message?: string;
}
