// path: integrations/webchat/connect/index.ts
import { Router, Request, Response } from 'express';
import { redisClient } from '../../../redis';
import logger from '../../../utils/logger';

const router = Router();

// GET /webchat/connect/scripts/:agentId
router.get('/connect/scripts/:agentId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { agentId } = req.params;
    if (!agentId) {
      res.status(400).json({ error: 'Missing agentId' });
      return;
    }

    const cacheKey = `agent:studio:home:${agentId}`;
    const data = await (redisClient as any).getJson(cacheKey);
    if (!data || !Array.isArray(data.integrations)) {
      res.status(404).json({ error: 'Integration data not found' });
      return;
    }

    const webchat = data.integrations.find((i: any) => i.integration_channel === 'webchat' || i.channel === 'webchat');
    const webchatJs = webchat?.config?.connect?.chatbubble?.webchat_js;
    const configJs = webchat?.config?.connect?.chatbubble?.config_js;

    if (typeof webchatJs !== 'string' || typeof configJs !== 'string') {
      res.status(404).json({ error: 'Script URLs not found' });
      return;
    }

    res.json({ webchatJs, configJs });
  } catch (error) {
    logger.warn('Failed to load webchat connect scripts', { error });
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;


