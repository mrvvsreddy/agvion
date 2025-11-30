// agent/routes/agentRoutes.ts
import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../auth/middleware/authMiddleware';
import AgentService from '../services/AgentService';
import AgentTokenService from '../services/AgentTokenService';
import AgentHomeService from '../services/AgentHomeService';
import agentFlowRoutes from './agentFlowRoutes';
import logger from '../../utils/logger';
import rateLimit from 'express-rate-limit';

/**
 * Validation utilities for agent routes
 */
const validateAgentId = (agentId: string): void => {
  if (!agentId || typeof agentId !== 'string') {
    throw new Error('Agent ID is required');
  }

  if (agentId.trim().length === 0) {
    throw new Error('Agent ID cannot be empty');
  }

  // Basic format validation (alphanumeric with some special chars)
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    throw new Error('Invalid agent ID format');
  }

  // Length validation
  if (agentId.length < 3 || agentId.length > 50) {
    throw new Error('Agent ID must be between 3 and 50 characters');
  }
};

const validateWorkflowId = (workflowId: string): void => {
  if (!workflowId || typeof workflowId !== 'string') {
    throw new Error('Workflow ID is required');
  }

  if (workflowId.trim().length === 0) {
    throw new Error('Workflow ID cannot be empty');
  }

  // UUID format validation
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workflowId)) {
    throw new Error('Invalid workflow ID format');
  }
};

const validatePrompt = (prompt: string): void => {
  if (typeof prompt !== 'string') {
    throw new Error('Prompt must be a string');
  }

  if (prompt.length > 10000) {
    throw new Error('Prompt must be less than 10,000 characters');
  }
};

/**
 * Validate agent ownership and access
 */
const validateAgentAccess = async (agentId: string, tenantId: string): Promise<void> => {
  try {
    validateAgentId(agentId);

    // Check if agent exists and belongs to tenant
    const agent = await AgentService.getAgentById(tenantId, agentId);
    if (!agent.success || !agent.agent) {
      throw new Error('Agent not found');
    }

    if (agent.agent.tenant_id !== tenantId) {
      throw new Error('Access denied: Agent does not belong to your tenant');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Agent access validation failed', { agentId, tenantId, error: errorMessage });
    throw error;
  }
};

const router = Router();

// Rate limiter specifically for agent creation
const createAgentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each user to 5 agent creations per windowMs
  message: 'Too many agents created. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Use user ID as key for rate limiting (not IP)
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.id || req.ip || 'anonymous';
  },
});

/**
 * Create a new agent
 * POST /api/agents
 */
router.post('/', authenticateToken, createAgentLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    const tenantId = req.user?.tenantId;

    // Validate input
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Agent name is required'
      });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Agent name must be less than 100 characters'
      });
    }

    // Security audit log
    logger.info('Agent creation attempt', {
      userId: req.user?.id,
      tenantId,
      agentName: name.trim(),
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const result = await AgentService.createAgent(tenantId, {
      name: name.trim(),
      description: description?.trim()
    });

    if (!result.success) {
      logger.warn('Agent creation failed', {
        userId: req.user?.id,
        tenantId,
        agentName: name.trim(),
        reason: result.message
      });
      return res.status(400).json(result);
    }

    // Log successful creation
    logger.info('Agent created successfully', {
      userId: req.user?.id,
      tenantId,
      agentId: result.agent?.id,
      agentName: name.trim()
    });

    return res.status(201).json(result);
  } catch (error) {
    logger.error('Error creating agent', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Update agent (rename)
 * PUT /api/agents/:agentId
 */
router.put('/:agentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const { name } = req.body;
    const tenantId = req.user?.tenantId;

    // Validate tenant
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate agent ID
    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Agent name is required'
      });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Agent name must be less than 100 characters'
      });
    }

    // Update agent
    const result = await AgentService.updateAgent(tenantId, agentId, {
      name: name.trim()
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    logger.info('Agent renamed successfully', {
      userId: req.user?.id,
      tenantId,
      agentId,
      newName: name.trim()
    });

    return res.json(result);
  } catch (error) {
    logger.error('Error renaming agent', { error, userId: req.user?.id, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get all agents for the authenticated tenant
 * GET /api/agents
 */
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    const result = await AgentService.getAgentsByTenant(tenantId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agents', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get agents by workspace
 * GET /api/agents/workspace/:workspaceId
 */
router.get('/workspace/:workspaceId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: 'Workspace ID is required'
      });
    }

    // TODO: Verify workspace belongs to tenant
    const result = await AgentService.getAgentsByWorkspace(workspaceId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agents by workspace', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get a specific agent by ID
 * GET /api/agents/:agentId
 */
router.get('/:agentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
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

    const result = await AgentService.getAgentById(tenantId, agentId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent by ID', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Generate agent access token
 * POST /api/agents/:agentId/token
 */
router.post('/:agentId/token', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID is required'
      });
    }

    // Get workspace ID from agent
    const agentResult = await AgentService.getAgentById(tenantId, agentId);
    if (!agentResult.success || !agentResult.agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found or access denied'
      });
    }

    const workspaceId = agentResult.agent.workspace_id;
    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        message: 'Agent has no associated workspace'
      });
    }

    const tokenResult = await AgentTokenService.generateAgentToken(
      agentId,
      tenantId,
      workspaceId,
      userId
    );

    if (!tokenResult.success) {
      return res.status(400).json(tokenResult);
    }

    return res.json(tokenResult);
  } catch (error) {
    logger.error('Error generating agent token', { error, userId: req.user?.id, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get agent studio data using agent ID (agent + workflows + tables + database connections)
 * GET /api/agents/studio/:agentId
 */
router.get('/studio/:agentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate agent ID and access
    if (!agentId || !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Tenant ID are required'
      });
    }

    validateAgentId(agentId);
    await validateAgentAccess(agentId, tenantId);

    const result = await AgentService.getAgentStudioData(tenantId, agentId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent studio data', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get minimal agent studio data for homepage using agent ID (optimized for performance)
 * GET /api/agents/studio/:agentId/home
 */
router.get('/studio/:agentId/home', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate agent ID and access
    if (!agentId || !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Tenant ID are required'
      });
    }

    validateAgentId(agentId);
    await validateAgentAccess(agentId, tenantId);

    const result = await AgentService.getAgentStudioHomeData(tenantId, agentId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent studio home data', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get agent workflows with full data using agent ID
 * GET /api/agents/:agentId/workflows
 */
router.get('/:agentId/workflows', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
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

    const result = await AgentService.getAgentWorkflows(tenantId, agentId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent workflows', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get agent tables with full data using agent ID
 * GET /api/agents/:agentId/tables
 */
router.get('/:agentId/tables', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
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

    // getAgentTables method removed - use knowledge base routes instead
    return res.status(501).json({
      success: false,
      message: 'This endpoint has been removed. Use /api/knowledge endpoints instead.'
    });
  } catch (error) {
    logger.error('Error getting agent tables', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get agent integrations using agent ID
 * GET /api/agents/:agentId/integrations
 */
router.get('/:agentId/integrations', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
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

    const result = await AgentService.getAgentIntegrations(tenantId, agentId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent integrations', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get agent database connections using agent ID
 * GET /api/agents/studio/:agentId/database-connections
 */
router.get('/studio/:agentId/database-connections', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate agent ID and access
    if (!agentId || !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Tenant ID are required'
      });
    }

    validateAgentId(agentId);
    await validateAgentAccess(agentId, tenantId);

    const result = await AgentService.getAgentDatabaseConnections(
      tenantId,
      agentId
    );

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent database connections with agent ID', { error, agentId: req.params.agentId });

    // Handle validation errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('Agent ID') || errorMessage.includes('Access denied')) {
      return res.status(400).json({
        success: false,
        message: errorMessage
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Update agent prompt using agent ID
 * PUT /api/agents/studio/:agentId/prompt
 */
router.put('/studio/:agentId/prompt', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const { prompt } = req.body;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate inputs
    if (!agentId || !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Tenant ID are required'
      });
    }

    validateAgentId(agentId);
    validatePrompt(prompt);
    await validateAgentAccess(agentId, tenantId);

    const result = await AgentHomeService.updateAgentPrompt(
      tenantId,
      agentId,
      prompt.trim()
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error updating agent prompt', { error, agentId: req.params.agentId });

    // Handle validation errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('Agent ID') || errorMessage.includes('Prompt') || errorMessage.includes('Access denied')) {
      return res.status(400).json({
        success: false,
        message: errorMessage
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get agent prompt using agent ID
 * GET /api/agents/studio/:agentId/prompt
 */
router.get('/studio/:agentId/prompt', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate agent ID and access
    if (!agentId || !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Tenant ID are required'
      });
    }

    validateAgentId(agentId);
    await validateAgentAccess(agentId, tenantId);

    const result = await AgentHomeService.getAgentPrompt(
      tenantId,
      agentId
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error getting agent prompt', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Update workflow prompt using agent ID (system prompt in main workflow)
 * PUT /api/agents/studio/:agentId/workflows/:workflowId/prompt
 */
router.put('/studio/:agentId/workflows/:workflowId/prompt', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, workflowId } = req.params;
    const { prompt } = req.body;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate inputs
    if (!agentId || !tenantId || !workflowId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID, Tenant ID, and Workflow ID are required'
      });
    }

    validateAgentId(agentId);
    validateWorkflowId(workflowId);
    validatePrompt(prompt);
    await validateAgentAccess(agentId, tenantId);

    const result = await AgentHomeService.updateWorkflowPrompt(
      tenantId,
      agentId,
      workflowId,
      prompt.trim()
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error updating workflow prompt', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Refresh agent home cache using agent ID
 * POST /api/agents/studio/:agentId/refresh-cache
 */
router.post('/studio/:agentId/refresh-cache', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Validate agent ID and access
    if (!agentId || !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Agent ID and Tenant ID are required'
      });
    }

    validateAgentId(agentId);
    await validateAgentAccess(agentId, tenantId);

    const result = await AgentHomeService.refreshAgentHomeCache(
      tenantId,
      agentId
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error refreshing agent home cache', { error, agentId: req.params.agentId });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Delete an agent
 * DELETE /api/agents/:agentId
 */
router.delete('/:agentId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
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

    const result = await AgentService.deleteAgent(tenantId, agentId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error deleting agent', { error, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Mount flow routes
router.use('/', agentFlowRoutes);

export default router;
