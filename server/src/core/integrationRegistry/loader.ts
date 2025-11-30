import fs from 'fs/promises';
import path from 'path';
import { Integration } from '../../types/integrations';
import logger from '../../utils/logger';

export async function loadModularIntegrations(map: Map<string, Integration>) {
  const dir = path.join(__dirname, '../../integrations');

  try {
    await fs.access(dir);
  } catch {
    logger.warn('Integrations dir not found, skipping modular load');
    return;
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const basePath = path.join(dir, entry.name);
    const tsPath = path.join(basePath, 'index.ts');
    const jsPath = path.join(basePath, 'index.js');

    let integrationModule;
    try {
      await fs.access(tsPath).catch(() => fs.access(jsPath));
      integrationModule = await import(tsPath).catch(() => import(jsPath));
    } catch {
      logger.warn(`No valid index file for ${entry.name}`);
      continue;
    }

    if (integrationModule?.default?.register) {
      const integration = integrationModule.default.register();
      map.set(integration.name, integration);
      logger.info(`Loaded integration: ${integration.name}`);
    }
  }
}
