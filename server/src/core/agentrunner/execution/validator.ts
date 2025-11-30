// path: src/validation/graphValidator.ts

import { 
  WorkflowGraph, 
  GraphNode, 
  GraphEdge, 
  DependencyMap, 
  ExecutionPlan,
  ValidationResult,
  NodeValidationResult,
  GraphValidationResult,
  WorkflowSchema,
  GraphValidationError,
  CircularDependencyError,
  RESERVED_NODE_TYPES,
  isGraphNode,
  isGraphEdge
} from './types';

/**
 * Define and validate workflow schema
 */
export function defineWorkflowSchema(graph: WorkflowGraph): WorkflowSchema {
  const validationResult = validateWorkflow(graph);
  
  if (!validationResult.valid) {
    throw new GraphValidationError(
      'Workflow validation failed',
      validationResult.errors
    );
  }

  const dependencyMap = buildDependencyMap(graph);
  const executionPlan = createExecutionPlan(graph, dependencyMap);

  return {
    graph,
    validationResult,
    executionPlan
  };
}

/**
 * Build dependency map from graph edges
 */
export function buildDependencyMap(graph: WorkflowGraph): DependencyMap {
  const dependencyMap: DependencyMap = {};

  // Initialize all nodes
  graph.nodes.forEach(node => {
    dependencyMap[node.id] = {
      dependencies: [],
      dependents: []
    };
  });

  // Build dependencies from edges
  graph.edges.forEach(edge => {
    const sourceNode = dependencyMap[edge.source];
    const targetNode = dependencyMap[edge.target];

    if (sourceNode && targetNode) {
      // Target depends on source
      targetNode.dependencies.push(edge.source);
      // Source has target as dependent
      sourceNode.dependents.push(edge.target);
    }
  });

  // Remove duplicates
  Object.values(dependencyMap).forEach(node => {
    node.dependencies = [...new Set(node.dependencies)];
    node.dependents = [...new Set(node.dependents)];
  });

  return dependencyMap;
}

/**
 * Validate individual nodes
 */
export function validateNodes(graph: WorkflowGraph): NodeValidationResult[] {
  const results: NodeValidationResult[] = [];
  const nodeIds = new Set<string>();

  graph.nodes.forEach(node => {
    const validation: NodeValidationResult = {
      nodeId: node.id,
      nodeName: node.name,
      valid: true,
      errors: [],
      warnings: []
    };

    // Check for duplicate IDs
    if (nodeIds.has(node.id)) {
      validation.errors.push(`Duplicate node ID: ${node.id}`);
    } else {
      nodeIds.add(node.id);
    }

    // Validate node structure
    if (!isGraphNode(node)) {
      validation.errors.push('Invalid node structure');
    }

    // Required fields with null/undefined checks
    if (!node.id || !node.id.trim()) {
      validation.errors.push('Node ID is required');
    }
    if (!node.name || !node.name.trim()) {
      validation.errors.push('Node name is required');
    }
    if (!node.type || !node.type.trim()) {
      validation.errors.push('Node type is required');
    }

    // Validate executable nodes
    if (isExecutableNode(node)) {
      if (!node.integration || !node.integration.trim()) {
        validation.errors.push('Integration is required for executable nodes');
      }
      if (!node.function || !node.function.trim()) {
        validation.errors.push('Function is required for executable nodes');
      }
    }

    // Node ID format validation
    if (node.id && !/^[a-zA-Z0-9_-]+$/.test(node.id)) {
      validation.errors.push('Node ID must contain only letters, numbers, underscores, and hyphens');
    }

    // Reserved node type validation
    if (RESERVED_NODE_TYPES.includes(node.type as any) && !isValidReservedNode(node)) {
      validation.warnings.push(`Reserved node type '${node.type}' may have special handling`);
    }

    validation.valid = validation.errors.length === 0;
    results.push(validation);
  });

  return results;
}

/**
 * Validate graph edges
 */
export function validateEdges(graph: WorkflowGraph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const edgeIds = new Set<string>();

  graph.edges.forEach((edge, index) => {
    // Check edge structure
    if (!isGraphEdge(edge)) {
      errors.push(`Edge ${index + 1}: Invalid edge structure`);
      return;
    }

    // Check for duplicate edge IDs
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge ID: ${edge.id}`);
    } else {
      edgeIds.add(edge.id);
    }

    // Validate source node exists
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id}: Source node '${edge.source}' does not exist`);
    }

    // Validate target node exists
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id}: Target node '${edge.target}' does not exist`);
    }

    // Self-reference check
    if (edge.source === edge.target) {
      errors.push(`Edge ${edge.id}: Node cannot connect to itself`);
    }

    // Edge ID format validation
    if (edge.id && !/^[a-zA-Z0-9_-]+$/.test(edge.id)) {
      errors.push(`Edge ${edge.id}: Edge ID must contain only letters, numbers, underscores, and hyphens`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Detect cycles in the graph using DFS
 */
export function detectCycles(graph: WorkflowGraph): { hasCycles: boolean; cycles: string[][] } {
  const dependencyMap = buildDependencyMap(graph);
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(nodeId: string, path: string[]): void {
    if (recursionStack.has(nodeId)) {
      // Found a cycle
      const cycleStart = path.indexOf(nodeId);
      const cycle = path.slice(cycleStart).concat([nodeId]);
      cycles.push(cycle);
      return;
    }

    if (visited.has(nodeId)) {
      return;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const nodeData = dependencyMap[nodeId];
    const dependencies = nodeData ? nodeData.dependents : [];
    dependencies.forEach(depId => {
      dfs(depId, [...path]);
    });

    recursionStack.delete(nodeId);
    path.pop();
  }

  // Start DFS from all nodes to catch disconnected cycles
  graph.nodes.forEach(node => {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  });

  return {
    hasCycles: cycles.length > 0,
    cycles: cycles
  };
}

/**
 * Complete workflow validation
 */
export function validateWorkflow(graph: WorkflowGraph): GraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic graph structure validation with null/undefined checks
  if (!graph.id || !graph.id.trim()) {
    errors.push('Workflow ID is required');
  }
  if (!graph.name || !graph.name.trim()) {
    errors.push('Workflow name is required');
  }
  if (!graph.agentId || !graph.agentId.trim()) {
    errors.push('Agent ID is required');
  }

  // Check for nodes
  if (!graph.nodes || graph.nodes.length === 0) {
    errors.push('Workflow must contain at least one node');
  }

  // Validate nodes
  const nodeValidations = validateNodes(graph);
  nodeValidations.forEach(validation => {
    errors.push(...validation.errors);
    warnings.push(...validation.warnings);
  });

  // Validate edges
  const edgeValidation = validateEdges(graph);
  errors.push(...edgeValidation.errors);
  warnings.push(...edgeValidation.warnings);

  // Check for cycles
  const cycleDetection = detectCycles(graph);
  let hasCycles = false;
  let cycles: string[][] | undefined;

  if (cycleDetection.hasCycles) {
    hasCycles = true;
    cycles = cycleDetection.cycles;
    cycles.forEach(cycle => {
      errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
    });
  }

  // Check for disconnected nodes
  const connectedNodes = getConnectedNodes(graph);
  const disconnectedNodes = graph.nodes.filter(node => !connectedNodes.has(node.id));
  
  if (disconnectedNodes.length > 0) {
    disconnectedNodes.forEach(node => {
      warnings.push(`Node '${node.name}' (${node.id}) is not connected to the workflow`);
    });
  }

  // Check for entry points
  const entryNodes = findEntryNodes(graph);
  if (entryNodes.length === 0 && graph.nodes.length > 0) {
    errors.push('Workflow must have at least one entry node (node without dependencies)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    nodeValidations,
    hasCycles,
    cycles
  };
}

/**
 * Create execution plan with topological ordering
 */
function createExecutionPlan(graph: WorkflowGraph, dependencyMap: DependencyMap): ExecutionPlan {
  const entryNodes = findEntryNodes(graph);
  const executionOrder = topologicalSort(graph, dependencyMap);

  return {
    entryNodes,
    executionOrder,
    dependencyMap,
    totalNodes: graph.nodes.length
  };
}

/**
 * Find entry nodes (nodes without dependencies)
 */
export function findEntryNodes(graph: WorkflowGraph): string[] {
  const dependencyMap = buildDependencyMap(graph);
  return graph.nodes
    .filter(node => !node.disabled)
    .filter(node => {
      const nodeData = dependencyMap[node.id];
      return nodeData ? nodeData.dependencies.length === 0 : true;
    })
    .map(node => node.id);
}

/**
 * Topological sort for execution order
 */
function topologicalSort(graph: WorkflowGraph, dependencyMap: DependencyMap): string[][] {
  const executionLevels: string[][] = [];
  const remainingNodes = new Set(graph.nodes.filter(n => !n.disabled).map(n => n.id));
  const completedNodes = new Set<string>();

  while (remainingNodes.size > 0) {
    const currentLevel: string[] = [];

    // Find nodes that can be executed (all dependencies completed)
    for (const nodeId of remainingNodes) {
      const nodeData = dependencyMap[nodeId];
      const dependencies = nodeData ? nodeData.dependencies : [];
      const canExecute = dependencies.every(depId => completedNodes.has(depId));
      
      if (canExecute) {
        currentLevel.push(nodeId);
      }
    }

    if (currentLevel.length === 0) {
      // This should not happen if there are no cycles
      throw new CircularDependencyError(
        'Unable to determine execution order - possible circular dependency',
        []
      );
    }

    // Remove current level nodes from remaining
    currentLevel.forEach(nodeId => {
      remainingNodes.delete(nodeId);
      completedNodes.add(nodeId);
    });

    executionLevels.push(currentLevel);
  }

  return executionLevels;
}

/**
 * Get all connected nodes in the graph
 */
function getConnectedNodes(graph: WorkflowGraph): Set<string> {
  const connected = new Set<string>();
  
  graph.edges.forEach(edge => {
    connected.add(edge.source);
    connected.add(edge.target);
  });

  return connected;
}

/**
 * Check if node is executable (has integration and function)
 */
function isExecutableNode(node: GraphNode): boolean {
  return Boolean(node.integration && node.function);
}

/**
 * Check if reserved node type is valid
 */
function isValidReservedNode(node: GraphNode): boolean {
  switch (node.type) {
    case 'trigger':
    case 'webhook':
      return Boolean(node.integration && node.function);
    case 'start':
    case 'end':
      return true;
    default:
      return true;
  }
}

/**
 * Get nodes that are ready to execute based on completed dependencies
 */
export function getReadyNodes(
  allNodes: GraphNode[], 
  dependencyMap: DependencyMap, 
  completedNodes: Set<string>
): string[] {
  return allNodes
    .filter(node => !node.disabled)
    .filter(node => !completedNodes.has(node.id))
    .filter(node => {
      const nodeData = dependencyMap[node.id];
      const dependencies = nodeData ? nodeData.dependencies : [];
      return dependencies.every(depId => completedNodes.has(depId));
    })
    .map(node => node.id);
}

/**
 * Validate node configuration for execution
 */
export function validateNodeConfig(node: GraphNode): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!node.config) {
    warnings.push('Node has no configuration');
    return { valid: true, errors, warnings };
  }

  // Check for potential JSON path expressions in config
  const configStr = JSON.stringify(node.config);
  const jsonPathMatches = configStr.match(/\$json\.[a-zA-Z0-9_.[\]]+/g) || [];
  const nodeRefMatches = configStr.match(/\$\([^)]+\)\.json\.[a-zA-Z0-9_.[\]]+/g) || [];

  if (jsonPathMatches.length > 0 || nodeRefMatches.length > 0) {
    warnings.push(`Node contains ${jsonPathMatches.length + nodeRefMatches.length} data reference expressions`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}