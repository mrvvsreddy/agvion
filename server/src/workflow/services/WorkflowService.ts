// workflow/services/WorkflowService.ts
import { AgentFlowsRepository } from '../../database/repositories/AgentFlowsRepository';
import logger from '../../utils/logger';
import { randomUUID } from 'crypto';

export interface GetWorkflowDataResponse {
  success: boolean;
  data?: {
    id: string;
    name: string;
    agentId: string;
    tenantId: string;
    status: string;
    version: string;
    description?: string;
    nodes: any[];
    edges: any[];
    metadata: Record<string, any>;
    workflow_data: any;
  };
  message?: string;
}

export class WorkflowService {
  private flowsRepository: AgentFlowsRepository;

  constructor() {
    this.flowsRepository = new AgentFlowsRepository();
  }

  /**
   * Get workflow data by ID
   */
  async getWorkflowData(workflowId: string, tenantId?: string): Promise<GetWorkflowDataResponse> {
    try {
      if (!workflowId || typeof workflowId !== 'string') {
        return {
          success: false,
          message: 'Workflow ID is required'
        };
      }

      const flow = await this.flowsRepository.getFlowById(workflowId);

      if (!flow) {
        return {
          success: false,
          message: 'Workflow not found'
        };
      }

      // Optional tenant verification
      if (tenantId && flow.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Access denied'
        };
      }

      // Extract nodes and edges from workflow_data
      const workflowData = flow.workflow_data || {};
      const nodes = workflowData.nodes || [];
      const edges = workflowData.edges || [];

      // Transform to match expected format
      const transformedNodes = nodes.map((node: any) => {
        // Handle position format - can be {x, y} object or x, y directly
        const position = node.position || (node.x !== undefined && node.y !== undefined ? { x: node.x, y: node.y } : { x: 0, y: 0 });
        
        // Map nodeType to nodeId (workflow format uses nodeType, canvas expects nodeId)
        const nodeId = node.nodeId || node.nodeType || node.function || '';
        
        // Determine shape based on type
        const shape = node.shape || (node.type === 'trigger' ? 'circle' : 'square');
        
        return {
          id: node.id || randomUUID(),
          x: position.x || 0,
          y: position.y || 0,
          integrationId: node.integrationId || node.integration || '',
          nodeId: nodeId,
          name: node.name || node.title || '',
          type: node.type === 'trigger' ? 'trigger' : 'action',
          shape: shape,
          icon: node.icon || null,
          config: node.config || {},
          data: node.data || {},
          disabled: node.disabled || false,
          function: node.function || node.nodeType || '',
          credentials: node.credentials || {},
          agentConfig: node.agentConfig || {},
          integration: node.integration || node.integrationId || '',
          inputPreview: node.inputPreview,
          outputPreview: node.outputPreview,
        };
      });

      const transformedEdges = edges.map((edge: any) => ({
        id: edge.id || `e-${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        data: edge.data || {}
      }));

      return {
        success: true,
        data: {
          id: flow.id,
          name: flow.name,
          agentId: flow.agent_id,
          tenantId: flow.tenant_id,
          status: flow.status,
          version: String(flow.version || '1.0.0'),
          description: flow.description || '',
          nodes: transformedNodes,
          edges: transformedEdges,
          metadata: workflowData.metadata || {},
          workflow_data: workflowData
        }
      };
    } catch (error) {
      logger.error('Failed to get workflow data', { error, workflowId });
      return {
        success: false,
        message: 'Failed to get workflow data'
      };
    }
  }

  /**
   * Get workflow data in the format expected by flow-canvas
   */
  async getWorkflowForCanvas(workflowId: string, tenantId?: string): Promise<GetWorkflowDataResponse> {
    const result = await this.getWorkflowData(workflowId, tenantId);
    
    if (!result.success || !result.data) {
      return result;
    }

    // Transform nodes to match WfNode format used in flow-canvas
    const canvasNodes = result.data.nodes.map((node: any) => {
      // Handle position format
      const x = node.x !== undefined ? node.x : (node.position?.x || 0);
      const y = node.y !== undefined ? node.y : (node.position?.y || 0);
      
      return {
        id: node.id,
        x: x,
        y: y,
        integrationId: node.integrationId || '',
        nodeId: node.nodeId || '',
        name: node.name || '',
        type: node.type || 'action',
        shape: node.shape || 'square',
        icon: node.icon || null,
        config: node.config || {},
        data: node.data || {},
        disabled: node.disabled || false,
        function: node.function || '',
        credentials: node.credentials || {},
        agentConfig: node.agentConfig || {},
        integration: node.integration || '',
        inputPreview: node.inputPreview,
        outputPreview: node.outputPreview,
      };
    });

    return {
      success: true,
      data: {
        ...result.data,
        nodes: canvasNodes
      }
    };
  }
}

export default WorkflowService;

