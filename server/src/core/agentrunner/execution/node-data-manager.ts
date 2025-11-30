import logger from '../../../utils/logger';
import { GraphNode, NodeResult } from './types';
import { 
  ExecutionContext,
  IntegrationResult
} from '../../../types/context';
import { TriggerDataInjection } from './types';

// Node-based semantic data structure - each node stores its execution results
export interface SemanticNodeData {
  readonly [nodeName: string]: Record<string, unknown>;
}

export interface TypeSafeExecutionContext {
  [x: string]: {};
  readonly executionId: string;
  readonly workflowId: string;
  readonly agentId: string;
  readonly nodeData: SemanticNodeData;
  readonly startTime: number;
  status: 'running' | 'completed' | 'failed';
}

export function initExecutionContext(
  workflow: { id: string; agentId?: string },
  initialContext: { 
    readonly agentId?: string; 
    readonly triggerDataInjections?: readonly TriggerDataInjection[];
  },
  executionId: string
): TypeSafeExecutionContext {
  // Initialize nodeData as a mutable plain object to allow dynamic property assignment
  const nodeData = {} as Record<string, unknown>;
  
  return {
    executionId,
    workflowId: workflow.id,
    agentId: initialContext.agentId || workflow.agentId || 'unknown',
    nodeData: nodeData as any, // Cast to allow dynamic property assignment
    startTime: Date.now(),
    status: 'running'
  };
}

export function getNodeData(
  context: TypeSafeExecutionContext, 
  nodeName: string
): Record<string, unknown> | undefined {
  return context.nodeData[nodeName];
}

export function getAllNodeData(
  context: TypeSafeExecutionContext
): Readonly<SemanticNodeData> {
  return Object.freeze({ ...context.nodeData });
}

export async function storeNodeResultAsNodeData(
  node: GraphNode,
  context: TypeSafeExecutionContext,
  integrationResult: IntegrationResult,
  startTime: number
): Promise<NodeResult> {
  const endTime = Date.now();
  const nodeName = node.name;

  const metadata = {
    executionId: context.executionId,
    nodeId: node.id,
    startTime,
    endTime,
    duration: endTime - startTime,
    success: true
  };

  const nodeResult: NodeResult = {
    json: integrationResult.json,
    binary: integrationResult.binary ? { data: integrationResult.binary } : undefined,
    metadata
  };

  const nodeData: Record<string, unknown> = {
    executionId: context.executionId,
    nodeId: node.id,
    nodeName,
    startTime,
    endTime,
    duration: endTime - startTime,
    success: true,
    timestamp: new Date().toISOString(),
    ...((integrationResult.json && typeof integrationResult.json === 'object' && !Array.isArray(integrationResult.json)) 
      ? (integrationResult.json as Record<string, unknown>)
      : { result: integrationResult.json }),
    ...(integrationResult.binary && { 
      hasBinary: true,
      binarySize: integrationResult.binary.length,
      binaryType: 'buffer'
    })
  };

  // Ensure message/text/content aliases exist when primary text is present
  try {
    const payload = (integrationResult.json && typeof integrationResult.json === 'object')
      ? (integrationResult.json as Record<string, unknown>)
      : { result: integrationResult.json } as Record<string, unknown>;
    const primaryText = (typeof payload.message === 'string' && payload.message)
      || (typeof payload.text === 'string' && payload.text)
      || (typeof payload.content === 'string' && payload.content)
      || (typeof payload.response === 'string' && payload.response)
      || (typeof payload.output === 'string' && payload.output)
      || (typeof payload.result === 'string' && payload.result);
    if (primaryText) {
      if (nodeData.message === undefined) (nodeData as any).message = primaryText;
      if (nodeData.text === undefined) (nodeData as any).text = primaryText;
      if (nodeData.content === undefined) (nodeData as any).content = primaryText;
      if (nodeData.response === undefined) (nodeData as any).response = primaryText;
      if (nodeData.output === undefined) (nodeData as any).output = primaryText;
      if (nodeData.result === undefined) (nodeData as any).result = primaryText;
    }
  } catch {}

  (context.nodeData as Record<string, Record<string, unknown>>)[nodeName] = nodeData;

  logger.info('Node result stored', {
    executionId: context.executionId,
    nodeId: node.id,
    nodeName,
    duration: endTime - startTime
  });

  return nodeResult;
}

export function addNodeData(
  context: TypeSafeExecutionContext,
  nodeName: string,
  data: Record<string, unknown>
): void {
  const enrichedData = {
    ...data,
    nodeName,
    addedAt: new Date().toISOString(),
    executionId: context.executionId
  };

  (context.nodeData as Record<string, Record<string, unknown>>)[nodeName] = enrichedData;

  logger.info('Node data added', {
    executionId: context.executionId,
    nodeName
  });
}

export function updateNodeField(
  context: TypeSafeExecutionContext,
  nodeName: string,
  fieldName: string,
  value: unknown
): boolean {
  const nodeData = context.nodeData[nodeName];
  if (!nodeData) {
    logger.warn('Cannot update field: node not found', {
      executionId: context.executionId,
      nodeName,
      fieldName,
      availableNodes: Object.keys(context.nodeData)
    });
    return false;
  }

  const updatedData = {
    ...nodeData,
    [fieldName]: value,
    lastUpdated: new Date().toISOString()
  };

  (context.nodeData as Record<string, Record<string, unknown>>)[nodeName] = updatedData;



  return true;
}

export function getNodeDataWithTypes(
  context: TypeSafeExecutionContext,
  nodeName: string
): {
  readonly data: Record<string, unknown> | null;
  readonly fieldTypes: Record<string, string>;
  readonly exists: boolean;
} {
  const nodeData = context.nodeData[nodeName];
  if (!nodeData) {
    return {
      data: null,
      fieldTypes: {},
      exists: false
    };
  }

  const fieldTypes: Record<string, string> = {};
  for (const [fieldName, value] of Object.entries(nodeData)) {
    fieldTypes[fieldName] = Array.isArray(value) ? 'array' : typeof value;
  }

  return {
    data: { ...nodeData },
    fieldTypes,
    exists: true
  };
}



export function bulkUpdateNodeData(
  context: TypeSafeExecutionContext,
  updates: readonly {
    readonly nodeName: string;
    readonly fieldUpdates: Record<string, unknown>;
  }[]
): {
  readonly successful: number;
  readonly failed: readonly string[];
} {
  const failed: string[] = [];
  let successful = 0;

  for (const update of updates) {
    const nodeData = context.nodeData[update.nodeName];
    if (!nodeData) {
      failed.push(update.nodeName);
      continue;
    }
    try {
      const updatedData = {
        ...nodeData,
        ...update.fieldUpdates,
        lastBulkUpdate: new Date().toISOString()
      };
      (context.nodeData as Record<string, Record<string, unknown>>)[update.nodeName] = updatedData;
      successful++;
    } catch (error) {
      failed.push(update.nodeName);
      logger.warn('Bulk update failed for node', {
        executionId: context.executionId,
        nodeName: update.nodeName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.info('Bulk update completed', {
    executionId: context.executionId,
    successful,
    failed: failed.length
  });

  return { successful, failed };
}

export function queryNodeData(
  context: TypeSafeExecutionContext,
  filter: {
    readonly nodeNames?: readonly string[];
    readonly hasFields?: readonly string[];
    readonly fieldValues?: Record<string, unknown>;
  } = {}
): Record<string, Record<string, unknown>> {
  const results: Record<string, Record<string, unknown>> = {};
  for (const [nodeName, nodeData] of Object.entries(context.nodeData)) {
    if (filter.nodeNames && !filter.nodeNames.includes(nodeName)) {
      continue;
    }
    if (filter.hasFields && !filter.hasFields.every(field => field in nodeData)) {
      continue;
    }
    if (filter.fieldValues) {
      const matchesValues = Object.entries(filter.fieldValues).every(([field, expectedValue]) => 
        nodeData[field] === expectedValue
      );
      if (!matchesValues) {
        continue;
      }
    }
    results[nodeName] = { ...nodeData };
  }
  return results;
}



export async function injectTriggerData(
  context: TypeSafeExecutionContext,
  injections: readonly TriggerDataInjection[]
): Promise<void> {
  if (injections.length === 0) {
    return;
  }
  let successfulInjections = 0;
  let failedInjections = 0;
  for (const injection of injections) {
    try {
      const triggerNodeName = injection.nodeId || 'trigger';
      let injectionData: Record<string, unknown>;
      if (injection.data && typeof injection.data === 'object' && !Array.isArray(injection.data)) {
        injectionData = JSON.parse(JSON.stringify(injection.data)) as Record<string, unknown>;
      } else {
        injectionData = { 
          value: injection.data,
          type: typeof injection.data,
          injectedAt: new Date().toISOString()
        };
      }
      const enrichedData = {
        ...injectionData,
        executionId: context.executionId,
        nodeId: injection.nodeId,
        triggerType: injection.triggerType,
        timestamp: new Date().toISOString(),
        success: true
      };
      (context.nodeData as Record<string, Record<string, unknown>>)[triggerNodeName] = enrichedData;
      successfulInjections++;
        logger.info('Trigger data injected', {
    executionId: context.executionId,
    nodeId: injection.nodeId,
    triggerNodeName
  });
    } catch (injectionError) {
      failedInjections++;
      logger.warn('Failed to inject trigger data', {
        executionId: context.executionId,
        nodeId: injection.nodeId,
        error: injectionError instanceof Error ? injectionError.message : String(injectionError)
      });
    }
  }
  logger.info('Trigger data injection completed', {
    executionId: context.executionId,
    successfulInjections,
    failedInjections
  });
}

export function convertToExecutionContext(context: TypeSafeExecutionContext): ExecutionContext {
  return {
    executionId: context.executionId,
    workflowId: context.workflowId,
    agentId: context.agentId,
    variables: context.variables || {
      nodes: context.nodeData
    },
    stepResults: {}
  };
}


