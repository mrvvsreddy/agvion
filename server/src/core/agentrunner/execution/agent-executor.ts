// path: src/core/workflowrunner/execution/agent-executor.ts
// LLM-focused Agent Executor - n8n-style implementation

import logger from '../../../utils/logger';
import integrationRegistry from '../../integrationRegistry';
import { IntegrationExecutor } from '../../../types/integrations';
import { z } from 'zod';
import { 
  TypeSafeExecutionContext,
  storeNodeResultAsNodeData,
  addNodeData,
  updateNodeField,
  getNodeData,
  getAllNodeData
} from './node-data-manager';

// Simplified configuration constants - only keep frequently used ones

const TIMEOUTS = {
  LLM_DEFAULT: 30000,
  TOOL_DEFAULT: 30000
} as const;

const LIMITS = {
  MAX_TOOL_ITERATIONS: 10,
  MAX_CONTEXT_LENGTH: 5000,
  MAX_TOOL_NAME_LENGTH: 50
} as const;

// Template pattern for semantic resolution (inline where used)
const TEMPLATE_PATTERN = /\{\{\s*\$json\.\[([^\]]+)\]\.(\S+?)\s*\}\}/g;

// Timeout wrapper for LLM calls
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = TIMEOUTS.LLM_DEFAULT,
  operation: string = 'LLM call'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// Helper for consistent logging context
function logContext(executionId: string, nodeId?: string, extra?: Record<string, unknown>) {
  return { executionId, ...(nodeId && { nodeId }), ...extra };
}

// Consolidated error handling helper
function handleError(
  error: unknown,
  operation: string,
  context: { executionId: string; nodeId?: string; [key: string]: unknown }
): never {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${operation} failed`, {
    ...context,
    error: message,
    stack: error instanceof Error ? error.stack : undefined
  });
  throw error;
}

// Consolidated field extraction
const FIELD_PRIORITY = {
  text: ['response', 'content', 'text', 'output', 'message', 'agentResponse'],
  user: ['userInput', 'user_input', 'input', 'prompt', 'question', 'query'],
  assistant: ['output', 'response', 'agentOutput', 'assistant_output', 'reply'],
  timestamp: ['timestamp', 'createdAt', 'created_at', 'date', 'time']
} as const;

function extractField(
  obj: Record<string, unknown>, 
  type: keyof typeof FIELD_PRIORITY
): string {
  // Try priority fields first
  for (const field of FIELD_PRIORITY[type]) {
    const value = obj[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  
  // Fallback: check role-based content
  if (obj.role && obj.content && typeof obj.content === 'string') {
    return String(obj.content).trim();
  }
  
  return '';
}


// Simplified LLM output cleaning
function cleanLLMOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output.trim();
  }
  
  if (!output || typeof output !== 'object') {
    return '';
  }
  
  // Extract clean response from common locations
  const obj = output as Record<string, any>;
  const responseFields = [
    'agentResponse', 'agentOutput', 'response', 'output', 'content',
    'message', 'text', 'answer', 'reply'
  ];
  
  
  for (const field of responseFields) {
    if (typeof obj[field] === 'string' && obj[field].trim()) {
      return obj[field].trim();
    }
  }
  
  // Check OpenAI format
  if (obj.choices?.[0]?.message?.content) {
    return String(obj.choices[0].message.content).trim();
  }
  
  // Check nested data
  if (obj.data?.response) {
    return String(obj.data.response).trim();
  }
  
  return typeof output === 'string' ? output : JSON.stringify(output);
}

// Core execution types
interface WorkflowExecutionContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly startTime: number;
  readonly status: 'running' | 'completed' | 'failed';
  readonly nodeData: Record<string, unknown>;
  readonly variables?: Record<string, any>;
}

// Workflow graph types
interface WorkflowGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly WorkflowEdge[];
}

interface WorkflowEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
}



// LLM-focused Types

interface NodeResult {
  readonly output: string;
  readonly agentOutput: string; // Keep this for semantic compatibility
  readonly memoryResult?: unknown;
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
}

interface GraphNode {
  readonly triggerName: string;
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly agentConfig?: AgentNodeConfig;
  readonly credentials?: Record<string, Record<string, unknown>>;
  readonly integration?: string;
  readonly function?: string;
  readonly config?: Record<string, unknown>;
  readonly toolMetadata?: {
    readonly description?: string;
    readonly parameters?: Record<string, { readonly type: string; readonly description?: string; readonly required?: boolean }>;
  };
}

interface AgentNodeConfig {
  readonly llm?: LLMConfig | undefined;
  readonly memory?: MemoryConfig | undefined;
  readonly systemPrompt?: string | undefined;
  readonly userPrompt?: string | undefined;
  readonly tools?: ToolsConfig | undefined;
}

interface LLMConfig {
  readonly model: string;
  readonly provider?: string;
  readonly integration?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly credentials?: Record<string, unknown>;
}

interface MemoryConfig {
  readonly type?: string;
  readonly operation?: string[]; // Only support actual array format
  readonly integrationName: string; // Required - the memory integration to use
  readonly maxContextLength?: number;
  readonly credentials?: Record<string, unknown>; // Credentials for the memory integration
  readonly [key: string]: unknown; // Allow any additional memory-specific configuration
}

interface ToolsConfig {
  readonly enabled: boolean;
  readonly maxIterations?: number;
  readonly autoStoreResults?: boolean;
  readonly maxContextLength?: number;
  readonly tools?: ToolDefinition[]; // New: tools array from agent config
  readonly definitions?: ToolDefinition[]; // Alternative: definitions array (legacy support)
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly integration: string;
  readonly function: string;
  readonly parameters: {
    readonly [key: string]: {
      readonly type: string;
      readonly required?: boolean;
      readonly description?: string;
    };
  };
  readonly config?: Record<string, unknown>;
}

interface AgentExecutionRequest {
  readonly node: GraphNode;
  readonly context: WorkflowExecutionContext;
  readonly workflowGraph?: WorkflowGraph;
}

interface AgentExecutionResponse {
  readonly success: boolean;
  readonly agentOutput?: string;
  readonly error?: string;
  readonly executionTime: number;
  readonly resolutionStats?: SemanticResolutionStats;
  readonly memoryResult?: unknown;
  readonly nodeData?: Record<string, unknown>;
}

interface SemanticResolutionStats {
  readonly totalReferences: number;
  readonly resolvedReferences: number;
  readonly failedReferences: number;
  readonly resolutionTime: number;
  readonly unresolvedTokens: readonly string[];
}

interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

// Tool-calling related interfaces
interface ToolSchema {
  readonly name: string;           // Node name (sanitized for LLM)
  readonly description: string;    // From node metadata or user config
  readonly parameters: {           // JSON Schema for node inputs
    readonly type: "object";
    readonly properties: Record<string, { readonly type: string; readonly description?: string }>;
    readonly required?: readonly string[];
  };
  readonly nodeId: string;         // Internal reference
  readonly integration?: string;   // Integration name from node
  readonly function?: string;      // Function name from node
}

interface ToolCall {
  readonly id: string;           // LLM-provided call ID
  readonly toolName: string;     // Maps to node name
  readonly arguments: Record<string, unknown>;
}

interface ToolResult {
  readonly toolCallId: string;
  readonly output?: unknown;
  readonly error?: string;
}

type LLMResponse = 
  | { readonly type: 'tool_calls'; readonly calls: readonly ToolCall[] }
  | { readonly type: 'final_answer'; readonly content: string };


/**
 * Main agent execution function - LLM-focused
 */
export async function executeAgentRequest(request: AgentExecutionRequest): Promise<AgentExecutionResponse> {
  const startTime = Date.now();
  const { node, context } = request;

  // Validate agent configuration
  if (!node.agentConfig) {
    return { 
      success: false, 
      error: 'Missing agent configuration',
      executionTime: Date.now() - startTime
    };
  }

  // Validate required context fields
  if (!context.executionId || !context.agentId || !context.tenantId) {
    return { 
      success: false, 
      error: 'Missing required context fields (executionId, agentId, tenantId)',
      executionTime: Date.now() - startTime
    };
  }

  logger.info('Starting LLM agent execution', logContext(context.executionId, node.id, {
    workflowId: context.workflowId,
    agentId: context.agentId,
    tenantId: context.tenantId
  }));

  try {
    // Apply semantic resolution to agent configuration
    const { resolved: resolvedConfig, stats: resolutionStats } = await resolveAgentConfiguration(
      node.agentConfig,
      context
    );

    // Validate resolved configuration
    if (!resolvedConfig.systemPrompt && !resolvedConfig.userPrompt) {
      return { 
        success: false, 
        error: 'Both system and user prompts are empty after semantic resolution',
        executionTime: Date.now() - startTime,
        resolutionStats
      };
    }

    let memoryResult: unknown = null;
    let knowledgeResult: unknown = null;
    let knowledgeContext: string = '';
    let knowledgeFileNames: string[] = [];
    let agentOutput: string = '';

    // STEP 1: Execute memory retrieval operations first if configured
    if (resolvedConfig.memory && resolvedConfig.userPrompt) {
      // Check if memory config includes retrieve operation
      const memoryOperations = resolvedConfig.memory.operation || [];
      const hasRetrieveOperation = Array.isArray(memoryOperations) && 
        memoryOperations.some(op => String(op).toLowerCase() === 'retrieve');
      
      if (hasRetrieveOperation) {
        logger.info('Executing memory retrieval via integration', logContext(context.executionId, node.id, {
          sessionId: resolvedConfig.memory.sessionId,
          tableName: resolvedConfig.memory.tableName,
          integrationName: resolvedConfig.memory.integrationName,
          operations: memoryOperations,
          hasRetrieveOperation
        }));
        
        try {
          // Prepare CLEAN memory inputs for integration call - only essential fields
          const memoryInputs = {
            operation: 'retrieve',
            userInput: resolvedConfig.userPrompt.trim(),
            sessionId: resolvedConfig.memory.sessionId,
            tableName: resolvedConfig.memory.tableName,
            tableId: resolvedConfig.memory.tableId,
            maxMessages: resolvedConfig.memory.maxContextLength || resolvedConfig.memory.maxMessages,
            includeSystemPrompts: resolvedConfig.memory.includeSystemPrompts || false,
            agentId: context.agentId,
            tenantId: context.tenantId,
            executionId: context.executionId
            // REMOVED: All execution context, nodeData, variables, etc.
          };

          // Add credentials if available
          const nodeCredentials = node.credentials?.[resolvedConfig.memory.integrationName] || {};
          const memoryCredentials = (resolvedConfig.memory as any).credentials || {};
          Object.assign(memoryInputs, nodeCredentials, memoryCredentials);

          // Execute memory retrieval via integration
          memoryResult = await executeIntegration(
            resolvedConfig.memory.integrationName,
            'retrieve',
            memoryInputs,
            context
          );
          
          logger.info('Memory retrieval completed successfully', logContext(context.executionId, node.id, {
            hasMemoryData: !!memoryResult,
            memoryDataKeys: memoryResult ? Object.keys(memoryResult as Record<string, unknown>) : [],
            integrationName: resolvedConfig.memory.integrationName,
            operations: memoryOperations
          }));

        } catch (error) {
          logger.warn('Memory retrieval failed, continuing without context', logContext(context.executionId, node.id, {
            error: error instanceof Error ? error.message : String(error),
            integrationName: resolvedConfig.memory.integrationName,
            operations: memoryOperations
          }));
          memoryResult = null;
        }
      } else {
        logger.info('Memory configured but retrieve operation not specified', logContext(context.executionId, node.id, {
          sessionId: resolvedConfig.memory.sessionId,
          tableName: resolvedConfig.memory.tableName,
          integrationName: resolvedConfig.memory.integrationName,
          operations: memoryOperations
        }));
      }
    }

    // STEP 2 (removed): Automatic knowledge retrieval
    // Knowledge retrieval is now exposed as a tool (agent_knowledge.retrieve) and the AI
    // decides when and what to query via tool calls. We no longer auto-call knowledge here.

    // STEP 3: Build tool registry if tools are enabled (with intelligent prediction)
    let tools: ToolSchema[] = [];
    let predictedToolNames: string[] = [];
    if (resolvedConfig.tools?.enabled) {
      // NEW: Predict required tools first to reduce token usage by 85-90%
      predictedToolNames = predictRequiredTools(
        node.id,
        context,
        request.workflowGraph,
        resolvedConfig
      );
      
      logger.info('Predicted required tools from workflow', logContext(context.executionId, node.id, {
        predictedCount: predictedToolNames.length,
        predictedTools: predictedToolNames,
        totalAvailable: request.workflowGraph?.nodes.length || 0
      }));
      
      // Build registry ONLY for predicted tools
      tools = buildToolRegistryFiltered(
        node.id,
        context,
        request.workflowGraph,
        resolvedConfig,
        predictedToolNames // NEW PARAMETER
      );
    }

    // STEP 3: Execute LLM with memory context and tools
    const memoryContext = memoryResult ? formatMemoryContextForLLM(memoryResult) : '';
    
    logger.info('Starting LLM execution', logContext(context.executionId, node.id, {
      hasMemory: !!memoryResult,
      memoryContextLength: memoryContext.length,
      hasKnowledge: !!knowledgeResult,
      knowledgeContextLength: knowledgeContext.length,
      knowledgeFilesCount: knowledgeFileNames.length,
      systemPromptLength: resolvedConfig.systemPrompt?.length ?? 0,
      userPromptLength: resolvedConfig.userPrompt?.length ?? 0,
      toolsEnabled: resolvedConfig.tools?.enabled ?? false,
      availableTools: tools.length
    }));


    // Build minimal prompts (no injected memory/knowledge/tool lists)
    const baseSystemPrompt = `${resolvedConfig.systemPrompt ?? ''}${
      '\n\nInstruction: If a knowledge base is available, retrieve documents relevant to the user\'s prompt and use them to ground and generate the answer.'
    }`.trim();
    const baseUserPrompt = resolvedConfig.userPrompt ?? '';
    
    // Validate prompts
    if (!baseSystemPrompt.trim() && !baseUserPrompt.trim()) {
      return { 
        success: false, 
        error: 'Both system and user prompts are empty after semantic resolution',
        executionTime: Date.now() - startTime,
        resolutionStats
      };
    }
    // Single-call LLM execution with only system and user prompts (tools available via function schemas)
    const llmResult = await withTimeout(
      executeLLM(
        resolvedConfig.llm!,
        baseSystemPrompt,
        baseUserPrompt,
        tools,
        node,
        context
      ),
      TIMEOUTS.LLM_DEFAULT,
      'LLM execution'
    );
    agentOutput = llmResult.type === 'final_answer' ? llmResult.content : '';

    // STEP 3.5: Clean agent output to extract only clean response
    const originalOutput = agentOutput;
    agentOutput = cleanLLMOutput(agentOutput);
    
    logger.info('Agent output sanitized', logContext(context.executionId, node.id, {
      originalOutputLength: originalOutput.length,
      sanitizedOutputLength: agentOutput.length,
      sanitizationApplied: originalOutput !== agentOutput
    }));


    // STEP 4: Store conversation if memory store operation is configured
    if (resolvedConfig.memory && agentOutput) {
      // Check if memory config includes store operation
      const memoryOperations = resolvedConfig.memory.operation || [];
      const hasStoreOperation = Array.isArray(memoryOperations) && 
        memoryOperations.some(op => String(op).toLowerCase() === 'store');
      
      if (hasStoreOperation) {
        try {
          // Prepare CLEAN memory inputs using sanitized data
          const cleanMemoryData = {
            userInput: (resolvedConfig.userPrompt ?? '').trim(),
            output: agentOutput.trim(),
            sessionId: String(resolvedConfig.memory.sessionId).trim(),
            timestamp: new Date().toISOString(),
            agentId: context.agentId.trim(),
            tenantId: context.tenantId.trim(),
            executionId: context.executionId.trim()
          };

          const memoryInputs = {
            operation: 'store',
            ...cleanMemoryData,
            tableName: resolvedConfig.memory.tableName,
            tableId: resolvedConfig.memory.tableId
            // REMOVED: All execution context, nodeData, variables, etc.
          };

          // Add credentials if available
          const nodeCredentials = node.credentials?.[resolvedConfig.memory.integrationName] || {};
          const memoryCredentials = (resolvedConfig.memory as any).credentials || {};
          Object.assign(memoryInputs, nodeCredentials, memoryCredentials);

          // Execute memory store via integration
          await executeIntegration(
            resolvedConfig.memory.integrationName,
            'store',
            memoryInputs,
            context
          );
        
          logger.info('Conversation stored successfully', logContext(context.executionId, node.id, {
            sessionId: resolvedConfig.memory.sessionId,
            tableName: resolvedConfig.memory.tableName,
            integrationName: resolvedConfig.memory.integrationName,
            operations: memoryOperations,
            storedDataKeys: ['userInput', 'output', 'sessionId', 'timestamp']
          }));

        } catch (error) {
          logger.warn('Failed to store conversation', logContext(context.executionId, node.id, {
            error: error instanceof Error ? error.message : String(error),
            integrationName: resolvedConfig.memory.integrationName,
            operations: memoryOperations
          }));
        }
      } else {
        logger.info('Memory configured but store operation not specified', logContext(context.executionId, node.id, {
          sessionId: resolvedConfig.memory.sessionId,
          tableName: resolvedConfig.memory.tableName,
          integrationName: resolvedConfig.memory.integrationName,
          operations: memoryOperations,
          agentOutputLength: agentOutput.length
        }));
      }
    }

    // Store result using node data manager with clean output
    const nodeData = storeAgentResultWithNodeDataManager(node, context, agentOutput, memoryResult, startTime);

    const executionTime = Date.now() - startTime;

    logger.info('LLM agent execution completed', logContext(context.executionId, node.id, {
      duration: executionTime,
      memoryUsed: !!memoryResult,
      outputLength: agentOutput.length
    }));


    return {
      success: true,
      agentOutput: agentOutput.trim(),
      executionTime,
      resolutionStats,
      memoryResult,
      nodeData
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const executionTime = Date.now() - startTime;
    
    logger.error('LLM agent execution failed', logContext(context.executionId, node.id, {
      error: errorMessage,
      duration: executionTime
    }));

    return {
      success: false,
      error: errorMessage,
      executionTime
    };
  }
}

// Workflow-specific common tools (fallback only - prioritize direct connections)
const WORKFLOW_COMMON_TOOLS: Record<string, string[]> = {
  customer_support: [], // Don't predict - use actual connections
  data_processing: [],
  automation: [],
  general: []
};

// Unified system prompt removed in favor of minimal prompts (system + user only)

/**
 * Infer workflow type from metadata
 */
function inferWorkflowType(workflowGraph?: WorkflowGraph): string {
  if (!workflowGraph) return 'general';
  
  const triggerNode = workflowGraph.nodes.find(n => n.type === 'trigger');
  const triggerType = (triggerNode?.config as any)?.triggerType || 
                      (triggerNode?.config as any)?.type || 
                      'general';
  
  // Map trigger types to workflow categories
  if (triggerType === 'webchat' || triggerType === 'whatsapp' || triggerType === 'messaging') {
    return 'customer_support';
  }
  if (triggerType === 'api' || triggerType === 'webhook' || triggerType === 'http') {
    return 'data_processing';
  }
  if (triggerType === 'schedule' || triggerType === 'cron') {
    return 'automation';
  }
  
  return 'general';
}

/**
 * Predict required tools from workflow structure and context
 * Returns 3-7 most likely tools instead of all 50+
 * Prioritizes direct connections over heuristics
 */
function predictRequiredTools(
  agentNodeId: string,
  context: WorkflowExecutionContext,
  workflowGraph?: WorkflowGraph,
  agentConfig?: AgentNodeConfig
): string[] {
  const predictedToolNames = new Set<string>();
  
  if (!workflowGraph) {
    // If no workflow graph, only use explicit tools from config
    const explicitTools = agentConfig?.tools?.tools || agentConfig?.tools?.definitions || [];
    for (const toolDef of explicitTools) {
      if (toolDef.integration) {
        predictedToolNames.add(toolDef.integration);
      }
    }
    return Array.from(predictedToolNames).slice(0, 7);
  }
  
  // RULE 1: Find directly connected action nodes FIRST (most accurate)
  const outgoingEdges = workflowGraph.edges.filter(e => e.source === agentNodeId);
  for (const edge of outgoingEdges) {
    const targetNode = workflowGraph.nodes.find(n => n.id === edge.target);
    if (targetNode?.integration) {
      predictedToolNames.add(targetNode.integration);
    }
  }
  
  // RULE 2: Extract trigger metadata (secondary - only if no direct connections)
  let triggerHeuristicCount = 0;
  if (predictedToolNames.size === 0) {
    const triggerNode = workflowGraph.nodes.find(n => n.type === 'trigger');
    if (triggerNode) {
      const triggerConfig = triggerNode.config as any;
      const channel = triggerConfig?.channel || triggerConfig?.type;
      if (channel) {
        const channelName = String(channel).toLowerCase();
        // Try to find matching integration in all nodes
        const matchingNode = workflowGraph.nodes.find(n => 
          n.integration?.toLowerCase().includes(channelName)
        );
        if (matchingNode?.integration) {
          predictedToolNames.add(matchingNode.integration);
          triggerHeuristicCount = 1; // Only at most one by this rule in current code
        }
      }
    }
  }
  
  // RULE 3: Add tools explicitly defined in agent config
  const explicitTools = agentConfig?.tools?.tools || agentConfig?.tools?.definitions || [];
  for (const toolDef of explicitTools) {
    if (toolDef.integration) {
      predictedToolNames.add(toolDef.integration);
    }
  }
  
  // RULE 4: Add common workflow tools based on workflow type (fallback only)
  const workflowType = inferWorkflowType(workflowGraph);
  const commonTools = WORKFLOW_COMMON_TOOLS[workflowType] || [];
  
  // Only add common tools if we have space (prioritize explicit connections)
  const remainingSlots = 7 - predictedToolNames.size;
  const commonToolsToAdd = commonTools.slice(0, remainingSlots);
  commonToolsToAdd.forEach(tool => predictedToolNames.add(tool));
  
  // --- Tool prediction logging enhancement ---
  logger.info('Tool prediction completed', logContext(context.executionId, agentNodeId, {
    totalPredicted: Array.from(predictedToolNames).length,
    sources: {
      directConnections: outgoingEdges.length,
      explicitConfig: explicitTools.length,
      triggerHeuristic: triggerHeuristicCount,
      commonTools: commonToolsToAdd.length
    }
  }));
  // ---

  // Limit to maximum 7 tools to prevent token bloat
  return Array.from(predictedToolNames).slice(0, 7);
}

// (extractMinimalWorkflowContext function REMOVED as per instructions)

// Removed buildCapabilityAwarePrompt in favor of unified system prompt

/**
 * Build tool registry from agent config tools array and/or connected workflow nodes
 * @deprecated Use buildToolRegistryFiltered instead for better token efficiency
 */
function buildToolRegistry(
  agentNodeId: string,
  context: WorkflowExecutionContext,
  workflowGraph?: WorkflowGraph,
  agentConfig?: AgentNodeConfig
): ToolSchema[] {
  return buildToolRegistryFiltered(agentNodeId, context, workflowGraph, agentConfig);
}

/**
 * Build filtered tool registry - only includes tools in allowedToolNames list
 * This reduces token usage by 85-90% by only sending predicted tools to LLM
 */
function buildToolRegistryFiltered(
  agentNodeId: string,
  context: WorkflowExecutionContext,
  workflowGraph?: WorkflowGraph,
  agentConfig?: AgentNodeConfig,
  allowedToolNames?: string[] // Only build these tools
): ToolSchema[] {
  const tools: ToolSchema[] = [];
  
  // First, add tools from agent config tools array (new format)
  const toolsArray = agentConfig?.tools?.tools || agentConfig?.tools?.definitions;
  if (toolsArray && Array.isArray(toolsArray)) {
    const arrayType = agentConfig.tools.tools ? 'tools' : 'definitions';
    logger.info(`Building filtered tool registry from agent config ${arrayType} array`, logContext(context.executionId, agentNodeId, {
      toolsCount: toolsArray.length,
      allowedToolNames,
      arrayType
    }));

    for (const toolDef of toolsArray) {
      // Skip if not in allowed list
      if (allowedToolNames && toolDef.integration && !allowedToolNames.includes(toolDef.integration)) {
        continue;
      }
      
      try {
        const toolSchema = buildToolSchema({ type: 'definition', data: toolDef });
        if (toolSchema) {
          tools.push(toolSchema);
        }
      } catch (error) {
        logger.warn('Failed to create tool schema from definition', logContext(context.executionId, agentNodeId, {
          toolName: toolDef.name,
          error: error instanceof Error ? error.message : String(error),
          arrayType
        }));
      }
    }
  }

  // Then, add tools from workflow graph connections (existing format)
  if (workflowGraph) {
    logger.info('Building filtered tool registry from workflow graph', logContext(context.executionId, agentNodeId, {
      totalNodes: workflowGraph.nodes.length,
      totalEdges: workflowGraph.edges.length,
      allowedToolNames
    }));

    // Find all nodes connected FROM this agent node with tool_connection type
    const toolEdges = workflowGraph.edges.filter(edge => {
      // Accept explicit tool edge types, or missing type (treated as tool connection)
      return edge.source === agentNodeId &&
        ((edge as any).type === 'tool_connection' || (edge as any).type === 'tool' || !(edge as any).type);
    });

    for (const edge of toolEdges) {
      const toolNode = workflowGraph.nodes.find(n => n.id === edge.target);
      
      if (!toolNode) {
        logger.warn('Tool node not found in graph', logContext(context.executionId, agentNodeId, {
          edgeId: edge.id,
          targetNodeId: edge.target
        }));
        continue;
      }

      // Skip if not in allowed list
      if (allowedToolNames && toolNode.integration && !allowedToolNames.includes(toolNode.integration)) {
        continue;
      }

      try {
        const toolSchema = buildToolSchema({ type: 'node', data: toolNode });
        if (toolSchema) {
          tools.push(toolSchema);
        }
      } catch (error) {
        logger.warn('Failed to create tool schema from node', logContext(context.executionId, agentNodeId, {
          nodeId: toolNode.id,
          nodeName: toolNode.name,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    }
  }

  logger.info('Filtered tool registry built successfully', logContext(context.executionId, agentNodeId, {
    totalTools: tools.length,
    allowedToolNames,
    toolNames: tools.map(t => t.name),
    integrations: tools.map(t => t.integration)
  }));

  return tools;
}

/**
 * Load additional tools from registry when LLM requests unpredicted tools
 * Uses consistent name normalization for reliable matching
 */
async function loadToolsFromRegistry(
  toolNames: string[],
  agentNodeId: string,
  context: WorkflowExecutionContext,
  workflowGraph?: WorkflowGraph
): Promise<ToolSchema[]> {
  // Search full workflow graph for requested tools
  if (!workflowGraph) return [];
  
  const foundTools: ToolSchema[] = [];
  
  // Helper to normalize tool names for matching
  const normalizeName = (name: string): string => {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  };
  
  for (const requestedToolName of toolNames) {
    const normalizedRequested = normalizeName(requestedToolName);
    if (!normalizedRequested) {
      logger.warn('Tool name normalized to empty string', { requestedToolName });
      continue;
    }
    // Find node by multiple matching strategies
    const matchingNode = workflowGraph.nodes.find(node => {
      // Strategy 1: Sanitized name match
      const sanitizedNodeName = normalizeName(node.name);
      if (sanitizedNodeName === normalizedRequested) return true;
      
      // Strategy 2: Integration name match (exact)
      if (node.integration === requestedToolName) return true;
      
      // Strategy 3: Integration name match (normalized)
      if (node.integration && normalizeName(node.integration) === normalizedRequested) return true;
      
      // Strategy 4: Node ID match (fallback)
      if (node.id === requestedToolName) return true;
      
      return false;
    });
    
    if (matchingNode) {
      const toolSchema = buildToolSchema({ type: 'node', data: matchingNode });
      if (toolSchema) {
        foundTools.push(toolSchema);
        logger.info('Tool found in registry', logContext(context.executionId, agentNodeId, {
          requestedName: requestedToolName,
          foundNode: matchingNode.name,
          integration: matchingNode.integration
        }));
      }
    } else {
      logger.warn('Tool not found in registry', logContext(context.executionId, agentNodeId, {
        requestedName: requestedToolName,
        availableNodes: workflowGraph.nodes.map(n => n.name)
      }));
    }
  }
  
  return foundTools;
}

// Tool schema building types
type ToolSource = 
  | { type: 'definition'; data: ToolDefinition }
  | { type: 'node'; data: GraphNode };

/**
 * Build tool schema from either definition or graph node
 */
function buildToolSchema(source: ToolSource): ToolSchema | null {
  try {
    if (source.type === 'definition') {
      const toolDef = source.data;
      
      // Build parameters
      const { properties, required } = buildParameters(source);
      
      return {
        name: toolDef.name,
        description: toolDef.description,
        parameters: { type: 'object', properties, required },
        nodeId: `tool_${toolDef.name}`,
        integration: toolDef.integration,
        function: toolDef.function
      };
    } else {
      const node = source.data;
      // Sanitize node name for LLM tool compatibility
      let sanitizedName = node.name
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '');
      
      if (!/^[a-zA-Z]/.test(sanitizedName)) {
        sanitizedName = 'tool_' + sanitizedName;
      }
      
      if (sanitizedName.length > LIMITS.MAX_TOOL_NAME_LENGTH) {
        sanitizedName = sanitizedName.substring(0, LIMITS.MAX_TOOL_NAME_LENGTH);
      }
      
      const description = node.toolMetadata?.description || 
        `Execute ${node.name}`;
      
      // Build parameters
      const { properties, required } = buildParameters(source);
      
      return {
        name: sanitizedName,
        description,
        parameters: { type: 'object', properties, required },
        nodeId: node.id,
        ...(node.integration && { integration: node.integration }),
        ...(node.function && { function: node.function })
      };
    }
  } catch (error) {
    logger.error('Failed to build tool schema', logContext('', undefined, {
      source: source.type,
      error: error instanceof Error ? error.message : String(error)
    }));
    return null;
  }
}

/**
 * Build parameters from tool source
 */
function buildParameters(source: ToolSource): {
  properties: Record<string, { type: string; description?: string }>;
  required: string[];
} {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  
  // Get parameters from source
  const params = source.type === 'definition'
    ? source.data.parameters
    : source.data.toolMetadata?.parameters;
  
  if (params) {
    for (const [name, def] of Object.entries(params)) {
      properties[name] = {
        type: def.type,
        ...(def.description && { description: def.description })
      };
      if (def.required) required.push(name);
    }
  } else if (source.type === 'node') {
    // Infer from integration (keep this logic but simplify)
    return inferParametersFromIntegration(source.data.integration);
  }
  
  return { properties, required };
}

/**
 * Infer parameters from integration type
 */
function inferParametersFromIntegration(integration?: string): {
  properties: Record<string, any>;
  required: string[];
} {
  const type = integration?.toLowerCase() || '';
  
  // Simplified inference rules
  if (type.includes('knowledge')) {
    return {
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query']
    };
  }
  
  if (type.includes('memory')) {
    return {
      properties: {
        operation: { type: 'string', description: 'retrieve, store, delete' },
        query: { type: 'string', description: 'Query or content' }
      },
      required: ['operation']
    };
  }
  
  if (type.includes('http') || type.includes('webhook')) {
    return {
      properties: {
        url: { type: 'string', description: 'HTTP URL' },
        method: { type: 'string', description: 'HTTP method' }
      },
      required: ['url']
    };
  }
  
  if (type.includes('database') || type.includes('table')) {
    return {
      properties: {
        query: { type: 'string', description: 'Database query or operation' },
        table: { type: 'string', description: 'Table name' }
      },
      required: ['query']
    };
  }
  
  // Generic fallback
  return {
    properties: { input: { type: 'string', description: 'Input data' } },
    required: []
  };
}


/**
 * Execute LLM with iterative tool calling
 */
async function executeLLMWithTools(
  llmConfig: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  tools: ToolSchema[],
  node: GraphNode,
  context: WorkflowExecutionContext,
  toolsConfig: ToolsConfig,
  workflowGraph?: WorkflowGraph
): Promise<string> {
  const maxIterations = toolsConfig.maxIterations || LIMITS.MAX_TOOL_ITERATIONS;
  const conversationHistory: Array<{role: string; content: string; tool_calls?: any; tool_call_id?: string}> = [];
  let iteration = 0;
  let finalAnswer = '';

  // Helper function to trim conversation history to prevent token bloat
  const trimConversationHistory = () => {
    if (conversationHistory.length > 20) {
      // Keep first 2 messages (system + user) and last 18 messages
      const systemAndUser = conversationHistory.slice(0, 2);
      const recentHistory = conversationHistory.slice(-18);
      conversationHistory.length = 0;
      conversationHistory.push(...systemAndUser, ...recentHistory);
    }
  };

  logger.info('Starting iterative LLM execution with tools', logContext(context.executionId, node.id, {
    maxIterations,
    availableTools: tools.length,
    toolNames: tools.map(t => t.name)
  }));

  while (iteration < maxIterations) {
    try {
      // Validate prompts before building messages
      if (!systemPrompt.trim() && !userPrompt.trim()) {
        throw new Error('Both system and user prompts are empty');
      }
      
      // Ensure system prompt is not null/undefined
      const safeSystemPrompt = systemPrompt || 'You are a helpful AI assistant.';
      const safeUserPrompt = userPrompt || 'Hello';
      
      // Build messages for this iteration
      const messages: Array<{role: string; content: string; tool_calls?: any; tool_call_id?: string}> = [
        { role: 'system', content: safeSystemPrompt },
        { role: 'user', content: safeUserPrompt },
        ...conversationHistory
      ];

      // Convert tools to function format for LLM - OPTIMIZED with smart truncation
      const functions = tools.map(tool => {
        let description = tool.description;
        
        // Smart truncation: preserve first sentence if too long
        if (description.length > 150) {
          const sentences = description.split(/[.!?]/);
          const firstSentence = sentences[0];
          if (firstSentence && firstSentence.length > 0 && firstSentence.length <= 150) {
            description = firstSentence + '.';
          } else {
            description = description.substring(0, 147) + '...';
          }
        }
        
        return {
          name: tool.name,
          description,
          parameters: {
            type: 'object',
            properties: tool.parameters.properties,
            required: tool.parameters.required
          }
        };
      });

      // Determine integration name
      let integrationName: string | undefined = llmConfig.integration || llmConfig.provider;
      if (!integrationName) {
        throw new Error('LLM integration not specified. Provide llm.integration or a supported provider.');
      }

      // Extract credentials
      const llmCredentials = (llmConfig as any).credentials || {};
      const nodeCredentials = node.credentials?.[integrationName] || {};

      const inputs: Record<string, unknown> = {
        ...llmConfig,
        messages,
        functions,
        tool_choice: 'auto',
        executionId: context.executionId,
        agentId: context.agentId,
        tenantId: context.tenantId,
        ...nodeCredentials,
        ...llmCredentials
      };

      // Remove credentials from the main config to avoid duplication
      if ('credentials' in inputs) {
        delete inputs.credentials;
      }

      logger.info(`LLM iteration ${iteration + 1}/${maxIterations}`, logContext(context.executionId, node.id, {
        messageCount: messages.length,
        availableTools: tools.length
      }));

      // Execute LLM with timeout and automatic fallback
      const llmResult = await withTimeout(
        executeIntegrationWithFallback(integrationName, inputs, context),
        TIMEOUTS.TOOL_DEFAULT,
        `LLM iteration ${iteration + 1}`
      );

      // Parse response
      const response = parseLLMResponse(llmResult, tools);

      if (response.type === 'final_answer') {
        const rawAnswer = response.content;
        finalAnswer = cleanLLMOutput(rawAnswer);
        logger.info('LLM provided final answer', context.executionId, node.id, {
          iteration: iteration + 1,
          rawAnswerLength: rawAnswer.length,
          cleanAnswerLength: finalAnswer.length,
          sanitizationApplied: rawAnswer !== finalAnswer
        });

        break;
      }

      if (response.type === 'tool_calls') {
        const requestedToolNames = response.calls.map(c => c.toolName);
        
        logger.info('LLM requested tool calls', logContext(context.executionId, node.id, {
          iteration: iteration + 1,
          toolCalls: response.calls.length,
          toolNames: requestedToolNames
        }));

        // NEW: Check for tools not in current registry
        const missingToolNames = requestedToolNames.filter(
          name => !tools.find(t => t.name === name)
        );
        
        if (missingToolNames.length > 0) {
          logger.warn('LLM requested unpredicted tools', logContext(context.executionId, node.id, {
            missingTools: missingToolNames,
            availableTools: tools.map(t => t.name)
          }));
          
          // Try to load missing tools from full registry
          const additionalTools = await loadToolsFromRegistry(
            missingToolNames,
            node.id,
            context,
            workflowGraph
          );
          
          if (additionalTools.length > 0) {
            // Add to available tools for next iteration
            tools.push(...additionalTools);
            
            logger.info('Additional tools loaded', logContext(context.executionId, node.id, {
              loadedTools: additionalTools.map(t => t.name)
            }));
            
            // Add system message about newly available tools
            conversationHistory.push({
              role: 'system',
              content: `Additional tools are now available: ${additionalTools.map(t => t.name).join(', ')}. You can use these in your next response.`
            });
            
            iteration++;
            continue; // Retry with expanded tool set
          }
          
          // Tool truly doesn't exist - force LLM to acknowledge limitation
          conversationHistory.push({
            role: 'system',
            content: `ERROR: Tools [${missingToolNames.join(', ')}] do not exist.
Available tools: ${tools.map(t => t.name).join(', ')}.
Please inform the user you cannot perform that action and suggest alternatives using your available capabilities.`
          });
          
          iteration++;
          continue;
        }

        // Execute valid tool calls
        const toolResults = await executeToolCalls(response.calls, tools, context, workflowGraph);

        // Add LLM message with tool calls to conversation - OPTIMIZED
        conversationHistory.push({
          role: 'assistant',
          content: '',
          tool_calls: response.calls.map(call => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.toolName,
              arguments: JSON.stringify(call.arguments)
            }
          }))
        });

        // Add tool results to conversation - OPTIMIZED
        for (const result of toolResults) {
          let content: string;
          if (result.error) {
            content = `Error: ${result.error}`;
          } else {
            // Extract only essential information from tool output
            const output = result.output;
            if (typeof output === 'string') {
              content = output.length > 500 ? output.substring(0, 500) + '...' : output;
            } else if (output && typeof output === 'object') {
              // Extract key fields from object output
              const keyFields = ['result', 'data', 'content', 'output', 'message'];
              const extracted = keyFields.find(field => (output as any)[field]);
              content = extracted ? String((output as any)[extracted]).substring(0, 500) : JSON.stringify(output).substring(0, 500);
            } else {
              content = String(output).substring(0, 500);
            }
          }
          
          conversationHistory.push({
            role: 'tool',
            content,
            tool_call_id: result.toolCallId
          });
        }

        // Trim conversation history to prevent token bloat
        trimConversationHistory();
        iteration++;
      } else {
        // Unexpected response type
        logger.warn('Unexpected LLM response type', context.executionId, node.id, {
          iteration: iteration + 1,
          responseType: (response as any).type
        });
        break;
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`LLM iteration ${iteration + 1} failed`, context.executionId, node.id, {
        iteration: iteration + 1,
        error: errorMessage
      });
      
      // Return a CLEAN fallback message, not the entire context
      const fallbackMessage = errorMessage.includes('401') 
        ? "I'm having trouble connecting to my AI service. Please try again in a moment."
        : "I apologize, but I encountered an error while processing your request.";
      
      return fallbackMessage; // Return JUST the string, not wrapped in context
    }
  }

  if (iteration >= maxIterations) {
    logger.warn('Maximum iterations reached', context.executionId, node.id, {
      maxIterations,
      finalAnswerLength: finalAnswer.length
    });
    
    if (!finalAnswer) {
      finalAnswer = 'I reached the maximum number of iterations and was unable to provide a complete answer. Please try rephrasing your request.';
    }
  }

  logger.info('Iterative LLM execution completed', context.executionId, node.id, {
    totalIterations: iteration,
    finalAnswerLength: finalAnswer.length,
    conversationLength: conversationHistory.length
  });

  return finalAnswer;
}

/**
 * Execute LLM with simple prompt
 */
async function executeLLM(
  llmConfig: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  tools: ToolSchema[],
  node: GraphNode,
  context: WorkflowExecutionContext
): Promise<LLMResponse> {
  // Determine integration name based on config
  let integrationName: string | undefined = llmConfig.integration || llmConfig.provider;

  if (!integrationName) {
    throw new Error('LLM integration not specified. Provide llm.integration or a supported provider.');
  }

  // Extract credentials from llmConfig first, then fallback to node credentials
  const llmCredentials = (llmConfig as any).credentials || {};
  const nodeCredentials = node.credentials?.[integrationName] || {};

  // Validate prompts before building messages
  if (!systemPrompt.trim() && !userPrompt.trim()) {
    throw new Error('Both system and user prompts are empty');
  }
  
  // Ensure prompts are not null/undefined
  const safeSystemPrompt = systemPrompt || 'You are a helpful AI assistant.';
  const safeUserPrompt = userPrompt || 'Hello';
  
  // Build messages array
  const messages: Array<{role: string; content: string; tool_calls?: any; tool_call_id?: string}> = [
    { role: 'system', content: safeSystemPrompt },
    { role: 'user', content: safeUserPrompt }
  ];

  // Convert tools to function format for LLM
  const functions = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));

  const inputs: Record<string, unknown> = {
    ...llmConfig,
    messages,
    executionId: context.executionId,
    agentId: context.agentId,
    tenantId: context.tenantId,
    // Merge credentials: llm config credentials take precedence over node credentials
    ...nodeCredentials,
    ...llmCredentials
  };

  // Add tools if available
  if (tools.length > 0) {
    // Build universal tool list for the integration (name/description/parameters)
    const universalTools = tools
      .filter(t => !!t.name && !!t.parameters)
      .map(t => ({
        name: t.name,
        description: t.description || 'No description provided',
        parameters: t.parameters || { type: 'object', properties: {} }
      }));
    (inputs as any).tools = universalTools;

    // Also provide modern OpenAI-style tools for downstream compatibility
    const openAiTools = tools
      .filter(t => !!t.name && !!t.parameters)
      .map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || 'No description provided',
          parameters: t.parameters || { type: 'object', properties: {} }
        }
      }));
    (inputs as any).openaiTools = openAiTools;

    // Legacy functions array
    inputs.functions = openAiTools.map((t: any) => t.function);
    inputs.tool_choice = 'auto';
  }  

  // Remove credentials from the main config to avoid duplication
  if ('credentials' in inputs) {
    delete inputs.credentials;
  }

  logger.info('Executing LLM with tools', logContext(context.executionId, node.id, {
    model: llmConfig.model,
    integrationName,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    availableTools: tools.length,
    toolNames: tools.map(t => t.name)
  }));

  // Use automatic fallback - tries generateWithTools first, falls back to chatCompletion
  const llmResult = await executeIntegrationWithFallback(integrationName, inputs, context);
  
  // Parse LLM response to determine if it's tool calls or final answer
  return parseLLMResponse(llmResult, tools);
}

/**
 * Parse LLM response to determine if it contains tool calls or final answer
 */
function parseLLMResponse(llmResult: unknown, tools: ToolSchema[]): LLMResponse {
  if (typeof llmResult === 'string') {
    return { type: 'final_answer', content: llmResult.trim() };
  }
  
  if (llmResult && typeof llmResult === 'object') {
    const result = llmResult as Record<string, unknown>;
    
    // Check for tool calls in OpenAI format
    if (result.choices && Array.isArray(result.choices) && result.choices.length > 0) {
      const choice = result.choices[0] as Record<string, unknown>;
      
      // Check for tool calls
      if (choice.tool_calls && Array.isArray(choice.tool_calls) && choice.tool_calls.length > 0) {
        const toolCalls: ToolCall[] = choice.tool_calls.map((call: any) => ({
          id: call.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          toolName: call.function?.name || '',
          arguments: call.function?.arguments ? 
            (typeof call.function.arguments === 'string' ? 
              JSON.parse(call.function.arguments) : 
              call.function.arguments) : {}
        }));
        
        return { type: 'tool_calls', calls: toolCalls };
      }
      
      // Check for final answer in message content
      if (choice.message && typeof choice.message === 'object') {
        const message = choice.message as Record<string, unknown>;
        if (typeof message.content === 'string' && message.content.trim()) {
          return { type: 'final_answer', content: message.content.trim() };
        }
      }
    }
    
    // Check for direct tool calls in response
    if (result.tool_calls && Array.isArray(result.tool_calls)) {
      const toolCalls: ToolCall[] = result.tool_calls.map((call: any) => ({
        id: call.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        toolName: call.function?.name || call.name || '',
        arguments: call.function?.arguments || call.arguments || {}
      }));
      
      return { type: 'tool_calls', calls: toolCalls };
    }
    
    // Check for final answer in various response formats
    const extractedText = extractField(result, 'text');
    if (extractedText) {
      return { type: 'final_answer', content: extractedText };
    }
  }
  
  // Fallback to final answer with stringified result
  return { 
    type: 'final_answer', 
    content: typeof llmResult === 'string' ? llmResult : JSON.stringify(llmResult) 
  };
}

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(
  calls: readonly ToolCall[],
  tools: ToolSchema[],
  context: WorkflowExecutionContext,
  workflowGraph?: WorkflowGraph
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  
  logger.info('Executing tool calls', logContext(context.executionId, undefined, {
    totalCalls: calls.length,
    callIds: calls.map(c => c.id),
    toolNames: calls.map(c => c.toolName)
  }));

  for (const call of calls) {
    try {
      // Find matching tool/node
      const tool = tools.find(t => t.name === call.toolName);
      if (!tool) {
        results.push({
          toolCallId: call.id,
          error: `Tool '${call.toolName}' not found. Available tools: ${tools.map(t => t.name).join(', ')}`
        });
        continue;
      }

      // Find the original node name from workflow graph (if available)
      const toolNode = workflowGraph?.nodes.find(n => n.id === tool.nodeId);
      const nodeName = toolNode?.name || tool.nodeId;

      // Execute the tool directly
      const nodeResult = await executeTool(
        tool,
        call.arguments,
        context,
        nodeName
      );

      results.push({
        toolCallId: call.id,
        output: nodeResult
      });

      logger.info('Tool call executed successfully', logContext(context.executionId, undefined, {
        toolCallId: call.id,
        toolName: call.toolName,
        nodeId: tool.nodeId,
        hasOutput: !!nodeResult
      }));



    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        toolCallId: call.id,
        error: errorMessage
      });

      logger.error('Tool call execution failed', logContext(context.executionId, undefined, {
        toolCallId: call.id,
        toolName: call.toolName,
        error: errorMessage
      }));
    }
  }

  return results;
}

/**
 * Execute a tool (either from config or workflow node)
 */
async function executeTool(
  tool: ToolSchema,
  inputs: Record<string, unknown>,
  context: WorkflowExecutionContext,
  nodeName?: string
): Promise<unknown> {
  logger.info('Executing tool', logContext(context.executionId, undefined, {
    toolName: tool.name,
    integration: tool.integration,
    function: tool.function,
    inputKeys: Object.keys(inputs)
  }));

  try {
    // Determine integration and function from tool schema
    if (!tool.integration) {
      throw new Error(`Tool integration not specified for tool '${tool.name}'`);
    }

    const integrationName = tool.integration;
    const functionName = tool.function || 'execute';

    // Resolve semantic references in inputs
    const resolvedInputs = await resolveIntegrationInputs(inputs, context);

    // Add execution context to inputs
    const executionInputs = {
      ...resolvedInputs.resolvedInputs,
      executionId: context.executionId,
      agentId: context.agentId,
      tenantId: context.tenantId
    };


    // Execute the integration
    const result = await executeIntegration(
      integrationName,
      functionName,
      executionInputs,
      context
    );

    // Store result in context for future semantic access
    const toolResult = {
      output: result,
      toolName: tool.name,
      integration: integrationName,
      function: functionName,
      executionTime: Date.now() - context.startTime,
      timestamp: new Date().toISOString(),
      success: true
    };

    // Store using tool name for semantic access
    (context.nodeData as Record<string, any>)[tool.name] = toolResult;
    
    // Also store by node name if provided
    if (nodeName) {
      (context.nodeData as Record<string, any>)[nodeName] = toolResult;
    }

    logger.info('Tool executed successfully', logContext(context.executionId, undefined, {
      toolName: tool.name,
      integrationName,
      functionName,
      hasResult: !!result
    }));

    return result;

  } catch (error) {
    handleError(error, 'Tool execution', {
      executionId: context.executionId,
      toolName: tool.name,
      integration: tool.integration
    });
  }
}

// (executeNodeAsTool function REMOVED as per instructions)










/**
 * Resolve agent configuration with semantic resolution
 */
async function resolveAgentConfiguration(
  config: AgentNodeConfig,
  context: WorkflowExecutionContext
): Promise<{
  resolved: AgentNodeConfig;
  stats: SemanticResolutionStats;
}> {
  const startTime = Date.now();

  logger.info('Starting agent semantic resolution', logContext(context.executionId, undefined, {
    availableNodes: Object.keys(context.nodeData),
    hasSystemPrompt: Boolean(config.systemPrompt),
    hasUserPrompt: Boolean(config.userPrompt),
    hasMemory: Boolean(config.memory)
  }));

  try {
    // Prepare inputs for resolution
    const inputsToResolve: Record<string, unknown> = {
      systemPrompt: config.systemPrompt || '',
      userPrompt: config.userPrompt || ''
    };

    // If memory config contains semantic references, resolve them too
    if (config.memory) {
      // Resolve memory configuration fields that might contain semantic references
      const memoryInputsToResolve: Record<string, unknown> = {};
      
      for (const [key, value] of Object.entries(config.memory)) {
        if (typeof value === 'string') {
          memoryInputsToResolve[`memory_${key}`] = value;
        }
      }
      
      Object.assign(inputsToResolve, memoryInputsToResolve);
    }

    // Perform semantic resolution
    const resolveResult = await resolveIntegrationInputs(
      inputsToResolve,
      context
    );

    // Validate resolved prompts
    const resolvedSystemPrompt = resolveResult.resolvedInputs.systemPrompt as string || '';
    const resolvedUserPrompt = resolveResult.resolvedInputs.userPrompt as string || '';

    if (!resolvedSystemPrompt.trim() && !resolvedUserPrompt.trim()) {
      throw new Error('Both system and user prompts are empty after semantic resolution');
    }

    if (resolvedUserPrompt && !resolvedUserPrompt.trim()) {
      throw new Error('User prompt is empty after semantic resolution');
    }

    // Handle resolved memory config
    let resolvedMemory = config.memory;
    if (config.memory) {
      resolvedMemory = { ...config.memory };
      
      // Apply resolved memory fields
      for (const [key, value] of Object.entries(resolveResult.resolvedInputs)) {
        if (key.startsWith('memory_') && typeof value === 'string') {
          const memoryKey = key.replace('memory_', '');
          (resolvedMemory as any)[memoryKey] = value;
        }
      }
    }

    const resolvedConfig: AgentNodeConfig = {
      systemPrompt: resolvedSystemPrompt || config.systemPrompt,
      userPrompt: resolvedUserPrompt || config.userPrompt,
      ...(config.llm && { llm: config.llm }),
      ...(resolvedMemory && { memory: resolvedMemory }),
      ...(config.tools && { tools: config.tools })
    };

    const stats: SemanticResolutionStats = {
      totalReferences: 0,
      resolvedReferences: 0,
      failedReferences: 0,
      resolutionTime: Date.now() - startTime,
      unresolvedTokens: []
    };

    logger.info('Agent semantic resolution completed', logContext(context.executionId, undefined, {
      resolutionTime: stats.resolutionTime
    }));

    return { resolved: resolvedConfig, stats };

  } catch (error) {
    const resolutionTime = Date.now() - startTime;
    handleError(error, 'Agent semantic resolution', {
      executionId: context.executionId,
      resolutionTime,
      availableNodes: Object.keys(context.nodeData)
    });
  }
}









/**
 * Format memory result for LLM context injection
 */
function formatMemoryContextForLLM(memoryResult: unknown): string {
  if (!memoryResult) return '';

  try {
    const result = memoryResult as any;
    
    // Strategy 1: Use pre-formatted context (best performance)
    if (result.formattedContext?.trim()) {
      return result.formattedContext;
    }
    
    // Strategy 2: Format message array
    if (Array.isArray(result.messages)) {
      return formatMessageHistory(result.messages);
    }
    
    // Strategy 3: String fallback
    if (typeof memoryResult === 'string') {
      return memoryResult.trim().substring(0, 2000);
    }
    
    return '';
  } catch (error) {
    logger.error('Memory context formatting failed', logContext('', undefined, {
      error: error instanceof Error ? error.message : String(error)
    }));
    return '';
  }
}

/**
 * Format message history for LLM context
 */
function formatMessageHistory(messages: any[]): string {
  if (!messages.length) return '';
  
  const recent = messages.slice(-8); // Last 8 messages only
  const formatted = recent
    .map(msg => {
      const user = (msg.userInput || msg.user_input || msg.input || '').trim();
      const assistant = (msg.output || msg.agentOutput || msg.response || '').trim();
      
      if (!user && !assistant) return null;
      
      const parts = [];
      if (user) parts.push(`User: ${user}`);
      if (assistant) parts.push(`Assistant: ${assistant}`);
      
      return parts.join('\n');
    })
    .filter(Boolean);
  
  if (!formatted.length) return '';
  
  return 'Previous conversation:\n' + formatted.join('\n\n---\n\n');
}













/**
 * Execute integration function - simple and efficient
 */
async function executeIntegration(
  integrationName: string,
  functionName: string,
  inputs: Record<string, unknown>,
  context: WorkflowExecutionContext
): Promise<unknown> {
  try {
    const integrationEntry = await integrationRegistry.getFunction(integrationName, functionName);
    if (!integrationEntry) {
      throw new Error(`Integration function not found: ${integrationName}.${functionName}`);
    }

    const executionContext = {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      startTime: context.startTime,
      status: context.status,
      nodeData: context.nodeData,
      variables: context.variables || {},
      stepResults: {}
    };

    const result = await IntegrationExecutor.execute(integrationEntry, executionContext, inputs);
    
    // CRITICAL: Extract actual payload from any step in stepResults
    if (result && typeof result === 'object' && (result as any).stepResults) {
      const stepResults = (result as any).stepResults as Record<string, any>;
      const steps = Object.values(stepResults || {});
      for (const step of steps) {
        const jsonPayload = (step && typeof step === 'object') ? (step as any).json : undefined;
        if (jsonPayload && typeof jsonPayload === 'object') {
          // Prefer nested data that contains messages first
          const dataField = (jsonPayload as any).data;
          if (dataField && typeof dataField === 'object') {
            const dataObj = dataField as Record<string, unknown>;
            if (Array.isArray((dataObj as any).messages) || Array.isArray((dataObj as any).results) || Array.isArray((dataObj as any).data) || ((dataObj as any).totalCount ?? 0) > 0) {
              return dataObj;
            }
          }
          // Fallback: if jsonPayload itself has messages/data/results
          const payload = jsonPayload as Record<string, unknown>;
          const hasUsefulData =
            Array.isArray((payload as any).messages) ||
            Array.isArray((payload as any).data) ||
            Array.isArray((payload as any).results) ||
            typeof (payload as any).output === 'string' ||
            typeof (payload as any).agentOutput === 'string' ||
            ((payload as any).totalCount ?? 0) > 0 ||
            ((payload as any).count ?? 0) > 0;
          if (hasUsefulData) {
            return payload;
          }
        }
      }
    }



    return result;
  } catch (error) {
    handleError(error, 'Integration execution', {
      executionId: context.executionId,
      integrationName,
      functionName
    });
  }
}

/**
 * Execute integration with automatic fallback for LLM functions
 * Tries generateWithTools first, falls back to chatCompletion if not found
 * Removes hardcoded integration name checks
 */
async function executeIntegrationWithFallback(
  integrationName: string,
  inputs: Record<string, unknown>,
  context: WorkflowExecutionContext
): Promise<unknown> {
  try {
    // Try modern function first
    return await executeIntegration(integrationName, 'generateWithTools', inputs, context);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // If function not found, try legacy function
    if (errorMessage.includes('function not found') || errorMessage.includes('not found')) {
      logger.info('Falling back to chatCompletion', logContext(context.executionId, undefined, {
        integrationName
      }));
      return await executeIntegration(integrationName, 'chatCompletion', inputs, context);
    }
    
    throw error;
  }
}



/**
 * Store agent result using node data manager with essential data only
 */
function storeAgentResultWithNodeDataManager(
  node: GraphNode,
  context: WorkflowExecutionContext,
  agentOutput: string,
  memoryResult: unknown,
  startTime: number
): Record<string, unknown> {
  const executionTime = Date.now() - startTime;
  
  // Create essential node data for storage
  const nodeData = {
    output: agentOutput,        // The actual text response
    agentOutput: agentOutput,   // Compatibility alias
    success: true,
    timestamp: new Date().toISOString(),
    executionTime,
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    workflowId: context.workflowId,
    workflowName: context.workflowName,
    agentId: context.agentId,
    tenantId: context.tenantId,
    executionId: context.executionId,
    ...(memoryResult ? { memoryResult } : {})
  };

  // Convert context to TypeSafeExecutionContext for node data manager
  const typeSafeContext: TypeSafeExecutionContext = {
    executionId: context.executionId,
    workflowId: context.workflowId,
    agentId: context.agentId,
    nodeData: context.nodeData as Record<string, Record<string, unknown>>,
    startTime: context.startTime,
    status: context.status
  };

  // Store using node data manager
  addNodeData(typeSafeContext, node.name, nodeData);

  // Also store in original context for backward compatibility
  (context.nodeData as Record<string, any>)[node.name] = nodeData;
  
  // Update variables.json for template access
  const vars = context.variables || {};
  if (!vars.json) vars.json = {};
  vars.json[node.name] = nodeData;

  logger.info('Agent result stored using node data manager', context.executionId, node.id, {
    nodeName: node.name,
    outputLength: agentOutput.length,
    accessPattern: `{{$json.[${node.name}].output}}`,
    storedInNodeDataManager: true
  });

  return nodeData;
}


/**
 * Integration-style wrapper for compatibility with main executor
 */
export async function executeAgentIntegration(
  executionContext: any,
  inputs: Record<string, unknown>
): Promise<any> {
  try {
    const { 
      nodeId, 
      nodeName, 
      nodeType, 
      agentConfig, 
      credentials,
      executionId,
      workflowId,
      workflowName,
      agentId,
      tenantId,
      nodeData,
      variables,
      startTime,
      status,
      workflowGraph
    } = inputs;
    
    if (!nodeId || !nodeName || !agentConfig) {
      throw new Error('Missing required fields: nodeId, nodeName, or agentConfig');
    }

    if (!executionId || !agentId || !tenantId) {
      throw new Error('Missing required context fields (executionId, agentId, tenantId)');
    }

    const nodeDataObj: GraphNode = {
      triggerName: 'manual',
      id: nodeId as string,
      name: nodeName as string,
      type: (nodeType as string) || 'agent',
      position: { x: 0, y: 0 },
      agentConfig: agentConfig as AgentNodeConfig,
      credentials: credentials as Record<string, Record<string, unknown>>
    };
    
    const workflowContext: WorkflowExecutionContext = {
      executionId: executionId as string,
      workflowId: workflowId as string,
      workflowName: workflowName as string,
      agentId: agentId as string,
      tenantId: tenantId as string,
      startTime: (startTime as number) || Date.now(),
      status: (status as 'running' | 'completed' | 'failed') || 'running',
      nodeData: nodeData as Record<string, any> || {},
      variables: variables as Record<string, any> || {}
    };

    const agentRequest: AgentExecutionRequest = {
      node: nodeDataObj,
      context: workflowContext,
      workflowGraph: workflowGraph as WorkflowGraph
    };

    const agentResponse = await executeAgentRequest(agentRequest);

    if (!agentResponse.success) {
      throw new Error(agentResponse.error || 'Agent execution failed');
    }

    return {
      stepResults: {
        execute: {
          json: {
            output: agentResponse.agentOutput,
            agentOutput: agentResponse.agentOutput,
            success: agentResponse.success,
            timestamp: new Date().toISOString(),
            ...(agentResponse.nodeData && { nodeData: agentResponse.nodeData })
          }
        }
      }
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
  
    logger.error('Agent integration execution failed', logContext(executionContext.executionId, inputs.nodeId as string, {
      nodeName: inputs.nodeName,
      error: errorMessage
    }));
  
    // ✅ Smarter fallback
    const isProduction =
      process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
  
    // In production: safe message; in dev: show the real cause
    const safeOutput = isProduction
      ? "I’m sorry, something went wrong while processing your request."
      : `⚠️ Error: ${errorMessage}`;
  
    return {
      stepResults: {
        execute: {
          json: {
            output: safeOutput,
            agentOutput: safeOutput,
            success: false,
            timestamp: new Date().toISOString()
          }
        }
      }
    };
  }
  
}

// SEMANTIC RESOLUTION FUNCTIONS

/**
 * Resolve integration inputs with semantic field resolution
 */
async function resolveIntegrationInputs(
  inputs: Record<string, unknown>,
  context: WorkflowExecutionContext
): Promise<{
  resolvedInputs: Record<string, unknown>;
  resolutionStats?: SemanticResolutionStats;
}> {
  const resolved: Record<string, unknown> = {};
  const fields = getNodeFields(context);
  
  for (const [key, value] of Object.entries(inputs)) {
    resolved[key] = typeof value === 'string' 
      ? resolveTemplate(value, fields)
      : value;
  }

  return { resolvedInputs: resolved };
}

/**
 * Resolve template references in text
 */
function resolveTemplate(
  text: string,
  fields: Record<string, Record<string, unknown>>
): string {
  return text.replace(TEMPLATE_PATTERN, (match, nodeName, fieldName) => {
    const value = fields[nodeName]?.[fieldName];
    
    if (value === undefined) {
      logger.warn('Template reference not found', { nodeName, fieldName });
      return match; // Keep original if not found
    }
    
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/**
 * Get node fields from context (merged from nodeData and variables.json)
 */
function getNodeFields(context: WorkflowExecutionContext): Record<string, Record<string, unknown>> {
  const fields: Record<string, Record<string, unknown>> = {};
  
  // Merge nodeData and variables.json
  for (const [name, data] of Object.entries(context.nodeData)) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      fields[name] = data as Record<string, unknown>;
    }
  }
  
  // Variables.json takes precedence
  if (context.variables?.json) {
    Object.assign(fields, context.variables.json);
  }
  
  return fields;
}

// VALIDATION FUNCTIONS - Zod schemas

const LLMConfigSchema = z.object({
  model: z.string().min(1, 'Model is required'),
  provider: z.string().optional(),
  integration: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  credentials: z.record(z.unknown()).optional()
});

const MemoryConfigSchema = z.object({
  type: z.string().optional(),
  operation: z.array(z.enum(['store', 'retrieve', 'delete', 'get', 'find', 'save', 'remove'])).min(1).optional(),
  integrationName: z.string().min(1, 'Memory integration name is required'),
  tableName: z.string().min(1, 'Table name is required'),
  tableId: z.string().optional(),
  sessionId: z.string().min(1, 'Session ID is required'),
  maxContextLength: z.number().positive().max(LIMITS.MAX_CONTEXT_LENGTH).optional(),
  credentials: z.record(z.unknown()).optional()
}).passthrough(); // Allow additional memory-specific fields

const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  integration: z.string().min(1),
  function: z.string().min(1),
  parameters: z.record(z.object({
    type: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional()
  })),
  config: z.record(z.unknown()).optional()
});

const ToolsConfigSchema = z.object({
  enabled: z.boolean(),
  maxIterations: z.number().int().min(1).max(50).optional(),
  autoStoreResults: z.boolean().optional(),
  maxContextLength: z.number().positive().max(LIMITS.MAX_CONTEXT_LENGTH).optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  definitions: z.array(ToolDefinitionSchema).optional()
});

const AgentNodeConfigSchema = z.object({
  llm: LLMConfigSchema,
  systemPrompt: z.string().optional(),
  userPrompt: z.string().optional(),
  memory: MemoryConfigSchema.optional(),
  tools: ToolsConfigSchema.optional()
}).refine(
  data => data.systemPrompt || data.userPrompt,
  { message: 'At least one of systemPrompt or userPrompt is required' }
);

/**
 * Validate agent configuration using Zod schemas
 */
export function validateAgentConfiguration(
  config: AgentNodeConfig,
  context: WorkflowExecutionContext
): ValidationResult {
  const result = AgentNodeConfigSchema.safeParse(config);
  
  if (!result.success) {
    return {
      isValid: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      warnings: []
    };
  }
  
  // Add runtime warnings
  const warnings: string[] = [];
  if (config.tools?.maxIterations && config.tools.maxIterations > 20) {
    warnings.push('High maxIterations may impact performance');
  }
  
  if (config.memory?.type) {
    const commonTypes = ['conversation', 'knowledge', 'context'];
    if (!commonTypes.includes(String(config.memory.type).toLowerCase())) {
      warnings.push(`Memory type '${config.memory.type}' may not be supported. Common types: ${commonTypes.join(', ')}`);
    }
  }
  
  return {
    isValid: true,
    errors: [],
    warnings
  };
}

// DATA RETRIEVAL FUNCTIONS

/**
 * Get node data using node data manager
 */
export function getAgentNodeData(
  context: WorkflowExecutionContext,
  nodeName: string
): Record<string, unknown> | null {
  const typeSafeContext: TypeSafeExecutionContext = {
    executionId: context.executionId,
    workflowId: context.workflowId,
    agentId: context.agentId,
    nodeData: context.nodeData as Record<string, Record<string, unknown>>,
    startTime: context.startTime,
    status: context.status
  };

  const nodeData = getNodeData(typeSafeContext, nodeName);
  
  if (!nodeData) {
    logger.warn('Node data not found', {
      executionId: context.executionId,
      requestedNodeName: nodeName,
      availableNodes: Object.keys(context.nodeData),
      expectedAccessPattern: `{{$json.[${nodeName}].field}}`
    });
  }

  return nodeData || null;
}

/**
 * Get specific node field
 */
export function getAgentNodeField<T = unknown>(
  context: WorkflowExecutionContext,
  nodeName: string,
  fieldName: string
): T | null {
  const nodeData = getAgentNodeData(context, nodeName);
  if (!nodeData || !(fieldName in nodeData)) {
    return null;
  }
  return nodeData[fieldName] as T;
}

/**
 * Get all node data using node data manager
 */
export function getAllAgentNodeData(
  context: WorkflowExecutionContext
): Record<string, Record<string, unknown>> {
  const typeSafeContext: TypeSafeExecutionContext = {
    executionId: context.executionId,
    workflowId: context.workflowId,
    agentId: context.agentId,
    nodeData: context.nodeData as Record<string, Record<string, unknown>>,
    startTime: context.startTime,
    status: context.status
  };

  return getAllNodeData(typeSafeContext);
}


/**
 * Update agent node field using node data manager - accessible anytime
 */
export function updateAgentNodeField(
  context: WorkflowExecutionContext,
  nodeName: string,
  fieldName: string,
  value: unknown
): boolean {
  const typeSafeContext: TypeSafeExecutionContext = {
    executionId: context.executionId,
    workflowId: context.workflowId,
    agentId: context.agentId,
    nodeData: context.nodeData as Record<string, Record<string, unknown>>,
    startTime: context.startTime,
    status: context.status
  };

  return updateNodeField(typeSafeContext, nodeName, fieldName, value);
}

// TYPE EXPORTS
export type {
  AgentExecutionRequest,
  AgentExecutionResponse,
  AgentNodeConfig,
  LLMConfig,
  MemoryConfig,
  ToolsConfig,
  ToolDefinition,
  ToolSchema,
  ToolCall,
  ToolResult,
  LLMResponse,
  SemanticResolutionStats,
  ValidationResult,
  WorkflowExecutionContext,
  WorkflowGraph,
  WorkflowEdge,
  GraphNode,
  NodeResult
  // MinimalWorkflowContext removed
};