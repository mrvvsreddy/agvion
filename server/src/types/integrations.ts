// path: types/integrations.ts
import { ExecutionContext, IntegrationResult } from './context';

/**
 * Base integration function that returns execution context (state transformation)
 * Used for triggers and state-modifying operations
 */
export type IntegrationFunction = (
  context: ExecutionContext, 
  config: any
) => Promise<ExecutionContext>;

/**
 * Data integration function that returns structured result (data extraction)
 * Used for actions, API calls, and pure data operations
 */
export type DataIntegrationFunction = (
  context: ExecutionContext, 
  config: any
) => Promise<IntegrationResult>;

/**
 * Union type for all integration function types
 */
export type AnyIntegrationFunction = IntegrationFunction | DataIntegrationFunction;

/**
 * Integration function metadata for runtime type checking
 */
export interface IntegrationFunctionMeta {
  name: string;
  type: 'context' | 'data';
  category: 'trigger' | 'action';
  description?: string | undefined;
}

/**
 * Integration function registry entry
 */
export interface IntegrationFunctionEntry {
  fn: AnyIntegrationFunction;
  meta: IntegrationFunctionMeta;
}

/**
 * Integration interface with function registry
 */
export interface Integration {
  name: string;
  functions: Map<string, IntegrationFunctionEntry>;
  version?: string | undefined;
  capabilities?: {
    triggers: string[];
    actions: string[];
  } | undefined;
}

// Export ExecutionContext and IntegrationResult for use in other modules
export type { ExecutionContext, IntegrationResult };

/**
 * Type guards for runtime function type checking
 */
export function isContextIntegrationFunction(
  entry: IntegrationFunctionEntry
): entry is IntegrationFunctionEntry & { fn: IntegrationFunction } {
  return entry.meta.type === 'context';
}

export function isDataIntegrationFunction(
  entry: IntegrationFunctionEntry
): entry is IntegrationFunctionEntry & { fn: DataIntegrationFunction } {
  return entry.meta.type === 'data';
}

/**
 * Integration execution wrapper that handles both function types
 */
export class IntegrationExecutor {
  static async execute(
    entry: IntegrationFunctionEntry,
    context: ExecutionContext,
    config: any
  ): Promise<ExecutionContext> {
    const { fn, meta } = entry;
    
    if (meta.type === 'context') {
      return await (fn as IntegrationFunction)(context, config);
    } else if (meta.type === 'data') {
      const result = await (fn as DataIntegrationFunction)(context, config);
      return this.integrateDataResult(context, meta.name, result);
    } else {
      const exhaustiveCheck: never = meta.type;
      throw new Error(`Unknown integration function type: ${exhaustiveCheck}`);
    }
  }
  
  /**
   * Helper to integrate data results back into execution context
   */
  private static integrateDataResult(
    context: ExecutionContext,
    stepName: string,
    result: IntegrationResult
  ): ExecutionContext {
    return {
      ...context,
      variables: {
        ...context.variables,
        ...(typeof result.json === 'object' && result.json !== null ? result.json : {})
      },
      stepResults: {
        ...context.stepResults,
        [stepName]: result
      }
    };
  }
}

/**
 * Helper functions for integration registration
 */
export function createContextIntegration(
  name: string,
  fn: IntegrationFunction,
  description?: string
): IntegrationFunctionEntry {
  return {
    fn,
    meta: {
      name,
      type: 'context',
      category: 'trigger',
      ...(description !== undefined && { description })
    }
  };
}

export function createDataIntegration(
  name: string,
  fn: DataIntegrationFunction,
  description?: string
): IntegrationFunctionEntry {
  return {
    fn,
    meta: {
      name,
      type: 'data',
      category: 'action',
      ...(description !== undefined && { description })
    }
  };
}

/**
 * Integration registry for managing collections of integration functions
 */
export class IntegrationRegistry {
  private integrations = new Map<string, Integration>();

  /**
   * Register a new integration
   */
  register(integration: Integration): void {
    if (this.integrations.has(integration.name)) {
      throw new Error(`Integration '${integration.name}' is already registered`);
    }
    this.integrations.set(integration.name, integration);
  }

  /**
   * Get an integration by name
   */
  get(name: string): Integration | undefined {
    return this.integrations.get(name);
  }

  /**
   * Get a specific function from an integration
   */
  getFunction(integrationName: string, functionName: string): IntegrationFunctionEntry | undefined {
    const integration = this.get(integrationName);
    return integration?.functions.get(functionName);
  }

  /**
   * List all registered integrations
   */
  list(): Integration[] {
    return Array.from(this.integrations.values());
  }

  /**
   * Get all functions of a specific type across all integrations
   */
  getFunctionsByType(type: 'context' | 'data'): IntegrationFunctionEntry[] {
    const functions: IntegrationFunctionEntry[] = [];
    
    for (const integration of this.integrations.values()) {
      for (const entry of integration.functions.values()) {
        if (entry.meta.type === type) {
          functions.push(entry);
        }
      }
    }
    
    return functions;
  }

  /**
   * Get all functions of a specific category across all integrations
   */
  getFunctionsByCategory(category: 'trigger' | 'action'): IntegrationFunctionEntry[] {
    const functions: IntegrationFunctionEntry[] = [];
    
    for (const integration of this.integrations.values()) {
      for (const entry of integration.functions.values()) {
        if (entry.meta.category === category) {
          functions.push(entry);
        }
      }
    }
    
    return functions;
  }
}

/**
 * Integration builder for fluent API creation
 */
export class IntegrationBuilder {
  private name: string;
  private functions = new Map<string, IntegrationFunctionEntry>();
  private version?: string;
  private capabilities?: { triggers: string[]; actions: string[] };

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Add a context integration function
   */
  addContextFunction(name: string, fn: IntegrationFunction, description?: string): this {
    const entry = createContextIntegration(name, fn, description);
    this.functions.set(name, entry);
    return this;
  }

  /**
   * Add a data integration function
   */
  addDataFunction(name: string, fn: DataIntegrationFunction, description?: string): this {
    const entry = createDataIntegration(name, fn, description);
    this.functions.set(name, entry);
    return this;
  }

  /**
   * Set version information
   */
  setVersion(version: string): this {
    this.version = version;
    return this;
  }

  /**
   * Set capabilities information
   */
  setCapabilities(capabilities: { triggers: string[]; actions: string[] }): this {
    this.capabilities = capabilities;
    return this;
  }

  /**
   * Build the integration
   */
  build(): Integration {
    return {
      name: this.name,
      functions: this.functions,
      ...(this.version !== undefined && { version: this.version }),
      ...(this.capabilities !== undefined && { capabilities: this.capabilities })
    };
  }
}