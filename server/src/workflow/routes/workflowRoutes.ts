// workflow/routes/workflowRoutes.ts
import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../auth/middleware/authMiddleware';
import WorkflowService from '../services/WorkflowService';
import { AgentFlowsRepository } from '../../database/repositories/AgentFlowsRepository';
import { redisClient } from '../../redis';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const workflowService = new WorkflowService();
const flowsRepository = new AgentFlowsRepository();

// Reserved workflow names
const RESERVED_NAMES = ['main', 'error', 'fail', 'system', 'user'];

const isReservedName = (name: string): boolean => {
  const normalized = name?.toLowerCase().trim();
  return RESERVED_NAMES.some(reserved => reserved === normalized);
};

/**
 * Get workflow data in canvas format
 * GET /api/workflows/:workflowId/data
 * NOTE: This must come before /:workflowId route to avoid route conflicts
 */
router.get('/:workflowId/data', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!workflowId) {
      return res.status(400).json({
        success: false,
        message: 'Workflow ID is required'
      });
    }

    const result = await workflowService.getWorkflowForCanvas(workflowId, tenantId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting workflow data for canvas', { error, workflowId: req.params.workflowId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get workflow data by ID
 * GET /api/workflows/:workflowId
 */
router.get('/:workflowId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!workflowId) {
      return res.status(400).json({
        success: false,
        message: 'Workflow ID is required'
      });
    }

    // Get workflow from database
    const workflow = await flowsRepository.getFlowById(workflowId);
    
    if (!workflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Verify tenant access
    if (workflow.tenant_id !== tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const workflowData = workflow.workflow_data as any || {};

    return res.json({
      success: true,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        agentId: workflow.agent_id,
        status: workflow.status,
        version: workflow.version.toString(),
        is_default: workflow.is_default,
        created_at: workflow.created_at,
        updated_at: workflow.updated_at,
        nodes: workflowData.nodes || [],
        edges: workflowData.edges || [],
        metadata: {
          ...workflowData.metadata,
          version: workflow.version,
          status: workflow.status
        }
      }
    });
  } catch (error) {
    logger.error('Error getting workflow', { error, workflowId: req.params.workflowId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Create a new workflow
 * POST /api/workflows
 */
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, agentId, description, nodes, edges, metadata, trigger } = req.body;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!agentId || typeof agentId !== 'string' || agentId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Workflow name is required'
      });
    }

    // Check for reserved names
    if (isReservedName(name)) {
      return res.status(400).json({
        success: false,
        message: `Workflow name "${name}" is reserved and cannot be used. Reserved names: main, error, fail, system, user (case-insensitive)`
      });
    }

    const now = new Date().toISOString();
    const workflowId = uuidv4();

    // Build workflow_data structure - only include trigger if provided
    const workflow_data: any = {
      nodes: nodes || [],
      edges: edges || [],
      metadata: {
        ...metadata,
        workflowId: workflowId,
        workflowName: name.trim(),
        agentId: agentId,
        createdAt: now,
        updatedAt: now
      }
    };
    
    // Only add trigger if provided
    if (trigger) {
      workflow_data.trigger = trigger;
    }

    // Create workflow in database
    const newWorkflow = await flowsRepository.create({
      id: workflowId,
      agent_id: agentId,
      tenant_id: tenantId,
      name: name.trim(),
      description: description?.trim() || null,
      is_default: false,
      workflow_data: workflow_data,
      version: 1,
      status: 'active',
      created_at: now,
      updated_at: now
    });

    logger.info('Workflow created successfully', { workflowId, agentId, tenantId, name });

    // Invalidate Redis cache for agent studio data
    try {
      const cacheKey = `agent:studio:${agentId}`;
      await redisClient.deleteKey(cacheKey);
      logger.info('Invalidated Redis cache after workflow creation', { agentId, workflowId });
    } catch (cacheError) {
      logger.warn('Failed to invalidate Redis cache', { error: cacheError, agentId });
      // Continue even if cache invalidation fails
    }

    return res.status(201).json({
      success: true,
      workflow: {
        id: newWorkflow.id,
        name: newWorkflow.name,
        description: newWorkflow.description,
        agentId: newWorkflow.agent_id,
        status: newWorkflow.status,
        version: newWorkflow.version,
        is_default: newWorkflow.is_default,
        created_at: newWorkflow.created_at,
        updated_at: newWorkflow.updated_at,
        workflow_data: newWorkflow.workflow_data
      }
    });
  } catch (error) {
    logger.error('Error creating workflow', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Update a workflow (name, description, nodes, edges, etc.)
 * PUT /api/workflows/:workflowId
 */
router.put('/:workflowId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const { name, description, nodes, edges, metadata, status } = req.body;
    const tenantId = req.user?.tenantId;

    if (!workflowId) {
      return res.status(400).json({
        success: false,
        message: 'Workflow ID is required'
      });
    }

    // Get existing workflow to verify ownership and get current data
    const existingWorkflow = await flowsRepository.getFlowById(workflowId);
    
    if (!existingWorkflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Verify tenant access
    if (existingWorkflow.tenant_id !== tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Update name if provided
    if (name !== undefined) {
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Workflow name cannot be empty'
        });
      }

      // Check for reserved names
      if (isReservedName(name)) {
        return res.status(400).json({
          success: false,
          message: `Workflow name "${name}" is reserved and cannot be used. Reserved names: main, error, fail, system, user (case-insensitive)`
        });
      }

      updateData.name = name.trim();
    }

    // Update description if provided
    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    // Get current workflow_data for all updates
    const currentWorkflowData = existingWorkflow.workflow_data as any || {};
    let needsWorkflowDataUpdate = false;
    const updatedWorkflowData: any = {
      ...currentWorkflowData
    };

    // Update status if provided
    if (status !== undefined) {
      if (typeof status !== 'string' || !['active', 'inactive', 'archived'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status. Must be one of: active, inactive, archived'
        });
      }
      updateData.status = status;
      needsWorkflowDataUpdate = true;
      
      // Update status in metadata (preserve existing metadata)
      updatedWorkflowData.metadata = {
        ...(updatedWorkflowData.metadata || currentWorkflowData.metadata || {}),
        status: status,
        updatedAt: new Date().toISOString()
      };
    }

    // Update workflow_data if nodes/edges/metadata provided
    if (nodes !== undefined || edges !== undefined || metadata !== undefined) {
      needsWorkflowDataUpdate = true;
      
      // Preserve existing trigger if it exists
      updatedWorkflowData.nodes = nodes !== undefined ? nodes : currentWorkflowData.nodes || [];
      updatedWorkflowData.edges = edges !== undefined ? edges : currentWorkflowData.edges || [];
      updatedWorkflowData.metadata = {
        ...currentWorkflowData.metadata,
        ...metadata,
        workflowId: existingWorkflow.id,
        workflowName: updateData.name || existingWorkflow.name,
        agentId: existingWorkflow.agent_id,
        status: status !== undefined ? status : (currentWorkflowData.metadata?.status || existingWorkflow.status),
        updatedAt: new Date().toISOString()
      };
      
      // Only update trigger if explicitly provided in metadata
      if (metadata?.trigger) {
        updatedWorkflowData.trigger = metadata.trigger;
      } else if (currentWorkflowData.trigger) {
        // Preserve existing trigger
        updatedWorkflowData.trigger = currentWorkflowData.trigger;
      }

      // Increment version when workflow_data changes
      updateData.version = existingWorkflow.version + 1;
    }
    
    // If only name is updated, also update metadata
    if (name !== undefined && nodes === undefined && edges === undefined && metadata === undefined && status === undefined) {
      needsWorkflowDataUpdate = true;
      updatedWorkflowData.metadata = {
        ...currentWorkflowData.metadata,
        workflowId: existingWorkflow.id,
        workflowName: name.trim(),
        agentId: existingWorkflow.agent_id,
        updatedAt: new Date().toISOString()
      };
    }
    
    // Set workflow_data if any update requires it
    if (needsWorkflowDataUpdate) {
      updateData.workflow_data = updatedWorkflowData;
    }

    // Update workflow in database
    const updatedWorkflow = await flowsRepository.update(workflowId, updateData);

    logger.info('Workflow updated successfully', { workflowId, updates: Object.keys(updateData) });

    // Invalidate Redis cache for agent studio data
    try {
      const cacheKey = `agent:studio:${existingWorkflow.agent_id}`;
      await redisClient.deleteKey(cacheKey);
      logger.info('Invalidated Redis cache after workflow update', { agentId: existingWorkflow.agent_id, workflowId });
    } catch (cacheError) {
      logger.warn('Failed to invalidate Redis cache', { error: cacheError, agentId: existingWorkflow.agent_id });
      // Continue even if cache invalidation fails
    }

    return res.json({
      success: true,
      workflow: {
        id: updatedWorkflow.id,
        name: updatedWorkflow.name,
        description: updatedWorkflow.description,
        agentId: updatedWorkflow.agent_id,
        status: updatedWorkflow.status,
        version: updatedWorkflow.version,
        is_default: updatedWorkflow.is_default,
        created_at: updatedWorkflow.created_at,
        updated_at: updatedWorkflow.updated_at,
        workflow_data: updatedWorkflow.workflow_data
      }
    });
  } catch (error) {
    logger.error('Error updating workflow', { error, workflowId: req.params.workflowId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Duplicate a workflow
 * POST /api/workflows/:workflowId/duplicate
 */
router.post('/:workflowId/duplicate', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const { name } = req.body;
    const tenantId = req.user?.tenantId;

    if (!workflowId) {
      return res.status(400).json({
        success: false,
        message: 'Workflow ID is required'
      });
    }

    // Get existing workflow to duplicate
    const existingWorkflow = await flowsRepository.getFlowById(workflowId);
    
    if (!existingWorkflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Verify tenant access
    if (existingWorkflow.tenant_id !== tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Generate new workflow name
    const baseName = name || `${existingWorkflow.name} Copy`;
    let newName = baseName;
    
    // Get all workflows for this agent to ensure unique name
    const allWorkflows = await flowsRepository.getFlowsByAgent(existingWorkflow.agent_id);
    const existingNames = new Set(allWorkflows.map((w: any) => w.name.toLowerCase()));
    
    let counter = 1;
    while (existingNames.has(newName.toLowerCase()) || isReservedName(newName)) {
      newName = `${baseName} (${counter})`;
      counter++;
    }

    // Check for reserved names
    if (isReservedName(newName)) {
      return res.status(400).json({
        success: false,
        message: `Cannot duplicate to reserved name. Generated name "${newName}" is reserved.`
      });
    }

    const now = new Date().toISOString();
    const newWorkflowId = uuidv4();
    const workflowData = existingWorkflow.workflow_data as any || {};

    // Create new workflow with duplicated data
    const duplicatedWorkflow = await flowsRepository.create({
      id: newWorkflowId,
      agent_id: existingWorkflow.agent_id,
      tenant_id: tenantId,
      name: newName,
      description: existingWorkflow.description,
      is_default: false,
      workflow_data: {
        ...workflowData,
        metadata: {
          ...workflowData.metadata,
          workflowId: newWorkflowId,
          workflowName: newName,
          agentId: existingWorkflow.agent_id,
          duplicatedFrom: existingWorkflow.id,
          createdAt: now,
          updatedAt: now
        }
      },
      version: 1,
      status: 'active',
      created_at: now,
      updated_at: now
    });

    logger.info('Workflow duplicated successfully', { 
      originalId: workflowId, 
      newId: newWorkflowId, 
      agentId: existingWorkflow.agent_id 
    });

    // Invalidate Redis cache for agent studio data
    try {
      const cacheKey = `agent:studio:${existingWorkflow.agent_id}`;
      await redisClient.deleteKey(cacheKey);
      logger.info('Invalidated Redis cache after workflow duplication', { agentId: existingWorkflow.agent_id, workflowId });
    } catch (cacheError) {
      logger.warn('Failed to invalidate Redis cache', { error: cacheError, agentId: existingWorkflow.agent_id });
      // Continue even if cache invalidation fails
    }

    return res.status(201).json({
      success: true,
      workflow: {
        id: duplicatedWorkflow.id,
        name: duplicatedWorkflow.name,
        description: duplicatedWorkflow.description,
        agentId: duplicatedWorkflow.agent_id,
        status: duplicatedWorkflow.status,
        version: duplicatedWorkflow.version,
        is_default: duplicatedWorkflow.is_default,
        created_at: duplicatedWorkflow.created_at,
        updated_at: duplicatedWorkflow.updated_at,
        workflow_data: duplicatedWorkflow.workflow_data
      }
    });
  } catch (error) {
    logger.error('Error duplicating workflow', { error, workflowId: req.params.workflowId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Delete a workflow
 * DELETE /api/workflows/:workflowId
 */
router.delete('/:workflowId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workflowId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!workflowId) {
      return res.status(400).json({
        success: false,
        message: 'Workflow ID is required'
      });
    }

    // Get existing workflow to verify ownership
    const existingWorkflow = await flowsRepository.getFlowById(workflowId);
    
    if (!existingWorkflow) {
      return res.status(404).json({
        success: false,
        message: 'Workflow not found'
      });
    }

    // Verify tenant access
    if (existingWorkflow.tenant_id !== tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Check if workflow is reserved (prevent deletion of reserved workflows)
    if (isReservedName(existingWorkflow.name)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete reserved workflows (main, error, fail, system, user)'
      });
    }

    // Delete workflow
    await flowsRepository.deleteFlow(workflowId);

    logger.info('Workflow deleted successfully', { workflowId, tenantId });

    // Invalidate Redis cache for agent studio data
    try {
      const cacheKey = `agent:studio:${existingWorkflow.agent_id}`;
      await redisClient.deleteKey(cacheKey);
      logger.info('Invalidated Redis cache after workflow deletion', { agentId: existingWorkflow.agent_id, workflowId });
    } catch (cacheError) {
      logger.warn('Failed to invalidate Redis cache', { error: cacheError, agentId: existingWorkflow.agent_id });
      // Continue even if cache invalidation fails
    }

    return res.json({
      success: true,
      message: 'Workflow deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting workflow', { error, workflowId: req.params.workflowId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;

