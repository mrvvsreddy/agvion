// path: agent/services/workflow-executor.ts

import logger from '../../utils/logger';
import { randomUUID } from 'crypto';
import {
  WorkflowGraph,
  WorkflowNode,
  WorkflowExecutionContext,
  NodeExecutionResult,
  NodeResult,
  TriggerDataInjection,
  WorkflowExecutionTracker,
  ExecutionMetadata,
  AgentNodeConfig,
  LLMRequest
} from './types';
import llmAdapterService from './llm-adapter';

// ============================================================================
// SECURITY CONSTANTS & CONFIGURATION
// ============================================================================

const SECURITY_LIMITS = {
  MAX_WORKFLOW_NODES: 1000,
  MAX_WORKFLOW_EDGES: 5000,
  MAX_NODE_NAME_LENGTH: 256,
  MAX_FIELD_NAME_LENGTH: 256,
  MAX_TEMPLATE_REFERENCES: 100,
  MAX_RECURSION_DEPTH: 50,
  MAX_EXECUTION_TIME_MS: 300000, // 5 minutes
  MAX_STORED_RESULT_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_ACTIVE_EXECUTIONS: 10000,
  EXECUTION_CLEANUP_INTERVAL_MS: 60000, // 1 minute
  STALE_EXECUTION_THRESHOLD_MS: 3600000 // 1 hour
} as const;

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,256}$/;
const SAFE_NODE_NAME_PATTERN = /^[a-zA-Z0-9_\-\s]{1,256}$/;

const DANGEROUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__'
]);

// ============================================================================
// UTILITY: SAFE OBJECT OPERATIONS (PROTOTYPE POLLUTION PROTECTION)
// ============================================================================

function safeSetProperty<T extends Record<string, unknown>>(
  obj: T,
  key: string,
  value: unknown
): void {
  if (DANGEROUS_KEYS.has(key)) {
    throw new Error(`Dangerous property name detected: ${key}`);
  }
  (obj as Record<string, unknown>)[key] = value;
}

function safeGetProperty<T extends Record<string, unknown>>(
  obj: T,
  key: string
): unknown {
  if (DANGEROUS_KEYS.has(key)) {
    return undefined;
  }
  return (Object.prototype.hasOwnProperty.call(obj, key)) ? (obj as Record<string, unknown>)[key] : undefined;
}

function createSafeObject<T = unknown>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

// ============================================================================
// UTILITY: INPUT VALIDATION & SANITIZATION
// ============================================================================

function validateIdentifier(id: unknown, fieldName: string): string {
  if (typeof id !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(
      `${fieldName} contains invalid characters. Only alphanumeric, hyphens, and underscores allowed (max 256 chars)`
    );
  }
  return id;
}

function validateNodeName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new Error('Node name must be a string');
  }
  if (!SAFE_NODE_NAME_PATTERN.test(name)) {
    throw new Error(
      'Node name contains invalid characters. Only alphanumeric, spaces, hyphens, and underscores allowed (max 256 chars)'
    );
  }
  return name.trim();
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.substring(0, 500);
  }
  if (typeof error === 'string') {
    return error.substring(0, 500);
  }
  return 'Unknown error occurred';
}

function validateObjectSize(obj: unknown): void {
  const size = JSON.stringify(obj).length;
  if (size > SECURITY_LIMITS.MAX_STORED_RESULT_SIZE) {
    throw new Error(
      `Object size (${size} bytes) exceeds maximum allowed (${SECURITY_LIMITS.MAX_STORED_RESULT_SIZE} bytes)`
    );
  }
}

// ============================================================================
// EXECUTION TRACKING WITH RESOURCE MANAGEMENT
// ============================================================================

const activeExecutions = new Map<string, WorkflowExecutionTracker>();
let cleanupIntervalId: NodeJS.Timeout | null = null;

function startExecutionCleanup(): void {
  if (cleanupIntervalId) return;
  cleanupIntervalId = setInterval(() => {
    const now = Date.now();
    const staleThreshold = now - SECURITY_LIMITS.STALE_EXECUTION_THRESHOLD_MS;

    for (const [executionId, tracker] of activeExecutions.entries()) {
      if (tracker.startTime < staleThreshold) {
        activeExecutions.delete(executionId);
        logger.warn('Removed stale execution', {
          executionId,
          age: now - tracker.startTime
        });
      }
    }
  }, SECURITY_LIMITS.EXECUTION_CLEANUP_INTERVAL_MS);
}

function stopExecutionCleanup(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

startExecutionCleanup();

function addExecution(executionId: string, tracker: WorkflowExecutionTracker): void {
  if (activeExecutions.size >= SECURITY_LIMITS.MAX_ACTIVE_EXECUTIONS) {
    throw new Error(
      `Maximum active executions reached (${SECURITY_LIMITS.MAX_ACTIVE_EXECUTIONS}). Please try again later.`
    );
  }
  activeExecutions.set(executionId, tracker);
}

// ============================================================================
// WORKFLOW EXECUTION WITH TIMEOUT & RESOURCE MANAGEMENT
// ============================================================================

export async function executeWorkflowByDefinition(
  workflow: WorkflowGraph,
  initialContext: {
    agentId: string;
    tenantId: string;
    triggerDataInjections?: readonly TriggerDataInjection[];
  }
): Promise<WorkflowExecutionContext> {
  validateRequiredContext(workflow, initialContext);
  enforceWorkflowLimits(workflow);

  const executionId = generateExecutionId(workflow.id);
  const baseContext = initExecutionContext(workflow, initialContext, executionId);
  const context = createWorkflowExecutionContext(baseContext, workflow, initialContext, executionId);

  const executionTracker: WorkflowExecutionTracker = {
    executionId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    agentId: initialContext.agentId,
    tenantId: initialContext.tenantId,
    startTime: Date.now(),
    status: 'running'
  };

  addExecution(executionId, executionTracker);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Execution timeout after ${SECURITY_LIMITS.MAX_EXECUTION_TIME_MS}ms`));
    }, SECURITY_LIMITS.MAX_EXECUTION_TIME_MS);
  });

  try {
    logger.info('Starting workflow execution', {
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: initialContext.agentId,
      tenantId: initialContext.tenantId,
      totalNodes: workflow.nodes.length
    });

    if (initialContext.triggerDataInjections && initialContext.triggerDataInjections.length > 0) {
      injectTriggerData(context, initialContext.triggerDataInjections);
    }

    await Promise.race([
      executeWorkflow(context, workflow),
      timeoutPromise
    ]);

    updateExecutionStatus(executionId, 'completed');

    const totalDuration = Date.now() - context.executionMetadata.startTime;
    const nodeMetrics = context.nodeData;
    const completedNodes = Object.keys(nodeMetrics).length;
    const totalNodes = workflow.nodes.length;

    logger.info('Workflow execution completed', {
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: initialContext.agentId,
      tenantId: initialContext.tenantId,
      duration: totalDuration,
      executionMetrics: {
        totalNodes,
        completedNodes,
        failedNodes: totalNodes - completedNodes,
        successRate: `${((completedNodes / totalNodes) * 100).toFixed(1)}%`,
        averageNodeDuration: completedNodes > 0 ? Math.round(totalDuration / completedNodes) : 0
      }
    });

    return context;

  } catch (error) {
    updateExecutionStatus(executionId, 'failed');

    const errorMessage = sanitizeErrorMessage(error);
    logger.error('Workflow execution failed', {
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: initialContext.agentId,
      tenantId: initialContext.tenantId,
      error: errorMessage
    });

    throw new Error(`Workflow execution failed: ${errorMessage}`);
  } finally {
    activeExecutions.delete(executionId);
  }
}

function validateRequiredContext(
  workflow: WorkflowGraph | null | undefined,
  initialContext: { agentId: string; tenantId: string } | null | undefined
): asserts workflow is WorkflowGraph {
  if (!workflow?.nodes?.length) {
    throw new Error('Workflow must have at least one node');
  }
  if (!initialContext) {
    throw new Error('Initial context with agentId and tenantId is required');
  }
  validateIdentifier(initialContext.agentId, 'agentId');
  validateIdentifier(initialContext.tenantId, 'tenantId');
  validateIdentifier(workflow.id, 'workflowId');
}

function enforceWorkflowLimits(workflow: WorkflowGraph): void {
  if (workflow.nodes.length > SECURITY_LIMITS.MAX_WORKFLOW_NODES) {
    throw new Error(
      `Workflow exceeds maximum node count (${SECURITY_LIMITS.MAX_WORKFLOW_NODES})`
    );
  }
  if (workflow.edges.length > SECURITY_LIMITS.MAX_WORKFLOW_EDGES) {
    throw new Error(
      `Workflow exceeds maximum edge count (${SECURITY_LIMITS.MAX_WORKFLOW_EDGES})`
    );
  }
}

function initExecutionContext(
  workflow: WorkflowGraph,
  initialContext: { agentId: string; tenantId: string },
  executionId: string
): Partial<WorkflowExecutionContext> {
  return {
    executionId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    agentId: initialContext.agentId,
    tenantId: initialContext.tenantId,
    startTime: Date.now(),
    status: 'running',
    nodeData: createSafeObject(),
    variables: createSafeObject(),
    executionMetadata: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: initialContext.agentId,
      tenantId: initialContext.tenantId,
      executionId,
      startTime: Date.now()
    }
  };
}

function createWorkflowExecutionContext(
  baseContext: Partial<WorkflowExecutionContext>,
  workflow: WorkflowGraph,
  initialContext: { agentId: string; tenantId: string },
  executionId: string
): WorkflowExecutionContext {
  const startTime = Date.now();

  const executionMetadata: ExecutionMetadata = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    agentId: initialContext.agentId,
    tenantId: initialContext.tenantId,
    executionId,
    startTime
  };

  const workflowContext: WorkflowExecutionContext = {
    ...baseContext,
    executionId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    agentId: initialContext.agentId,
    tenantId: initialContext.tenantId,
    startTime,
    status: 'running' as const,
    nodeData: baseContext.nodeData || createSafeObject(),
    variables: baseContext.variables || createSafeObject(),
    executionMetadata
  } as WorkflowExecutionContext;

  const vars = workflowContext.variables || {};

  safeSetProperty(vars, 'workflowId', workflow.id);
  safeSetProperty(vars, 'workflowName', workflow.name);
  safeSetProperty(vars, 'executionId', executionId);
  safeSetProperty(vars, 'agentId', initialContext.agentId);
  safeSetProperty(vars, 'tenantId', initialContext.tenantId);
  safeSetProperty(vars, 'execution', executionMetadata);

  (workflowContext as { variables: Record<string, unknown> }).variables = vars;

  logger.debug('Execution metadata stored', {
    executionId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    agentId: initialContext.agentId,
    tenantId: initialContext.tenantId
  });

  return workflowContext;
}

async function executeWorkflow(
  context: WorkflowExecutionContext,
  workflowGraph: WorkflowGraph
): Promise<void> {
  const completedNodes = new Set<string>();

  // Mark trigger nodes as completed
  const triggerNodes = workflowGraph.nodes.filter(node => isTriggerNode(node));
  for (const triggerNode of triggerNodes) {
    completedNodes.add(triggerNode.id);
    logger.debug('Trigger node marked as completed', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      nodeId: triggerNode.id,
      nodeName: triggerNode.name
    });
  }

  // Execute nodes in dependency order
  const executionOrder = buildExecutionOrder(workflowGraph);
  
  for (const executionLevel of executionOrder) {
    const levelPromises: Promise<void>[] = [];

    for (const nodeId of executionLevel) {
      const node = workflowGraph.nodes.find(n => n.id === nodeId);
      if (!node || node.disabled || completedNodes.has(nodeId)) {
        continue;
      }

      const nodePromise = executeNode(node, context, workflowGraph)
        .then(result => {
          if (result.success) {
            completedNodes.add(nodeId);
            logger.debug('Node completed successfully', {
              executionId: context.executionId,
              workflowId: context.workflowId,
              workflowName: context.workflowName,
              agentId: context.agentId,
              tenantId: context.tenantId,
              nodeId: node.id,
              nodeName: node.name,
              duration: result.duration
            });
          } else {
            throw new Error(`Node execution failed: ${result.error}`);
          }
        });

      levelPromises.push(nodePromise);
    }

    if (levelPromises.length > 0) {
      await Promise.all(levelPromises);
    }
  }
}

function buildExecutionOrder(workflow: WorkflowGraph): string[][] {
  const levels: string[][] = [];
  const visited = new Set<string>();
  const inProgress = new Set<string>();

  function visit(nodeId: string, level: number): void {
    if (inProgress.has(nodeId)) {
      throw new Error(`Circular dependency detected involving node: ${nodeId}`);
    }
    if (visited.has(nodeId)) {
      return;
    }

    inProgress.add(nodeId);

    // Find all nodes that depend on this node
    const dependentNodes = workflow.edges
      .filter(edge => edge.source === nodeId)
      .map(edge => edge.target);

    for (const dependentNodeId of dependentNodes) {
      visit(dependentNodeId, level + 1);
    }

    inProgress.delete(nodeId);
    visited.add(nodeId);

    // Ensure we have enough levels
    while (levels.length <= level) {
      levels.push([]);
    }
    levels[level]!.push(nodeId);
  }

  // Start with nodes that have no dependencies (trigger nodes)
  const triggerNodes = workflow.nodes.filter(node => isTriggerNode(node));
  for (const triggerNode of triggerNodes) {
    visit(triggerNode.id, 0);
  }

  // Visit remaining nodes
  for (const node of workflow.nodes) {
    if (!visited.has(node.id)) {
      visit(node.id, 0);
    }
  }

  return levels;
}

async function executeNode(
  node: WorkflowNode,
  context: WorkflowExecutionContext,
  workflowGraph: WorkflowGraph
): Promise<NodeExecutionResult> {
  const startTime = Date.now();

  try {
    if (isTriggerNode(node)) {
      const triggerData = safeGetProperty(context.nodeData as Record<string, unknown>, node.name) || {
        triggerType: node.config?.triggerType || 'unknown',
        timestamp: new Date().toISOString(),
        status: 'triggered'
      };

      storeNodeResult(node, context, { json: triggerData as Record<string, unknown> }, startTime);
      return {
        success: true,
        duration: Date.now() - startTime
      };
    }

    if (node.type === 'ai_agent') {
      return await executeAgentNode(node, context);
    }

    if (node.type === 'action') {
      return await executeActionNode(node, context);
    }

    logger.warn('Unknown node type', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type
    });

    return {
      success: false,
      error: `Unknown node type: ${node.type}`,
      duration: Date.now() - startTime
    };

  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);
    logger.error('Node execution failed', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      nodeId: node.id,
      nodeName: node.name,
      error: errorMessage
    });

    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime
    };
  }
}

async function executeAgentNode(
  node: WorkflowNode,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const startTime = Date.now();

  if (!node.agentConfig) {
    return {
      success: false,
      error: 'Agent node missing agentConfig',
      duration: Date.now() - startTime
    };
  }

  try {
    const agentConfig = node.agentConfig;
    const llmAdapter = llmAdapterService;

    // Resolve user prompt with template variables
    const userPrompt = resolveTemplateVariables(agentConfig.userPrompt, context);

    const llmRequest: LLMRequest = {
      systemPrompt: agentConfig.systemPrompt,
      userPrompt,
      model: agentConfig.llm.model,
      temperature: agentConfig.llm.temperature ?? undefined,
      maxTokens: agentConfig.llm.maxTokens ?? undefined,
      tools: agentConfig.tools?.tools ?? undefined,
      credentials: agentConfig.llm.credentials ?? undefined
    };

    logger.info('Executing agent node with LLM', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeName: node.name,
      model: llmRequest.model,
      provider: agentConfig.llm.provider
    });

    const llmResponse = await llmAdapter.generate(
      agentConfig.llm.provider,
      llmRequest,
      context
    );

    const result: NodeResult = {
      json: {
        output: llmResponse.output,
        agentOutput: llmResponse.output,
        response: llmResponse.output,
        model: llmResponse.model,
        success: llmResponse.success,
        timestamp: llmResponse.timestamp,
        usage: llmResponse.usage
      }
    };

    storeNodeResult(node, context, result, startTime);

    return {
      success: true,
      result,
      duration: Date.now() - startTime
    };

  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);
    logger.error('Agent node execution failed', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeName: node.name,
      error: errorMessage
    });

    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime
    };
  }
}

async function executeActionNode(
  node: WorkflowNode,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const startTime = Date.now();

  try {
    logger.info('Executing action node', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeName: node.name,
      integration: node.integration,
      function: node.function
    });

    // For now, action nodes are mainly for webchat replies
    // In the future, this could be extended to support other integrations
    if (node.integration === 'webchat' && node.function === 'execute') {
      const result: NodeResult = {
        json: {
          success: true,
          message: 'Action executed successfully',
          timestamp: new Date().toISOString()
        }
      };

      storeNodeResult(node, context, result, startTime);

      return {
        success: true,
        result,
        duration: Date.now() - startTime
      };
    }

    return {
      success: false,
      error: `Unsupported action: ${node.integration}.${node.function}`,
      duration: Date.now() - startTime
    };

  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);
    logger.error('Action node execution failed', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeName: node.name,
      error: errorMessage
    });

    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime
    };
  }
}

function resolveTemplateVariables(template: string, context: WorkflowExecutionContext): string {
  // Simple template variable resolution
  // Replace {{$json.nodeName.field}} with actual values from context.nodeData
  return template.replace(/\{\{\s*\$json\.([^}]+)\s*\}\}/g, (match, path) => {
    const parts = path.split('.');
    if (parts.length >= 2) {
      const nodeName = parts[0];
      const fieldName = parts[1];
      
      const nodeData = safeGetProperty(context.nodeData as Record<string, unknown>, nodeName);
      if (nodeData && typeof nodeData === 'object') {
        const fieldValue = safeGetProperty(nodeData as Record<string, unknown>, fieldName);
        if (fieldValue !== undefined) {
          return String(fieldValue);
        }
      }
    }
    return match; // Return original if not found
  });
}

function storeNodeResult(
  node: WorkflowNode,
  context: WorkflowExecutionContext,
  result: NodeResult,
  startTime: number
): void {
  const executionTime = Date.now() - startTime;
  const timestamp = new Date().toISOString();

  const resultObj = (result && typeof result === 'object') ? result as unknown as Record<string, unknown> : {};
  const jsonData = ('json' in resultObj) ? resultObj.json : result || {};
  const jsonDataObj = (jsonData && typeof jsonData === 'object') ? jsonData as Record<string, unknown> : {};

  try {
    validateObjectSize(jsonDataObj);
  } catch (error) {
    logger.warn('Node result exceeds size limit, truncating', {
      executionId: context.executionId,
      nodeId: node.id,
      error: sanitizeErrorMessage(error)
    });
    const minimalResult = {
      success: true,
      timestamp,
      error: 'Result truncated due to size limit'
    };
    safeSetProperty(context.nodeData as Record<string, unknown>, node.id, minimalResult);
    safeSetProperty(context.nodeData as Record<string, unknown>, node.name, minimalResult);
    return;
  }

  function ensureAliases(r: unknown): Record<string, unknown> {
    try {
      const payload = (r && typeof r === 'object' && 'json' in r) ? (r as { json: unknown }).json : r;
      if (!payload || typeof payload !== 'object') return {};
      const obj = payload as Record<string, unknown>;
      const primaryText = (typeof obj.message === 'string' && obj.message)
        || (typeof obj.text === 'string' && obj.text)
        || (typeof obj.content === 'string' && obj.content)
        || (typeof obj.response === 'string' && obj.response)
        || (typeof obj.output === 'string' && obj.output)
        || (typeof obj.result === 'string' && obj.result);
      if (!primaryText) return {};
      return {
        message: obj.message ?? primaryText,
        text: obj.text ?? primaryText,
        content: obj.content ?? primaryText,
        response: obj.response ?? primaryText,
        output: obj.output ?? primaryText,
        result: obj.result ?? primaryText
      };
    } catch {
      return {};
    }
  }

  const nodeResult = {
    ...(typeof jsonDataObj === 'object' ? jsonDataObj : {}),
    ...ensureAliases(result),
    success: true,
    timestamp: new Date().toISOString()
  };

  safeSetProperty(context.nodeData as Record<string, unknown>, node.id, nodeResult);
  safeSetProperty(context.nodeData as Record<string, unknown>, node.name, nodeResult);

  const vars = context.variables || {};
  if (!vars.json) {
    safeSetProperty(vars, 'json', createSafeObject());
  }

  const jsonVars = vars.json as Record<string, unknown>;
  const varData = {
    ...(typeof jsonDataObj === 'object' ? jsonDataObj : {}),
    ...ensureAliases(result)
  };

  safeSetProperty(jsonVars, node.id, varData);
  safeSetProperty(jsonVars, node.name, varData);

  (context as { variables: Record<string, unknown> }).variables = vars;

  logger.debug('Node result stored', {
    executionId: context.executionId,
    nodeId: node.id,
    nodeName: node.name,
    storedKeys: Object.keys(nodeResult),
    executionTime
  });
}

function injectTriggerData(
  context: WorkflowExecutionContext,
  triggerDataInjections: readonly TriggerDataInjection[]
): void {
  logger.info('Injecting trigger data', {
    executionId: context.executionId,
    workflowId: context.workflowId,
    workflowName: context.workflowName,
    agentId: context.agentId,
    tenantId: context.tenantId,
    count: triggerDataInjections.length
  });

  for (const injection of triggerDataInjections) {
    if (!injection.nodeName) {
      logger.warn('Invalid trigger injection - missing nodeName', {
        executionId: context.executionId,
        workflowId: context.workflowId,
        agentId: context.agentId,
        tenantId: context.tenantId
      });
      continue;
    }

    try {
      validateNodeName(injection.nodeName);
    } catch (error) {
      logger.warn('Invalid trigger injection - invalid nodeName', {
        executionId: context.executionId,
        error: sanitizeErrorMessage(error)
      });
      continue;
    }

    const enrichedData = {
      ...(typeof injection.data === 'object' && injection.data !== null ? injection.data : {}),
      nodeId: injection.nodeId || injection.nodeName,
      nodeName: injection.nodeName,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      executionId: context.executionId,
      timestamp: new Date().toISOString(),
      source: 'trigger',
      triggerType: injection.triggerType || 'unknown'
    };

    const nodeId = injection.nodeId || injection.nodeName;
    const nodeName = injection.nodeName;

    safeSetProperty(context.nodeData as Record<string, unknown>, nodeId, enrichedData);
    if (nodeId !== nodeName) {
      safeSetProperty(context.nodeData as Record<string, unknown>, nodeName, enrichedData);
    }

    const vars = context.variables || {};
    if (!vars.json) {
      safeSetProperty(vars, 'json', createSafeObject());
    }

    const jsonVars = vars.json as Record<string, unknown>;
    safeSetProperty(jsonVars, nodeId, injection.data);
    if (nodeId !== nodeName) {
      safeSetProperty(jsonVars, nodeName, injection.data);
    }

    (context as { variables: Record<string, unknown> }).variables = vars;

    logger.debug('Trigger data injected', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      nodeId: nodeId,
      nodeName: nodeName
    });
  }
}

function updateExecutionStatus(executionId: string, status: 'completed' | 'failed'): void {
  const execution = activeExecutions.get(executionId);
  if (execution) {
    const updatedExecution: WorkflowExecutionTracker = {
      ...execution,
      status
    };
    activeExecutions.set(executionId, updatedExecution);
  }
}

function isTriggerNode(node: WorkflowNode): boolean {
  return node.type === 'trigger' ||
    Boolean(node.config?.triggerType) ||
    node.name.toLowerCase().includes('trigger');
}

function generateExecutionId(workflowId: string): string {
  const timestamp = Date.now();
  const random = randomUUID().slice(0, 8);
  const safeWorkflowId = workflowId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `exec_${safeWorkflowId}_${timestamp}_${random}`;
}

export function getActiveExecutions(): readonly WorkflowExecutionTracker[] {
  return Array.from(activeExecutions.values());
}

export function getExecutionById(executionId: string): WorkflowExecutionTracker | null {
  try {
    validateIdentifier(executionId, 'executionId');
  } catch {
    return null;
  }
  return activeExecutions.get(executionId) || null;
}

export function shutdown(): void {
  stopExecutionCleanup();
  activeExecutions.clear();
  logger.info('Workflow executor shutdown complete');
}
