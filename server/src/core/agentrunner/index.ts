// path: src/core/workflowrunner/index.ts

import { ExecutionContext } from '../../types/context';
import { validateWorkflow } from './execution/validator';
import { executeWorkflowByDefinition } from './execution/executer';
import { WorkflowGraph, GraphNode, GraphEdge, TriggerDataInjection } from './execution/types';
import logger from '../../utils/logger';

/**
 * Extended execution context that includes required tenantId
 */
interface ExtendedExecutionContext extends ExecutionContext {
  tenantId: string;
}

/**
 * Comprehensive workflow execution data interface
 */
interface WorkflowExecutionData {
  workflow: {
    id: string;
    name?: string;
    agentId: string;
    isActive: boolean;
    triggerType: string;
    triggerValue?: string;
    data?: any;
    createdAt?: string;
    updatedAt?: string;
  };
  message: {
    id: string;
    messageText?: string;
    type: string;
    from: string;
    to?: string;
    timestamp: string;
  };
  webhook: {
    phoneNumberId: string;
    displayPhoneNumber?: string;
    contacts?: any[];
    statuses?: any[];
    messages?: any[];
  };
  tenant: {
    id: string;
    name?: string;
  };
  processing: {
    uniqueId: string;
    processedAt: string;
    receivedAt?: string;
    source: string;
    version?: string;
  };
  rawWebhook?: any;
}

/**
 * Legacy workflow variables interface for backward compatibility
 */
interface WorkflowVariables {
  messageId: string;
  messageText: string;
  messageType: string;
  sender: string;
  timestamp: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  contacts: any;
  triggerType: string;
  triggerId?: string;
  triggerValue?: string;
  agentId: string;
  workflowId?: string;
  workflowName?: string;
  _webhookSource: string;
  _processedAt: string;
  _uniqueId: string;
  [key: string]: any;
}

/**
 * Incoming workflow request formats
 */
type WorkflowRequest = 
  | { type: 'comprehensive'; data: WorkflowExecutionData }
  | { type: 'legacy_with_data'; workflowData: any; variables: WorkflowVariables; triggerDataInjections?: readonly TriggerDataInjection[] }
  | { type: 'legacy_message'; agentId: string; message: any }
  | { type: 'graph'; workflow: WorkflowGraph; context: ExecutionContext };

class WorkflowRunner {
  private workflows = new Map<string, WorkflowGraph>();
  private isInitialized = false;

  /**
   * Initialize the workflow runner
   */
  async initialize(): Promise<void> {
    logger.info('WorkflowRunner initialized with graph-based executor');
    this.isInitialized = true;
  }

  /**
   * Universal workflow execution method
   * Accepts any incoming workflow request format
   */
  async executeWorkflow(request: WorkflowRequest): Promise<boolean> {
    try {
      switch (request.type) {
        case 'comprehensive':
          return this.executeWorkflowWithComprehensiveData(request.data);
        
        case 'legacy_with_data':
          return this.executeWorkflowWithData(request.workflowData, request.variables, request.triggerDataInjections);
        
        case 'legacy_message':
          return this.executeWorkflowWithMessage(request.agentId, request.message);
        
        case 'graph':
          return this.executeWorkflowGraph(request.workflow, request.context);
        
        default:
          logger.error('Unknown workflow request type', { request });
          return false;
      }
    } catch (error) {
      logger.error('Workflow execution failed', {
        requestType: request.type,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Execute workflow with comprehensive data (primary method)
   */
  async executeWorkflowWithComprehensiveData(executionData: WorkflowExecutionData): Promise<boolean> {
    try {
      logger.info('Executing workflow with comprehensive data', { 
        workflowId: executionData.workflow.id,
        workflowName: executionData.workflow.name,
        agentId: executionData.workflow.agentId,
        messageId: executionData.message.id,
        uniqueId: executionData.processing.uniqueId
      });

      // Convert comprehensive data to workflow graph
      const workflowGraph = this.convertComprehensiveDataToGraph(executionData);
      
      if (!workflowGraph) {
        logger.error('Failed to convert comprehensive data to workflow graph', {
          workflowId: executionData.workflow.id,
          agentId: executionData.workflow.agentId
        });
        return false;
      }

      // Security check: verify tenant matches
      if (workflowGraph.agentId !== executionData.workflow.agentId) {
        logger.error('Tenant ID mismatch for workflow', {
          workflowAgentId: workflowGraph.agentId,
          requestAgentId: executionData.workflow.agentId,
          workflowId: workflowGraph.id
        });
        return false;
      }

      // Create execution context with required tenantId
      const context = this.createExecutionContextFromComprehensive(executionData, workflowGraph);
      const extendedContext: ExtendedExecutionContext = {
        ...context,
        tenantId: executionData.workflow.agentId
      };

      // Execute the workflow graph
      await executeWorkflowByDefinition(
        workflowGraph,
        {
          agentId: executionData.workflow.agentId,
          tenantId: extendedContext.tenantId
        }
      );
      
      logger.info('Workflow execution completed successfully', {
        workflowId: workflowGraph.id,
        agentId: executionData.workflow.agentId,
        messageId: executionData.message.id,
        uniqueId: executionData.processing.uniqueId
      });

      return true;

    } catch (error) {
      logger.error('Failed to execute workflow with comprehensive data', {
        workflowId: executionData.workflow?.id,
        agentId: executionData.workflow?.agentId,
        messageId: executionData.message?.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }

  /**
   * Execute workflow with legacy data format
   */
  async executeWorkflowWithData(workflowData: any, workflowVariables: WorkflowVariables, triggerDataInjections?: readonly TriggerDataInjection[]): Promise<boolean> {
    try {
      logger.info('Executing workflow with legacy data format', { 
        workflowId: workflowData.id,
        workflowName: workflowData.name,
        agentId: workflowVariables.agentId,
        messageId: workflowVariables.messageId
      });

      // Convert legacy data to workflow graph
      const workflowGraph = this.convertLegacyDataToGraph(workflowData, workflowVariables);
      
      if (!workflowGraph) {
        logger.error('Failed to convert legacy data to workflow graph', {
          workflowId: workflowData.id,
          agentId: workflowVariables.agentId
        });
        return false;
      }

      // Security check
      if (workflowGraph.agentId !== workflowVariables.agentId) {
        logger.error('Tenant ID mismatch for legacy workflow', {
          workflowAgentId: workflowGraph.agentId,
          requestAgentId: workflowVariables.agentId,
          workflowId: workflowGraph.id
        });
        return false;
      }

      // Create execution context with required tenantId and optional trigger injections
      // Execute the workflow graph with trigger injections and tenant context
      await executeWorkflowByDefinition(
        workflowGraph,
        {
          agentId: workflowVariables.agentId,
          tenantId: workflowVariables.agentId,
          ...(triggerDataInjections && triggerDataInjections.length > 0
            ? { triggerDataInjections }
            : {})
        }
      );
      
      logger.info('Legacy workflow execution completed successfully', {
        workflowId: workflowGraph.id,
        agentId: workflowVariables.agentId,
        messageId: workflowVariables.messageId
      });

      return true;

    } catch (error) {
      logger.error('Failed to execute legacy workflow', {
        workflowId: workflowData?.id,
        agentId: workflowVariables?.agentId,
        messageId: workflowVariables?.messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Execute workflow with simple message format (most legacy)
   */
  async executeWorkflowWithMessage(agentId: string, message: any): Promise<boolean> {
    try {
      logger.info('Executing workflow with simple message format', {
        agentId,
        messageId: message?.messageId || message?.id
      });

      // Find cached workflow for this tenant
      const workflowGraph = this.findWorkflowByTenant(agentId);
      if (!workflowGraph) {
        logger.warn('No workflow found for tenant', { agentId });
        return false;
      }

      // Extract variables from message
      const variables = this.extractVariablesFromMessage(message);
      
      // Create execution context with required tenantId
      const baseContext: ExecutionContext = {
        agentId,
        workflowId: workflowGraph.id,
        message,
        variables,
        stepResults: {},
        executionId: this.generateExecutionId(workflowGraph.id, variables.messageId || 'unknown')
      };

      const extendedContext: ExtendedExecutionContext = {
        ...baseContext,
        tenantId: agentId
      };

      // Execute the workflow graph
      await executeWorkflowByDefinition(
        workflowGraph,
        {
          agentId,
          tenantId: extendedContext.tenantId
        }
      );
      
      logger.info('Simple message workflow execution completed successfully', {
        workflowId: workflowGraph.id,
        agentId,
        messageId: variables.messageId
      });

      return true;

    } catch (error) {
      logger.error('Failed to execute simple message workflow', {
        agentId,
        messageId: message?.messageId || message?.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Execute workflow graph directly (for new format)
   */
  async executeWorkflowGraph(workflow: WorkflowGraph, context: ExecutionContext): Promise<boolean> {
    try {
      logger.info('Executing workflow graph directly', {
        workflowId: workflow.id,
        agentId: workflow.agentId,
        nodeCount: workflow.nodes.length,
        edgeCount: workflow.edges.length
      });

      // Validate workflow before execution
      const validation = validateWorkflow(workflow);
      if (!validation.valid) {
        logger.error('Workflow validation failed', {
          workflowId: workflow.id,
          errors: validation.errors
        });
        return false;
      }

      // Ensure tenantId is provided in context
      const extendedContext: ExtendedExecutionContext = {
        ...context,
        tenantId: context.agentId || workflow.agentId
      };

      // Execute the workflow graph
      await executeWorkflowByDefinition(
        workflow,
        {
          agentId: workflow.agentId,
          tenantId: extendedContext.tenantId
        }
      );
      
      logger.info('Direct graph workflow execution completed successfully', {
        workflowId: workflow.id,
        agentId: workflow.agentId
      });

      return true;

    } catch (error) {
      logger.error('Failed to execute workflow graph directly', {
        workflowId: workflow?.id,
        agentId: workflow?.agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Convert comprehensive execution data to WorkflowGraph
   */
  private convertComprehensiveDataToGraph(executionData: WorkflowExecutionData): WorkflowGraph | null {
    try {
      const rawData = executionData.workflow.data || {};
      let workflowData: any = rawData;
      if (typeof workflowData === 'string') {
        try {
          workflowData = JSON.parse(workflowData);
          if (typeof workflowData === 'string') {
            workflowData = JSON.parse(workflowData);
          }
        } catch {
          // leave as-is if parsing fails
        }
      }
      
      // Extract nodes and edges from workflow data
      const nodes: GraphNode[] = this.extractNodes(workflowData, 'trigger');
      const edges: GraphEdge[] = this.extractEdges(workflowData);

      const workflowGraph: WorkflowGraph = {
        id: executionData.workflow.id,
        name: executionData.workflow.name || `Workflow ${executionData.workflow.id}`,
        agentId: executionData.workflow.agentId,
        nodes,
        edges,
        metadata: {
          version: workflowData.version || '1.0',
          created: executionData.workflow.createdAt || new Date().toISOString(),
          modified: executionData.workflow.updatedAt || new Date().toISOString(),
          tags: workflowData.tags || [],
          description: workflowData.description || workflowData.author || 'System'
        }
      };

      // Validate the graph
      const validation = validateWorkflow(workflowGraph);
      if (!validation.valid) {
        logger.error('Generated workflow graph is invalid', {
          workflowId: workflowGraph.id,
          errors: validation.errors
        });
        return null;
      }

      return workflowGraph;

    } catch (error) {
      logger.error('Failed to convert comprehensive data to workflow graph', {
        workflowId: executionData.workflow?.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Convert legacy workflow data to WorkflowGraph
   */
  private convertLegacyDataToGraph(workflowData: any, variables: WorkflowVariables): WorkflowGraph | null {
    try {
      const rawData = workflowData.workflowData || {};
      let data: any = rawData;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
          if (typeof data === 'string') {
            data = JSON.parse(data);
          }
        } catch {
          // leave as-is if parsing fails
        }
      }
      
      // Extract nodes and edges from legacy data
      const nodes: GraphNode[] = this.extractNodes(data, variables?.triggerName || 'trigger');
      const edges: GraphEdge[] = this.extractEdges(data);

      const workflowGraph: WorkflowGraph = {
        id: workflowData.id,
        name: workflowData.name || `Workflow ${workflowData.id}`,
        agentId: workflowData.agentId,
        nodes,
        edges,
        metadata: {
          version: data.version || '1.0',
          created: workflowData.createdAt || new Date().toISOString(),
          modified: workflowData.updatedAt || new Date().toISOString(),
          tags: data.tags || [],
          description: data.description || data.author || 'System'
        }
      };

      // Validate the graph
      const validation = validateWorkflow(workflowGraph);
      if (!validation.valid) {
        logger.error('Generated legacy workflow graph is invalid', {
          workflowId: workflowGraph.id,
          errors: validation.errors
        });
        return null;
      }

      return workflowGraph;

    } catch (error) {
      logger.error('Failed to convert legacy data to workflow graph', {
        workflowId: workflowData?.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Extract nodes from workflow data
   */
  private extractNodes(workflowData: any, triggerName: string = 'trigger'): GraphNode[] {
    const nodes: GraphNode[] = [];

    // Handle new integrations format (from AgentFlowService)
    if (workflowData.integrations && Array.isArray(workflowData.integrations)) {
      workflowData.integrations.forEach((integration: any, index: number) => {
        const node: GraphNode = {
          triggerName,
          id: integration.id || `integration-${index}`,
          name: integration.name || `Integration ${index + 1}`,
          type: integration.type || 'integration',
          integration: integration.integration,
          function: integration.function,
          config: integration.data || integration.config || {},
          disabled: integration.disabled || false,
          position: integration.position || { x: index * 200, y: 100 }
        };

        // Handle agent-specific configuration
        if (integration.type === 'ai_agent') {
          node.nodeType = 'agent';
          node.agentConfig = {
            systemPrompt: integration.data?.systemPrompt,
            userPrompt: integration.data?.userPrompt,
            llm: {
              model: integration.data?.model,
              provider: 'openrouter',
              temperature: integration.data?.temperature,
              maxTokens: integration.data?.maxTokens
            },
            tools: integration.data?.tools,
            memory: integration.data?.memory
          };
        }

        nodes.push(node);
      });
    }

    // Handle legacy steps format
    if (workflowData.steps && Array.isArray(workflowData.steps)) {
      workflowData.steps.forEach((step: any, index: number) => {
        nodes.push({
          triggerName,
          id: step.id || `step-${index}`,
          name: step.name || `Step ${index + 1}`,
          type: step.type || 'step',
          integration: step.integration,
          function: step.function,
          config: step.config || {},
          disabled: step.disabled || false,
          position: step.position || { x: index * 200, y: 100 }
        });
      });
    }

    // Handle new actions format
    if (workflowData.actions && Array.isArray(workflowData.actions)) {
      workflowData.actions.forEach((action: any, index: number) => {
        nodes.push({
          triggerName,
          id: action.id || `action-${index}`,
          name: action.name || `Action ${index + 1}`,
          type: action.type || 'action',
          integration: action.integration,
          function: action.function,
          config: action.config || {},
          disabled: action.disabled || false,
          position: action.position || { x: index * 200, y: 200 }
        });
      });
    }

    // Handle direct nodes format
    if (workflowData.nodes && Array.isArray(workflowData.nodes)) {
      workflowData.nodes.forEach((node: any, index: number) => {
        nodes.push({
          triggerName,
          ...node,
          position: node.position || { x: index * 200, y: 300 }
        } as GraphNode);
      });
    }

    // If no nodes found, create a default trigger node
    // Do not auto-add a trigger node; workflows are expected to reference
    // DB-provided trigger_name via $json.<trigger_name>.*

    return nodes;
  }

  /**
   * Extract edges from workflow data
   */
  private extractEdges(workflowData: any): GraphEdge[] {
    const edges: GraphEdge[] = [];

    // Handle explicit edges
    if (workflowData.edges && Array.isArray(workflowData.edges)) {
      return workflowData.edges.map((edge: any) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        condition: edge.condition,
        label: edge.label
      }));
    }

    // Create sequential edges for integrations if no explicit edges defined
    if (workflowData.integrations && Array.isArray(workflowData.integrations) && workflowData.integrations.length > 1) {
      for (let i = 0; i < workflowData.integrations.length - 1; i++) {
        const currentId = workflowData.integrations[i].id || `integration-${i}`;
        const nextId = workflowData.integrations[i + 1].id || `integration-${i + 1}`;
        
        edges.push({
          id: `integration-edge-${i}`,
          source: currentId,
          target: nextId
        });
      }
    }

    // Create sequential edges if nodes exist but no edges defined
    if (workflowData.steps && Array.isArray(workflowData.steps) && workflowData.steps.length > 1) {
      for (let i = 0; i < workflowData.steps.length - 1; i++) {
        const currentId = workflowData.steps[i].id || `step-${i}`;
        const nextId = workflowData.steps[i + 1].id || `step-${i + 1}`;
        
        edges.push({
          id: `edge-${i}`,
          source: currentId,
          target: nextId
        });
      }
    }

    // Handle actions similarly
    if (workflowData.actions && Array.isArray(workflowData.actions) && workflowData.actions.length > 1) {
      for (let i = 0; i < workflowData.actions.length - 1; i++) {
        const currentId = workflowData.actions[i].id || `action-${i}`;
        const nextId = workflowData.actions[i + 1].id || `action-${i + 1}`;
        
        edges.push({
          id: `action-edge-${i}`,
          source: currentId,
          target: nextId
        });
      }
    }

    return edges;
  }

  /**
   * Create execution context from comprehensive data
   */
  private createExecutionContextFromComprehensive(
    executionData: WorkflowExecutionData,
    workflow: WorkflowGraph
  ): ExecutionContext {
    const variables = {
      // Core message data
      messageId: executionData.message.id,
      messageText: executionData.message.messageText || '',
      messageType: executionData.message.type,
      sender: executionData.message.from,
      recipient: executionData.message.to,
      timestamp: executionData.message.timestamp,
      
      // Webhook data
      phoneNumberId: executionData.webhook.phoneNumberId,
      displayPhoneNumber: executionData.webhook.displayPhoneNumber || '',
      contacts: executionData.webhook.contacts || [],
      
      // Workflow context
      workflowId: executionData.workflow.id,
      workflowName: executionData.workflow.name,
      triggerType: executionData.workflow.triggerType,
      triggerValue: executionData.workflow.triggerValue,
      
      // Tenant context
      agentId: executionData.tenant.id,
      tenantName: executionData.tenant.name,
      
      // Processing metadata
      uniqueId: executionData.processing.uniqueId,
      processedAt: executionData.processing.processedAt,
      source: executionData.processing.source,
      
      // Full data objects for integrations
      message: executionData.message,
      webhook: executionData.webhook,
      workflow: executionData.workflow,
      tenant: executionData.tenant,
      processing: executionData.processing,
      rawWebhook: executionData.rawWebhook,
      executionData: executionData
    };

    return {
      agentId: executionData.workflow.agentId,
      workflowId: workflow.id,
      message: executionData.message,
      variables,
      stepResults: {},
      executionId: this.generateExecutionId(workflow.id, executionData.message.id)
    };
  }

  /**
   * Create execution context from legacy data
   */
  private createExecutionContextFromLegacy(
    variables: WorkflowVariables,
    workflow: WorkflowGraph
  ): ExecutionContext {
    return {
      agentId: variables.agentId,
      workflowId: workflow.id,
      message: variables,
      variables: { ...variables },
      stepResults: {},
      executionId: this.generateExecutionId(workflow.id, variables.messageId)
    };
  }

  /**
   * Extract variables from message object (legacy compatibility)
   */
  private extractVariablesFromMessage(message: any): Record<string, any> {
    const variables: Record<string, any> = {};

    // Handle different message formats
    const messageId = message.messageId || message.id;
    if (messageId) variables.messageId = messageId;
    if (message.messageText !== undefined) variables.messageText = message.messageText;
    if (message.messageType) variables.messageType = message.messageType;
    if (message.sender) variables.sender = message.sender;
    if (message.timestamp) variables.timestamp = message.timestamp;
    if (message.phoneNumberId) variables.phoneNumberId = message.phoneNumberId;
    if (message.displayPhoneNumber) variables.displayPhoneNumber = message.displayPhoneNumber;

    // Add any additional properties
    Object.keys(message).forEach(key => {
      if (!variables[key]) {
        variables[key] = message[key];
      }
    });

    return variables;
  }

  /**
   * Find workflow by tenant ID (searches cached workflows)
   */
  private findWorkflowByTenant(agentId: string): WorkflowGraph | undefined {
    return Array.from(this.workflows.values()).find(w => w.agentId === agentId);
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(workflowId: string, messageId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 8);
    return `exec_${workflowId}_${messageId}_${timestamp}_${random}`;
  }

  /**
   * Cache management methods
   */
  addWorkflow(workflow: WorkflowGraph): void {
    this.workflows.set(workflow.id, workflow);
    logger.debug('Added workflow to cache', { workflowId: workflow.id });
  }

  updateWorkflow(workflow: WorkflowGraph): boolean {
    const exists = this.workflows.has(workflow.id);
    this.workflows.set(workflow.id, workflow);
    logger.debug('Updated workflow in cache', { workflowId: workflow.id, existed: exists });
    return exists;
  }

  removeWorkflow(workflowId: string): boolean {
    const removed = this.workflows.delete(workflowId);
    if (removed) {
      logger.debug('Removed workflow from cache', { workflowId });
    }
    return removed;
  }

  clearWorkflowCache(): void {
    this.workflows.clear();
    logger.info('Workflow cache cleared');
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(workflowId: string): Promise<WorkflowGraph | null> {
    return this.workflows.get(workflowId) || null;
  }

  /**
   * Get workflows by tenant ID
   */
  async getWorkflowsByTenant(agentId: string): Promise<WorkflowGraph[]> {
    return Array.from(this.workflows.values()).filter(w => w.agentId === agentId);
  }

  /**
   * Get all cached workflows
   */
  getAllWorkflows(): WorkflowGraph[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get runner statistics
   */
  getStats(): {
    isInitialized: boolean;
    cachedWorkflows: number;
    cacheKeys: string[];
    mode: string;
  } {
    return {
      isInitialized: this.isInitialized,
      cachedWorkflows: this.workflows.size,
      cacheKeys: Array.from(this.workflows.keys()),
      mode: 'graph-executor-v3'
    };
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    try {
      return {
        status: 'healthy',
        details: {
          initialized: this.isInitialized,
          cachedWorkflows: this.workflows.size,
          mode: 'graph-executor-v3',
          supportedRequestTypes: [
            'comprehensive',
            'legacy_with_data',
            'legacy_message',
            'graph'
          ]
        }
      };
    } catch (error) {
      logger.error('WorkflowRunner health check failed', { error });
      return {
        status: 'unhealthy',
        details: {
          initialized: this.isInitialized,
          cachedWorkflows: this.workflows.size,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Validate workflow before execution
   */
  validateWorkflow(workflow: WorkflowGraph): { valid: boolean; errors: string[]; warnings: string[] } {
    const validation = validateWorkflow(workflow);
    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings
    };
  }
}

export default new WorkflowRunner();