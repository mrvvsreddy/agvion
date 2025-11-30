// path: src/types/context.ts

/**
 * Base execution context used across the system
 */
export interface ExecutionContext {
  executionId: string;
  agentId: string;
  workflowId: string;
  message?: any;
  variables: Record<string, any>;
  stepResults: Record<string, any>;
  metadata?: Record<string, any>;
  preInjectedTriggers?: Record<string, PreInjectedTriggerData>;
}

export interface PreInjectedTriggerData {
  readonly triggerType: string;
  readonly data: unknown;
  readonly injectedAt: string;
}

/**
 * Extended context for graph-based workflow execution
 */
export interface GraphExecutionContext extends ExecutionContext {
  messageId: string;
  nodeResults: Map<string, NodeResult>;
  startTime: number;
  status: ExecutionStatus;
  endTime?: number;
}

/**
 * Execution status types
 */
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Node execution result structure
 */
export interface NodeResult {
  json: any;
  binary?: Record<string, any> | undefined;
  metadata: NodeResultMetadata;
}

/**
 * Node result metadata
 */
export interface NodeResultMetadata {
  executionId: string;
  nodeId: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string | undefined;
}

/**
 * Integration function result structure
 */
export interface IntegrationResult {
  json: any;
  binary?: Record<string, any> | undefined;
}

/**
 * Context adapter utility to bridge between different context types
 */
export class ContextAdapter {
  /**
   * Convert GraphExecutionContext to ExecutionContext for integrations
   */
  static toExecutionContext(graphContext: GraphExecutionContext): ExecutionContext {
    return {
      executionId: graphContext.executionId,
      agentId: graphContext.agentId,
      workflowId: graphContext.workflowId,
      message: graphContext.message,
      variables: graphContext.variables,
      stepResults: this.convertNodeResultsToStepResults(graphContext.nodeResults)
    };
  }

  /**
   * Convert node results map to step results record
   */
  private static convertNodeResultsToStepResults(
    nodeResults: Map<string, NodeResult>
  ): Record<string, any> {
    const stepResults: Record<string, any> = {};
    
    for (const [nodeId, result] of nodeResults.entries()) {
      if (result.metadata.success) {
        stepResults[nodeId] = result.json;
      }
    }
    
    return stepResults;
  }

  /**
   * Update GraphExecutionContext with integration result
   */
  static updateGraphContextWithResult(
    graphContext: GraphExecutionContext,
    nodeId: string,
    result: IntegrationResult
  ): void {
    // Update stepResults for compatibility
    if (result.json !== null && result.json !== undefined) {
      graphContext.stepResults[nodeId] = result.json;
    }
  }
}

/**
 * Type guard to check if context is GraphExecutionContext
 */
export function isGraphExecutionContext(
  context: ExecutionContext
): context is GraphExecutionContext {
  return 'nodeResults' in context && 'startTime' in context && 'status' in context;
}

/**
 * Type guard to check if result is valid NodeResult
 */
export function isValidNodeResult(result: any): result is NodeResult {
  return (
    result &&
    typeof result === 'object' &&
    'metadata' in result &&
    typeof result.metadata === 'object' &&
    'executionId' in result.metadata &&
    'nodeId' in result.metadata &&
    'success' in result.metadata
  );
}

/**
 * Type guard to check if result is valid IntegrationResult
 */
export function isValidIntegrationResult(result: any): result is IntegrationResult {
  return (
    result &&
    typeof result === 'object' &&
    ('json' in result || 'binary' in result)
  );
}