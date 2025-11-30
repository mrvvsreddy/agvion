// path: src/core/workflowrunner/execution/types.ts

import { ExecutionStatus } from '../../../types/context';

/**
 * Required execution context identifiers
 */
export interface RequiredExecutionIdentifiers {
  readonly agentId: string;
  readonly tenantId: string;
}

/**
 * Base execution metadata structure
 */
export interface ExecutionMetadata {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly executionId: string;
  readonly startTime: number;
}

/**
 * Enhanced TypeSafeExecutionContext that includes required IDs and variables
 */
export interface EnhancedTypeSafeExecutionContext extends RequiredExecutionIdentifiers {
  readonly executionId: string; // Direct access to executionId
  readonly startTime: number;   // Direct access to startTime  
  readonly status: 'running' | 'completed' | 'failed'; // Direct access to status
  readonly executionMetadata: ExecutionMetadata;
  readonly nodeData: Record<string, any>;
  readonly variables: Record<string, any>; // Required property that was missing
}

/**
 * Execution context with complete workflow metadata and required IDs
 */
export interface WorkflowExecutionContext extends EnhancedTypeSafeExecutionContext {
  readonly workflowId: string;
  readonly workflowName: string;
  
  // NEW: Channel information
  readonly channelId?: string | undefined;
  readonly channelType?: 'webchat' | 'slack' | 'http' | 'whatsapp' | undefined;
  
  // NEW: Response handler
  readonly sendResponse?: ((data: unknown) => Promise<void>) | undefined;
}

/**
 * Tracks workflow execution progress and metadata with required IDs
 */
export interface WorkflowExecutionTracker extends RequiredExecutionIdentifiers {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly startTime: number;
  readonly status: 'running' | 'completed' | 'failed';
  readonly endTime?: number; // Optional - set when execution completes or fails
}

/**
 * Initial context with required identifiers
 */
export interface RequiredInitialContext extends RequiredExecutionIdentifiers {
  readonly triggerDataInjections?: readonly TriggerDataInjection[];
  
  // NEW: Channel execution support
  readonly channelId?: string;
  readonly channelType?: 'webchat' | 'slack' | 'http' | 'whatsapp';
}

/**
 * Type-safe trigger data injection
 */
export interface TriggerDataInjection {
  readonly nodeName: string;
  readonly nodeId?: string;
  readonly triggerType?: string;
  readonly data: Record<string, unknown>;
}

/**
 * Base metadata for node results
 */
export interface NodeMetadata extends RequiredExecutionIdentifiers {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly executionId: string;
  readonly executionTime: number;
  readonly timestamp: string;
  readonly success: boolean;
  readonly source: 'node-execution' | 'trigger' | 'direct-input';
}

/**
 * Node result with required execution metadata
 * This extends NodeMetadata and allows additional result data
 */
export interface NodeResultWithMetadata extends NodeMetadata {
  readonly [key: string]: unknown; // For result data
}

/**
 * Base metadata for trigger data
 */
export interface TriggerMetadata extends RequiredExecutionIdentifiers {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly executionId: string;
  readonly timestamp: string;
  readonly source: 'trigger';
  readonly triggerType: string;
}

/**
 * Trigger data with required metadata
 * This extends TriggerMetadata and allows additional trigger data
 */
export interface TriggerDataWithMetadata extends TriggerMetadata {
  readonly [key: string]: unknown; // For trigger data
}

/**
 * Enhanced Agent Execution Request with required IDs
 */
export interface EnhancedAgentExecutionRequest {
  readonly node: GraphNode;
  readonly context: EnhancedTypeSafeExecutionContext; // Type-safe context with IDs
  readonly nodeInputs: Record<string, unknown>;
  readonly skipResolution?: boolean;
  readonly agentId: string; // Explicitly required
  readonly tenantId: string; // Explicitly required
}

/**
 * Graph edge definition for workflow connections
 */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | undefined;
  targetHandle?: string | undefined;
}

/**
 * LLM configuration for agent execution
 */
export interface LLMConfig {
  readonly model: string;
  readonly integration?: string;
  readonly provider?: string;
  readonly service?: string;
  readonly apiKey?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly max_tokens?: number;
  readonly function?: string;
  readonly [key: string]: unknown; // Allow additional integration-specific fields
}

/**
 * Memory configuration for agent execution
 */
export interface MemoryConfig {
  type?: string;
  operation?: string[]; // Only support actual array format
  integrationName: string; // Required - the memory integration to use
  maxContextLength?: number;
  maxMessages?: number; // maximum messages to remember
  persistAcrossSessions?: boolean; // whether to persist across workflow executions
  memoryKey?: string; // unique key for memory storage (can contain semantic references)
  sessionId?: string;
  tableName?: string;
  tableId?: string;
  includeSystemPrompts?: boolean;
  credentials?: Record<string, unknown>; // Credentials for the memory integration
  [key: string]: unknown; // Allow any additional memory-specific configuration
}

/**
 * Graph node definition
 */
export interface GraphNode {
  triggerName: string;
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number };
  integration?: string | undefined;
  function?: string | undefined;
  config?: Record<string, any> | undefined;
  disabled?: boolean | undefined;
  metadata?: Record<string, any> | undefined;
  // AI Agent support
  nodeType?: 'integration' | 'agent'; // defaults to 'integration' for backward compatibility
  agentConfig?: AgentNodeConfig; // configuration for agent nodes
  // Per-node credentials for integrations (e.g., { openai: { apiKey: "..." } })
  credentials?: Record<string, any> | undefined;
  // Tool metadata for agent tool discovery
  toolMetadata?: {
    readonly description?: string;
    readonly parameters?: Record<string, { readonly type: string; readonly description?: string; readonly required?: boolean }>;
  };
}

/**
 * Agent node configuration for AI-powered execution
 */
export interface AgentNodeConfig {
  systemPrompt?: string; // agent behavior and instructions
  userPrompt?: string; // user message with semantic references (e.g., $json.nodeName.field)
  llm?: LLMConfig; // LLM provider and model configuration
  memory?: MemoryConfig; // memory configuration
  tools?: ToolsConfig; // tools configuration
}

/**
 * Tools configuration for agent execution
 */
export interface ToolsConfig {
  readonly enabled: boolean;
  readonly maxIterations?: number;
  readonly autoStoreResults?: boolean;
  readonly maxContextLength?: number;
  readonly tools?: readonly unknown[] | undefined;
  readonly definitions?: readonly unknown[] | undefined;
}

/**
 * Workflow graph structure
 */
export interface WorkflowGraph {
  id: string;
  name: string;
  agentId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  version?: string | undefined;
  description?: string | undefined;
  metadata?: {
    version?: string | undefined;
    description?: string | undefined;
    tags?: string[] | undefined;
    created?: string | undefined;
    modified?: string | undefined;
  } | undefined;
}

/**
 * Node execution result with comprehensive metadata
 */
export interface NodeResult {
  json: any;
  binary?: Record<string, any> | undefined;
  metadata: {
    executionId: string;
    nodeId: string;
    startTime: number;
    endTime: number;
    duration: number;
    success: boolean;
    error?: string | undefined;
    // Agent-specific metadata
    agentMetadata?: {
      provider: string;
      model: string;
      toolsUsed: string[];
      toolExecutions: ToolExecution[];
      reasoning: string;
      totalTokens?: number;
    };
  };
}

/**
 * Tool execution information for agent nodes
 */
export interface ToolExecution {
  toolName: string;
  input: any;
  output: any;
  executionTime: number;
  success: boolean;
  error?: string;
}

/**
 * Node execution result for internal use
 */
export interface NodeExecutionResult {
  success: boolean;
  result?: NodeResult | undefined;
  error?: string | undefined;
  duration: number;
}

/**
 * Resolved node inputs after dependency resolution
 */
export interface ResolvedNodeInputs {
  config?: Record<string, any> | undefined;
  dependencies?: Record<string, any> | undefined;
  [key: string]: any;
}

/**
 * Graph execution options
 */
export interface GraphExecutionOptions {
  maxConcurrency?: number | undefined;
  timeout?: number | undefined;
  continueOnError?: boolean | undefined;
  retryAttempts?: number | undefined;
  retryDelay?: number | undefined;
  debugMode?: boolean | undefined;
}

/**
 * Default execution options
 */
export const DEFAULT_EXECUTION_OPTIONS: Required<GraphExecutionOptions> = {
  maxConcurrency: 5,
  timeout: 0, // No timeout - unlimited execution time
  continueOnError: false,
  retryAttempts: 0,
  retryDelay: 1000,
  debugMode: false
};

/**
 * Execution isolation tracking for monitoring
 */
export interface ExecutionIsolation {
  executionId: string;
  workflowId: string;
  agentId: string;
  messageId: string;
  startTime: number;
  endTime?: number | undefined;
  status: ExecutionStatus;
  totalNodes: number;
  completedNodes: number;
  failedNodes: string[];
  currentNode?: string | undefined;
}

/**
 * Node metrics for execution reporting
 */
export interface NodeMetrics {
  nodeId: string;
  nodeName: string;
  duration: number;
  success: boolean;
  error?: string | undefined;
}

/**
 * Execution metrics for comprehensive reporting
 */
export interface ExecutionMetrics {
  executionId: string;
  workflowId: string;
  agentId: string;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  totalDuration: number;
  averageNodeDuration: number;
  successRate: number;
  status: 'completed' | 'failed';
  failurePoint?: string | undefined;
  startTime: string;
  endTime: string;
  nodeMetrics: NodeMetrics[];
}

/**
 * Dependency map structure for execution planning
 */
export interface DependencyMap {
  [nodeId: string]: {
    dependencies: string[];
    dependents: string[];
  };
}

/**
 * Execution plan structure
 */
export interface ExecutionPlan {
  entryNodes: string[];
  executionOrder: string[][];
  dependencyMap: DependencyMap;
  totalNodes: number;
}

/**
 * Base validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Node-specific validation result
 */
export interface NodeValidationResult extends ValidationResult {
  nodeId: string;
  nodeName: string;
  // Agent-specific validation
  agentValidation?: {
    providerConfigured: boolean;
    toolsAvailable: string[];
    toolsMissing: string[];
    configValid: boolean;
  };
}

/**
 * Graph validation result with cycle detection
 */
export interface GraphValidationResult extends ValidationResult {
  nodeValidations: NodeValidationResult[];
  hasCycles: boolean;
  cycles?: string[][] | undefined;
}

/**
 * Workflow schema after validation
 */
export interface WorkflowSchema {
  graph: WorkflowGraph;
  validationResult: GraphValidationResult;
  executionPlan: ExecutionPlan;
}

/**
 * Workflow execution validation result
 */
export interface WorkflowExecutionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Reserved node types for special workflow functions
 */
export const RESERVED_NODE_TYPES = [
  'trigger',
  'webhook',
  'schedule',
  'manual',
  'start',
  'end',
] as const;

export type ReservedNodeType = typeof RESERVED_NODE_TYPES[number];

/**
 * Graph validation error
 */
export class GraphValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
    public readonly nodeId?: string | undefined
  ) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

/**
 * Node execution error
 */
export class NodeExecutionError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly originalError?: Error | undefined
  ) {
    super(message);
    this.name = 'NodeExecutionError';
  }
}

/**
 * Circular dependency error
 */
export class CircularDependencyError extends Error {
  constructor(
    message: string,
    public readonly cycles: string[][]
  ) {
    super(message);
    this.name = 'CircularDependencyError';
  }
}

/**
 * Type guard for GraphNode
 */
export function isGraphNode(obj: any): obj is GraphNode {
  return obj && 
         typeof obj === 'object' &&
         typeof obj.id === 'string' &&
         typeof obj.name === 'string' &&
         typeof obj.type === 'string';
}

/**
 * Type guard for GraphEdge
 */
export function isGraphEdge(obj: any): obj is GraphEdge {
  return obj &&
         typeof obj === 'object' &&
         typeof obj.id === 'string' &&
         typeof obj.source === 'string' &&
         typeof obj.target === 'string';
}

/**
 * Type guard for NodeResult
 */
export function isNodeResult(value: any): value is NodeResult {
  return (
    value &&
    typeof value === 'object' &&
    'json' in value &&
    'metadata' in value &&
    typeof value.metadata === 'object' &&
    'executionId' in value.metadata &&
    'nodeId' in value.metadata &&
    'success' in value.metadata &&
    typeof value.metadata.success === 'boolean'
  );
}

/**
 * Type guard for agent nodes
 */
export function isAgentNode(node: GraphNode): boolean {
  return node.nodeType === 'agent' || Boolean(node.agentConfig);
}

/**
 * Type guard for integration nodes
 */
export function isIntegrationNode(node: GraphNode): boolean {
  return node.nodeType === 'integration' || (!node.nodeType && Boolean(node.integration && node.function));
}

/**
 * Get node type with backward compatibility
 */
export function getNodeType(node: GraphNode): 'integration' | 'agent' {
  if (isAgentNode(node)) return 'agent';
  return 'integration';
}

/**
 * Secure secret reference interface
 */
export interface SecretReference {
  readonly secretId: string;
  readonly tenantId: string;
  readonly type: 'api_key' | 'password' | 'token' | 'credential';
}

/**
 * Safe execution error with separate internal and user messages
 */
export class SafeExecutionError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly internalDetails: string,
    public readonly executionId: string,
    public readonly nodeId?: string
  ) {
    super(userMessage);
    this.name = 'SafeExecutionError';
  }
}

/**
 * Audit event interface for security monitoring
 */
export interface AuditEvent {
  readonly eventType: string;
  readonly timestamp: string;
  readonly executionId: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly details: Record<string, unknown>;
  readonly signature: string;
}

/**
 * Validated agent configuration interface
 */
export interface ValidatedAgentConfig {
  readonly systemPrompt?: string;
  readonly userPrompt?: string;
  readonly llm?: ValidatedLLMConfig;
  readonly tools?: readonly string[];
}

/**
 * Validated LLM configuration interface
 */
export interface ValidatedLLMConfig {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly secretRef?: SecretReference;
}

/**
 * Type guard for validated agent configuration
 */
export function isValidAgentConfig(config: unknown): config is ValidatedAgentConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }
  
  const agentConfig = config as Record<string, unknown>;
  
  // Check required fields
  if (!agentConfig.systemPrompt && !agentConfig.userPrompt) {
    return false;
  }
  
  // Validate system prompt
  if (agentConfig.systemPrompt && typeof agentConfig.systemPrompt !== 'string') {
    return false;
  }
  
  // Validate user prompt
  if (agentConfig.userPrompt && typeof agentConfig.userPrompt !== 'string') {
    return false;
  }
  
  // Validate LLM config if present
  if (agentConfig.llm && typeof agentConfig.llm === 'object' && agentConfig.llm !== null) {
    const llm = agentConfig.llm as Record<string, unknown>;
    if (typeof llm.model !== 'string' || typeof llm.temperature !== 'number' || typeof llm.maxTokens !== 'number') {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate agent node configuration
 */
export function validateAgentConfig(node: GraphNode): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!node.agentConfig) {
    errors.push(`Agent node ${node.id} missing agentConfig`);
    return { isValid: false, errors, warnings };
  }

  const config = node.agentConfig;

  if (!config.systemPrompt || typeof config.systemPrompt !== 'string') {
    errors.push(`Agent node ${node.id} missing systemPrompt`);
  }

  if (!config.userPrompt || typeof config.userPrompt !== 'string') {
    errors.push(`Agent node ${node.id} missing userPrompt`);
  }

  if (!config.llm || typeof config.llm !== 'object') {
    errors.push(`Agent node ${node.id} missing llm configuration`);
  } else {
    const llm = config.llm;
    if (!llm.provider || typeof llm.provider !== 'string') {
      errors.push(`Agent node ${node.id} missing llm.provider`);
    }
    if (!llm.model || typeof llm.model !== 'string') {
      errors.push(`Agent node ${node.id} missing llm.model`);
    }
    if (llm.temperature !== undefined && (typeof llm.temperature !== 'number' || llm.temperature < 0 || llm.temperature > 2)) {
      errors.push(`Agent node ${node.id} llm.temperature must be between 0 and 2`);
    }
    // Allow unlimited maxTokens - no restrictions
    if (llm.maxTokens !== undefined && typeof llm.maxTokens !== 'number') {
      errors.push(`Agent node ${node.id} llm.maxTokens must be a number`);
    }
    // Allow unlimited timeout - no restrictions
    if (llm.timeout !== undefined && typeof llm.timeout !== 'number') {
      errors.push(`Agent node ${node.id} llm.timeout must be a number`);
    }
  }

  if (config.memory && typeof config.memory === 'object') {
    const memory = config.memory;
    if (!memory.type || !['conversation', 'session', 'none'].includes(memory.type)) {
      errors.push(`Agent node ${node.id} memory.type must be 'conversation', 'session', or 'none'`);
    }
    if (memory.maxMessages !== undefined && (typeof memory.maxMessages !== 'number' || memory.maxMessages <= 0)) {
      errors.push(`Agent node ${node.id} memory.maxMessages must be positive`);
    }
  }

  if (config.tools && !Array.isArray(config.tools)) {
    errors.push(`Agent node ${node.id} tools must be an array`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}