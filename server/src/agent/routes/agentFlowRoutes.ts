// agent/routes/agentFlowRoutes.ts
import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../auth/middleware/authMiddleware';
import AgentFlowService from '../services/AgentFlowService';
import logger from '../../utils/logger';

const router = Router();

/**
 * Create a new agent flow
 * POST /api/agents/:agentId/flows
 */
router.post('/:agentId/flows', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const { name, description, definition, isDefault } = req.body;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Flow name is required'
      });
    }

    // Check for reserved workflow names
    const reservedNames = ['main', 'error', 'fail', 'system', 'user'];
    const normalizedName = name.trim().toLowerCase();
    if (reservedNames.some(reserved => reserved === normalizedName)) {
      return res.status(400).json({
        success: false,
        message: `Workflow name "${name}" is reserved and cannot be used. Reserved names: main, error, fail, system, user (case-insensitive)`
      });
    }

    if (!definition) {
      return res.status(400).json({
        success: false,
        message: 'Flow definition is required'
      });
    }

    const result = await AgentFlowService.createFlow({
      agentId,
      tenantId,
      name: name.trim(),
      description: description?.trim(),
      workflow_data: definition,
      isDefault: Boolean(isDefault)
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(201).json(result);
  } catch (error) {
    logger.error('Error creating agent flow', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get all flows for an agent
 * GET /api/agents/:agentId/flows
 */
router.get('/:agentId/flows', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    // TODO: Verify agent belongs to tenant
    const result = await AgentFlowService.getFlowsByAgent(agentId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent flows', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get default flow for an agent
 * GET /api/agents/:agentId/flows/default
 */
router.get('/:agentId/flows/default', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    // TODO: Verify agent belongs to tenant
    const result = await AgentFlowService.getDefaultFlow(agentId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting default flow', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Update flow definition
 * PUT /api/agents/:agentId/flows/:flowId
 */
router.put('/:agentId/flows/:flowId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, flowId } = req.params;
    const { definition } = req.body;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!agentId || !flowId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Flow ID are required'
      });
    }

    if (!definition) {
      return res.status(400).json({
        success: false,
        message: 'Flow definition is required'
      });
    }

    // TODO: Verify agent and flow belong to tenant
    const result = await AgentFlowService.updateFlowDefinition(flowId, definition);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error updating flow definition', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get flows by trigger type
 * GET /api/agents/:agentId/flows/trigger/:triggerType
 */
router.get('/:agentId/flows/trigger/:triggerType', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, triggerType } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!agentId || !triggerType) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Trigger Type are required'
      });
    }

    // TODO: Verify agent belongs to tenant
    const result = await AgentFlowService.getFlowsByTrigger(agentId, triggerType);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting flows by trigger', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Delete a flow
 * DELETE /api/agents/:agentId/flows/:flowId
 */
router.delete('/:agentId/flows/:flowId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, flowId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!agentId || !flowId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Flow ID are required'
      });
    }

    // TODO: Verify agent and flow belong to tenant
    const result = await AgentFlowService.deleteFlow(flowId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error deleting flow', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
