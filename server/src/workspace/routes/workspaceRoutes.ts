// path: server/src/workspace/routes/workspaceRoutes.ts

import { Router, Request, Response } from 'express';
import { WorkspaceService } from '../services/WorkspaceService';
import { isWorkspaceError, hasStatusCode } from '../errors/WorkspaceErrors';
import logger from '../../utils/logger';

const router = Router();
const workspaceService = new WorkspaceService();

// Get workspace data (workspace info, agents, stats)
router.get('/data', async (req: Request, res: Response) => {
  try {
    const sessionToken = extractSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'No session token provided' });
    }

    const workspaceData = await workspaceService.getWorkspaceData(sessionToken);
    return res.json(workspaceData);
  } catch (error) {
    return handleWorkspaceError(res, error, 'Failed to get workspace data');
  }
});

// Get workspace metadata only
router.get('/metadata', async (req: Request, res: Response) => {
  try {
    const sessionToken = extractSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'No session token provided' });
    }

    const metadata = await workspaceService.getWorkspaceMetadata(sessionToken);
    return res.json(metadata);
  } catch (error) {
    return handleWorkspaceError(res, error, 'Failed to get workspace metadata');
  }
});

// Update workspace metadata
router.put('/metadata', async (req: Request, res: Response) => {
  try {
    const sessionToken = extractSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'No session token provided' });
    }

    const { metadata } = req.body;
    if (!metadata) {
      return res.status(400).json({ error: 'Metadata is required' });
    }

    const updatedWorkspace = await workspaceService.updateWorkspaceMetadata(sessionToken, metadata);
    return res.json(updatedWorkspace);
  } catch (error) {
    return handleWorkspaceError(res, error, 'Failed to update workspace metadata');
  }
});

// Get workspace agents
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const sessionToken = extractSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'No session token provided' });
    }

    const workspaceData = await workspaceService.getWorkspaceData(sessionToken);
    return res.json(workspaceData.agents);
  } catch (error) {
    return handleWorkspaceError(res, error, 'Failed to get workspace agents');
  }
});

// Get workspace stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const sessionToken = extractSessionToken(req);
    if (!sessionToken) {
      return res.status(401).json({ error: 'No session token provided' });
    }

    const workspaceData = await workspaceService.getWorkspaceData(sessionToken);
    return res.json(workspaceData.stats);
  } catch (error) {
    return handleWorkspaceError(res, error, 'Failed to get workspace stats');
  }
});

/**
 * Helper functions for route handling
 */

function extractSessionToken(req: Request): string | null {
  const bearer = req.headers['authorization'];
  if (bearer?.startsWith('Bearer ')) {
    return bearer.slice(7);
  }

  return req.cookies?.session || req.cookies?.['__Host-session'] || null;
}

function handleWorkspaceError(res: Response, error: unknown, context: string): Response {
  logger.error(context, {
    error: error instanceof Error ? error.message : 'Unknown error'
  });

  if (isWorkspaceError(error)) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      details: error.details
    });
  }

  if (hasStatusCode(error)) {
    return res.status(error.statusCode).json({
      error: error.message
    });
  }

  // Default to 500 for unknown errors
  return res.status(500).json({
    error: error instanceof Error ? error.message : 'Internal server error'
  });
}

export default router;