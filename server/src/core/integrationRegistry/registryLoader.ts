// path: core/integrationRegistry/registryLoader.ts
import { Integration } from '../../types/integrations';
import logger from '../../utils/logger';

// Import integration index files
import agentIntegration from '../../integrations/agent';
import agentMemoryIntegration from '../../integrations/agent_memory';
import openaiIntegration from '../../integrations/openai';
import openrouterIntegration from '../../integrations/openrouter';
import webchatIntegration from '../../integrations/webchat';

/**
 * Integration configurations
 */
const INTEGRATIONS = [
  { name: 'agent', loader: agentIntegration, enabled: true },
  { name: 'agent-memory', loader: agentMemoryIntegration, enabled: true },
  { name: 'openai', loader: openaiIntegration, enabled: true },
  { name: 'openrouter', loader: openrouterIntegration, enabled: true },
  { name: 'webchat', loader: webchatIntegration, enabled: true }
] as const;

/**
 * Load all built-in integrations into the registry
 */
export async function loadBuiltInIntegrations(map: Map<string, Integration>): Promise<void> {
  logger.info('Loading built-in integrations...');

  let loaded = 0;
  let failed = 0;

  for (const { name, loader, enabled } of INTEGRATIONS) {
    if (!enabled) {
      logger.debug(`Skipping disabled integration: ${name}`);
      continue;
    }

    try {
      const integration = loader.register();
      validateIntegration(integration);
      
      map.set(name, integration);
      logger.info(`Loaded integration: ${name} (${integration.functions.size} functions)`);
      loaded++;
      
    } catch (error) {
      logger.error(`Failed to load integration: ${name}`, { error });
      failed++;
    }
  }

  logger.info(`Integration loading complete: ${loaded} loaded, ${failed} failed`);
  
  if (loaded === 0) {
    throw new Error('No integrations loaded successfully');
  }
}

/**
 * Basic integration validation
 */
function validateIntegration(integration: Integration): void {
  if (!integration?.name || !integration?.functions || integration.functions.size === 0) {
    throw new Error('Invalid integration structure');
  }

  for (const [name, entry] of integration.functions) {
    if (!entry?.fn || !entry?.meta?.name || !entry?.meta?.type || !entry?.meta?.category) {
      throw new Error(`Invalid function: ${name}`);
    }
  }
}

/**
 * Get available integration names
 */
export function getAvailableIntegrations(): string[] {
  return INTEGRATIONS.filter(i => i.enabled).map(i => i.name);
}

/**
 * Check if integration is available
 */
export function isIntegrationAvailable(name: string): boolean {
  return getAvailableIntegrations().includes(name);
}

/**
 * Load specific integration
 */
export async function loadSpecificIntegration(name: string): Promise<Integration | null> {
  const config = INTEGRATIONS.find(i => i.name === name);
  
  if (!config?.enabled) {
    return null;
  }

  try {
    return config.loader.register();
  } catch (error) {
    logger.error(`Failed to load integration: ${name}`, { error });
    return null;
  }
}