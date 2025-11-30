// path: core/integrationRegistry/index.ts
import { Integration, IntegrationFunctionEntry, IntegrationExecutor } from '../../types/integrations';
import { ExecutionContext } from '../../types/context';
import logger from '../../utils/logger';
import { loadModularIntegrations } from './loader';
import { loadBuiltInIntegrations } from './registryLoader';

/**
 * Integration registry statistics
 */
export interface RegistryStats {
  totalIntegrations: number;
  totalFunctions: number;
  integrationsByType: {
    triggers: number;
    actions: number;
  };
  integrationsList: Array<{
    name: string;
    version?: string;
    functionCount: number;
    capabilities?: {
      triggers: string[];
      actions: string[];
    };
  }>;
}

/**
 * Function execution result
 */
export interface FunctionExecutionResult {
  success: boolean;
  context?: ExecutionContext;
  error?: string;
  executionTime: number;
}

/**
 * Main integration registry class
 */
export default class IntegrationRegistry {
  private integrations = new Map<string, Integration>();
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize the registry with integrations
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Prevent multiple concurrent initializations
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.performInitialization();
    return this.initializationPromise;
  }

  private async performInitialization(): Promise<void> {
    try {
      logger.info('Starting integration registry initialization');

      // Try to load modular integrations first
      try {
        await loadModularIntegrations(this.integrations);
        logger.info('Modular integrations loaded', { 
          count: this.integrations.size 
        });
      } catch (error) {
        logger.warn('Failed to load modular integrations', { error });
      }

      // Always load built-in integrations
      try {
        await loadBuiltInIntegrations(this.integrations);
        logger.info('Built-in integrations loaded');
      } catch (error) {
        logger.error('Failed to load built-in integrations', { error });
        throw error;
      }

      // Validate loaded integrations
      this.validateIntegrations();

      logger.info('Integration registry initialized successfully', {
        totalIntegrations: this.integrations.size,
        integrations: Array.from(this.integrations.keys())
      });

    } catch (error) {
      logger.error('Failed to initialize integration registry', { error });
      throw error;
    } finally {
      this.initialized = true;
      this.initializationPromise = null;
    }
  }

  /**
   * Validate that all integrations are properly configured
   */
  private validateIntegrations(): void {
    for (const [name, integration] of this.integrations) {
      if (!integration.name || integration.name !== name) {
        logger.warn(`Integration name mismatch: ${name} vs ${integration.name}`);
      }

      if (integration.functions.size === 0) {
        logger.warn(`Integration ${name} has no functions`);
      }

      // Validate each function entry
      for (const [funcName, entry] of integration.functions) {
        if (!entry.fn || !entry.meta) {
          logger.error(`Invalid function entry: ${name}.${funcName}`);
        }
      }
    }
  }

  /**
   * Get a specific function from an integration
   */
  async getFunction(integrationName: string, functionName: string): Promise<IntegrationFunctionEntry | undefined> {
    if (!this.initialized) {
      await this.initialize();
    }

    const integration = this.integrations.get(integrationName);
    if (!integration) {
      logger.warn(`Integration not found: ${integrationName}`);
      return undefined;
    }

    const functionEntry = integration.functions.get(functionName);
    if (!functionEntry) {
      logger.warn(`Function not found: ${integrationName}.${functionName}`);
      return undefined;
    }

    return functionEntry;
  }

  /**
   * Get an integration by name
   */
  async getIntegration(name: string): Promise<Integration | undefined> {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.integrations.get(name);
  }

  /**
   * Get all registered integrations
   */
  async getAllIntegrations(): Promise<Integration[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    return Array.from(this.integrations.values());
  }

  /**
   * Execute a specific integration function
   */
  async executeFunction(
    integrationName: string, 
    functionName: string, 
    context: ExecutionContext,
    config: any = {}
  ): Promise<FunctionExecutionResult> {
    const startTime = Date.now();

    try {
      const functionEntry = await this.getFunction(integrationName, functionName);
      
      if (!functionEntry) {
        return {
          success: false,
          error: `Function ${integrationName}.${functionName} not found`,
          executionTime: Date.now() - startTime
        };
      }

      logger.debug(`Executing function: ${integrationName}.${functionName}`, {
        functionType: functionEntry.meta.type,
        functionCategory: functionEntry.meta.category
      });

      const resultContext = await IntegrationExecutor.execute(functionEntry, context, config);

      return {
        success: true,
        context: resultContext,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      logger.error(`Function execution failed: ${integrationName}.${functionName}`, { 
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Get all available functions across all integrations
   */
  async getAllAvailableFunctions(): Promise<Array<{
    integration: string;
    function: string;
    meta: IntegrationFunctionEntry['meta'];
  }>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const functions: Array<{
      integration: string;
      function: string;
      meta: IntegrationFunctionEntry['meta'];
    }> = [];

    for (const [integrationName, integration] of this.integrations) {
      for (const [functionName, entry] of integration.functions) {
        functions.push({
          integration: integrationName,
          function: functionName,
          meta: entry.meta
        });
      }
    }

    return functions;
  }

  /**
   * Get integrations by category (trigger/action)
   */
  async getIntegrationsByCategory(category: 'trigger' | 'action'): Promise<Array<{
    integration: string;
    function: string;
    meta: IntegrationFunctionEntry['meta'];
  }>> {
    const allFunctions = await this.getAllAvailableFunctions();
    return allFunctions.filter(func => func.meta.category === category);
  }

  /**
   * Get registry statistics
   */
  async getStats(): Promise<RegistryStats> {
    if (!this.initialized) {
      await this.initialize();
    }

    let totalFunctions = 0;
    let triggerCount = 0;
    let actionCount = 0;

    const integrationsList = Array.from(this.integrations.values()).map(integration => {
      const functionCount = integration.functions.size;
      totalFunctions += functionCount;

      // Count triggers and actions
      for (const entry of integration.functions.values()) {
        if (entry.meta.category === 'trigger') {
          triggerCount++;
        } else if (entry.meta.category === 'action') {
          actionCount++;
        }
      }

      // Build result object without undefined values to satisfy exactOptionalPropertyTypes
      const result: {
        name: string;
        functionCount: number;
        version?: string;
        capabilities?: {
          triggers: string[];
          actions: string[];
        };
      } = {
        name: integration.name,
        functionCount
      };

      // Only add optional properties if they have actual values
      if (integration.version !== undefined) {
        result.version = integration.version;
      }

      if (integration.capabilities !== undefined) {
        result.capabilities = integration.capabilities;
      }

      return result;
    });

    return {
      totalIntegrations: this.integrations.size,
      totalFunctions,
      integrationsByType: {
        triggers: triggerCount,
        actions: actionCount
      },
      integrationsList
    };
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Register a new integration manually
   */
  async registerIntegration(integration: Integration): Promise<void> {
    if (this.integrations.has(integration.name)) {
      throw new Error(`Integration '${integration.name}' is already registered`);
    }

    // Validate integration structure
    if (!integration.name || !integration.functions) {
      throw new Error(`Invalid integration structure: ${integration.name}`);
    }

    this.integrations.set(integration.name, integration);
    
    logger.info(`Manually registered integration: ${integration.name}`, {
      functionCount: integration.functions.size,
      version: integration.version
    });
  }

  /**
   * Unregister an integration
   */
  async unregisterIntegration(name: string): Promise<boolean> {
    const success = this.integrations.delete(name);
    
    if (success) {
      logger.info(`Unregistered integration: ${name}`);
    } else {
      logger.warn(`Failed to unregister integration (not found): ${name}`);
    }

    return success;
  }

  /**
   * Cleanup resources and reset registry
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up integration registry');
    
    this.integrations.clear();
    this.initialized = false;
    this.initializationPromise = null;
    
    logger.info('Integration registry cleaned up');
  }

  /**
   * Reload all integrations
   */
  async reload(): Promise<void> {
    await this.cleanup();
    await this.initialize();
  }

  /**
   * Get integration function by full path (integration.function)
   */
  async getFunctionByPath(path: string): Promise<IntegrationFunctionEntry | undefined> {
    const [integrationName, functionName] = path.split('.');
    
    if (!integrationName || !functionName) {
      logger.warn(`Invalid function path: ${path}`);
      return undefined;
    }

    return this.getFunction(integrationName, functionName);
  }

  /**
   * List all function paths in the registry
   */
  async listAllFunctionPaths(): Promise<string[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const paths: string[] = [];

    for (const [integrationName, integration] of this.integrations) {
      for (const functionName of integration.functions.keys()) {
        paths.push(`${integrationName}.${functionName}`);
      }
    }

    return paths.sort();
  }
}