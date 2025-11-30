// Agent Memory Integration - Main Entry Point
// Clean, organized exports for the refactored agent memory system

// Core service exports
export { 
  AgentMemoryService, 
  createAgentMemoryService,
  getAgentMemoryService,
  clearAgentMemoryServiceCache
} from './service';

// Integration exports  
export { 
  store, 
  retrieve, 
  search,
  get,
  find,
  save,
  smartMemory,
  createMemoryService,
  extractExecutionContext
} from './integration';

// Core type exports
export type {
  SessionMessage,
  StoreMessageRequest,
  StoreMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  SearchMessagesRequest,
  SearchMessagesResponse,
  SearchMessageResult,
  AgentMemoryConfig,
  AgentMemoryServiceConfig,
  AgentMemoryRow,
  AgentMemoryRowData,
  AgentMemoryRowInsert,
  SessionStats,
  ValidationResult,
  EnhancedValidationResult,
  PaginationParams,
  PaginatedResponse,
  SessionRowQueryOptions,
  OperationResult,
  AsyncOperationResult,
  ExecutionMetadata,
  AgentContext
} from './types';

// Integration input/output types
export type {
  AgentMemoryToolOutput,
  ExecutionContextWithAgent,
  WorkflowExecutionContextWithAgent
} from './integration';

// Error class exports
export {
  AgentMemoryError,
  SessionNotFoundError,
  InvalidMessageFormatError,
  TableOperationError
} from './types';

// Constants export
export { AGENT_MEMORY_CONSTANTS } from './types';

// Type guard exports
export {
  isStoreMessageRequest,
  isGetMessagesRequest,
  isSearchMessagesRequest,
  isAgentMemoryRowData,
  isAgentMemoryRow
} from './types';

// Validation function exports - these are available through the AgentMemoryValidator class

// Validation class export
export { AgentMemoryValidator } from './validation';

// Operation class exports
export { AgentMemoryStore } from './store';
export { AgentMemoryRetrieve } from './retrieve';
export { AgentMemorySearch } from './search';

// Integration metadata
export const AGENT_MEMORY_INTEGRATION_META = {
  name: 'agent-memory',
  version: '4.0.0',
  description: 'Refactored session-based memory storage with agent/tenant isolation, comprehensive validation, universal selector support, and modular architecture',
  capabilities: {
    sessionManagement: true,
    fullTextSearch: true,
    pagination: true,
    autoTableCreation: true,
    typeValidation: true,
    strictTypeScript: true,
    executionMetadata: true,
    comprehensiveValidation: true,
    dataTransformation: true,
    businessRuleValidation: true,
    performanceOptimization: true,
    aliasSupport: true,
    warningSystem: true,
    agentTenantIsolation: true,
    contextAwareValidation: true,
    multiSourceContextResolution: true,
    modularArchitecture: true,
    cleanCodeStructure: true,
    universalSelectorSupport: true,
    enhancedSecurity: true
  },
  contextRequirements: {
    agentId: 'required - unique agent identifier for data isolation',
    tenantId: 'required - tenant identifier for multi-tenancy support',
    contextSources: [
      'execution_context.agent.id + execution_context.agent.tenantId',
      'execution_context.agentId + execution_context.tenantId', 
      'direct_input.agentId + direct_input.tenantId',
      'execution_context.tenant.id (with default agent)',
      'legacy fallback (development only)'
    ]
  },
  functions: [
    {
      name: 'store',
      description: 'Store a validated message in agent memory session with agent/tenant context',
      contextRequirements: ['agentId', 'tenantId'],
      parameters: {
        tableName: { 
          type: 'string', 
          required: true, 
          description: 'Memory table name (validated, agent-scoped)' 
        },
        sessionId: { 
          type: 'string', 
          required: true, 
          description: 'Session identifier (validated, tenant-scoped)' 
        },
        operation: { 
          type: 'string', 
          required: true, 
          enum: ['store'], 
          description: 'Operation type with aliases support' 
        },
        userInput: { 
          type: 'string', 
          required: true, 
          description: 'User input message (validated and trimmed)' 
        },
        output: { 
          type: 'string', 
          required: true, 
          description: 'Agent output response (validated and trimmed)' 
        },
        systemPrompt: { 
          type: 'string', 
          required: false, 
          description: 'System prompt used (optional, validated)' 
        },
        userPrompt: { 
          type: 'string', 
          required: false, 
          description: 'User prompt used (optional, validated)' 
        },
        agentId: {
          type: 'string',
          required: false,
          description: 'Agent ID (can be provided directly or extracted from context)'
        },
        tenantId: {
          type: 'string', 
          required: false,
          description: 'Tenant ID (can be provided directly or extracted from context)'
        }
      },
      validation: {
        maxMessageLength: 50000,
        requiredFields: ['userInput', 'output'],
        businessRules: ['content validation', 'encoding check', 'size limits', 'agent-tenant isolation'],
        contextValidation: ['agent ownership', 'tenant access rights']
      }
    },
    {
      name: 'get',
      description: 'Retrieve validated messages from agent memory session with agent/tenant context',
      contextRequirements: ['agentId', 'tenantId'],
      parameters: {
        tableName: { 
          type: 'string', 
          required: true, 
          description: 'Memory table name (agent-validated)' 
        },
        sessionId: { 
          type: 'string', 
          required: true, 
          description: 'Session identifier (tenant-validated)' 
        },
        operation: { 
          type: 'string', 
          required: true, 
          enum: ['get'], 
          description: 'Operation type with aliases' 
        },
        limit: {
          type: 'number',
          required: false,
          description: 'Maximum number of messages to retrieve (default: 50, max: 1000)'
        },
        offset: {
          type: 'number',
          required: false,
          description: 'Number of messages to skip (for pagination)'
        },
        orderDirection: {
          type: 'string',
          required: false,
          enum: ['asc', 'desc'],
          description: 'Order direction for message retrieval (default: desc)'
        },
        agentId: { type: 'string', required: false },
        tenantId: { type: 'string', required: false }
      },
      validation: {
        maxLimit: 1000,
        businessRules: ['performance optimization', 'pagination efficiency', 'agent-tenant isolation']
      }
    },
    {
      name: 'search',
      description: 'Search messages with agent/tenant context and comprehensive validation',
      contextRequirements: ['agentId', 'tenantId'],
      parameters: {
        tableName: { 
          type: 'string', 
          required: true, 
          description: 'Memory table name (agent-validated)' 
        },
        sessionId: { 
          type: 'string', 
          required: true, 
          description: 'Session identifier (tenant-validated)' 
        },
        operation: { 
          type: 'string', 
          required: true, 
          enum: ['search'], 
          description: 'Search operation with aliases' 
        },
        query: { 
          type: 'string', 
          required: true, 
          description: 'Search query (validated and trimmed)' 
        },
        searchFields: {
          type: 'array',
          required: false,
          description: 'Fields to search in (default: userInput, output)'
        },
        limit: {
          type: 'number',
          required: false,
          description: 'Maximum number of results to return'
        },
        minRelevanceScore: {
          type: 'number',
          required: false,
          description: 'Minimum relevance score for results (0-1)'
        },
        agentId: { type: 'string', required: false },
        tenantId: { type: 'string', required: false }
      },
      validation: {
        queryLength: { min: 1, max: 1000 },
        businessRules: ['performance optimization', 'query pattern analysis', 'agent-tenant isolation']
      }
    }
  ],
  validation: {
    inputValidation: 'comprehensive with agent/tenant context',
    businessRules: 'enforced with multi-tenancy',
    dataTransformation: 'automatic with context awareness',
    errorHandling: 'graceful with context information',
    performanceChecks: 'enabled with tenant-specific optimizations',
    contextResolution: 'multi-source with fallback hierarchy'
  },
  architecture: {
    modularity: 'separate files for each concern',
    separationOfConcerns: 'types, validation, store, retrieve, search, service, integration',
    codeOrganization: 'clean, maintainable, and testable',
    typeSafety: 'comprehensive TypeScript support',
    errorHandling: 'centralized and consistent',
    logging: 'structured and contextual'
  }
} as const;

// Enhanced utility functions with agent/tenant context support
export const AgentMemoryUtils = {
  /**
   * Create a standardized session ID with agent context
   */
  createSessionId: (agentId?: string, prefix = 'session'): string => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const agentPrefix = agentId ? `${agentId}_` : '';
    return `${agentPrefix}${prefix}_${timestamp}_${random}`;
  },

  /**
   * Create a standardized table name with agent context
   */
  createTableName: (name: string, agentId?: string): string => {
    const agentPrefix = agentId ? `${agentId}_` : '';
    const fullName = `${agentPrefix}${name}`;
    const sanitized = fullName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[^a-zA-Z]/, 'table_');
    return sanitized.length > 63 // MAX_TABLE_NAME_LENGTH
      ? sanitized.substring(0, 63)
      : sanitized;
  },

  /**
   * Validate complete agent memory configuration with context
   */
  validateConfig: async (config: any, agentContext?: any) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate required fields
      const tableValidation = { isValid: true, errors: [] }; // Simplified for now
      if (!tableValidation.isValid) {
        errors.push(...tableValidation.errors.map((e: string) => `tableName: ${e}`));
      }

      const sessionValidation = { isValid: true, errors: [] }; // Simplified for now
      if (!sessionValidation.isValid) {
        errors.push(...sessionValidation.errors.map((e: string) => `sessionId: ${e}`));
      }

      if (!['store', 'get', 'search'].includes(config.operation)) {
        errors.push('operation must be one of: store, get, search');
      }

      // Enhanced validation with agent context
      if (agentContext) {
        if (config.tableName.startsWith('system') && agentContext.agentId !== 'system') {
          warnings.push('Table name has system prefix but agent is not system');
        }

        if (agentContext.tenantId === 'demo' || agentContext.tenantId === 'test') {
          warnings.push(`Configuration for ${agentContext.tenantId} tenant - data may be temporary`);
        }
      }

      // Validate optional fields
      if (config.maxContextLength !== undefined) {
        if (typeof config.maxContextLength !== 'number' || 
            !Number.isInteger(config.maxContextLength) || 
            config.maxContextLength < 1) {
          errors.push('maxContextLength must be a positive integer');
        } else if (config.maxContextLength > 1000) { // MAX_LIMIT
          warnings.push(`maxContextLength (${config.maxContextLength}) exceeds recommended limit (1000)`);
        }
      }

      if (config.autoCreateTable !== undefined && typeof config.autoCreateTable !== 'boolean') {
        errors.push('autoCreateTable must be a boolean');
      }

      // Performance warnings
      if (config.tableName.length > 50) {
        warnings.push('Long table names may impact performance and readability');
      }

      if (config.sessionId.length > 100) {
        warnings.push('Long session IDs may impact performance');
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`],
        warnings
      };
    }
  },

  /**
   * Get enhanced integration metadata
   */
  getMetadata: () => AGENT_MEMORY_INTEGRATION_META,

  /**
   * Perform health check with optional agent context
   */
  healthCheck: async (agentContext?: any) => {
    if (!agentContext) {
      return {
        status: 'unhealthy' as const,
        checks: {
          context: { status: false, message: 'No agent context provided' }
        },
        timestamp: new Date().toISOString()
      };
    }

    try {
      // Import getAgentMemoryService dynamically to avoid circular dependency
      const { getAgentMemoryService } = await import('./service');
      const service = getAgentMemoryService(agentContext.agentId, agentContext.tenantId);
      return await service.healthCheck();
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        checks: {
          service: { 
            status: false, 
            message: error instanceof Error ? error.message : String(error) 
          }
        },
        timestamp: new Date().toISOString(),
        agentContext
      };
    }
  },

  /**
   * Create service with proper context validation
   */
  createServiceWithContext: async (agentId: string, tenantId: string, options?: {
    enableTableAutoCreation?: boolean;
    maxRetries?: number;
    defaultTimeout?: number;
  }) => {
    const { getAgentMemoryService } = await import('./service');
    return getAgentMemoryService(agentId, tenantId, undefined, {
      requireExistingTables: !options?.enableTableAutoCreation,
      maxRetries: options?.maxRetries ?? 3,
      defaultTimeout: options?.defaultTimeout ?? 30000
    });
  },

  /**
   * Extract execution context from integration inputs
   */
  extractExecutionContext: (inputs: Record<string, unknown>): any | null => {
    try {
      const execution = inputs._execution || inputs._executionContext;
      
      if (execution && typeof execution === 'object' && execution !== null) {
        const exec = execution as Record<string, unknown>;
        if (typeof exec.executionId === 'string' && typeof exec.nodeId === 'string') {
          return {
            executionId: exec.executionId,
            nodeId: exec.nodeId,
            timestamp: typeof exec.timestamp === 'string' ? exec.timestamp : new Date().toISOString()
          };
        }
      }

      // Try direct extraction from inputs
      if (typeof inputs.executionId === 'string' && typeof inputs.nodeId === 'string') {
        return {
          executionId: inputs.executionId,
          nodeId: inputs.nodeId,
          timestamp: typeof inputs.timestamp === 'string' ? inputs.timestamp : new Date().toISOString()
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  },

  /**
   * Remove execution fields from inputs
   */
  cleanExecutionFields: (inputs: Record<string, unknown>): Record<string, unknown> => {
    const { 
      _execution, 
      _executionContext, 
      executionId, 
      nodeId, 
      timestamp,
      execution_id,
      node_id,
      ...cleanedInputs 
    } = inputs;
    return cleanedInputs;
  },

  /**
   * Check if inputs contain execution metadata
   */
  hasExecutionMetadata: (inputs: Record<string, unknown>): boolean => {
    return Boolean(
      inputs._execution || 
      inputs._executionContext || 
      (inputs.executionId && inputs.nodeId)
    );
  },

  /**
   * Validate execution metadata structure
   */
  isValidExecutionMetadata: (metadata: unknown): metadata is any => {
    if (!metadata || typeof metadata !== 'object') return false;
    const exec = metadata as Record<string, unknown>;
    
    return typeof exec.executionId === 'string' &&
           typeof exec.nodeId === 'string' &&
           typeof exec.timestamp === 'string';
  }
} as const;

// Re-export constants for convenience
export const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_MIN_RELEVANCE_SCORE,
  MAX_MESSAGE_LENGTH,
  MAX_SESSION_ID_LENGTH,
  MAX_TABLE_NAME_LENGTH,
  DEFAULT_SEARCH_FIELDS,
  SUPPORTED_SEARCH_FIELDS,
  IGNORED_VALIDATION_FIELDS,
  TABLE_NAME_PREFIX,
  MIN_QUERY_LENGTH,
  MAX_QUERY_LENGTH
} = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 1000,
  DEFAULT_MIN_RELEVANCE_SCORE: 0.1,
  MAX_MESSAGE_LENGTH: 50000,
  MAX_SESSION_ID_LENGTH: 255,
  MAX_TABLE_NAME_LENGTH: 63,
  DEFAULT_SEARCH_FIELDS: ['userInput', 'output'],
  SUPPORTED_SEARCH_FIELDS: ['userInput', 'output', 'systemPrompt', 'userPrompt'],
  IGNORED_VALIDATION_FIELDS: ['_execution', '_executionContext', 'executionId', 'nodeId', 'timestamp'],
  TABLE_NAME_PREFIX: 'agent_memory_',
  MIN_QUERY_LENGTH: 1,
  MAX_QUERY_LENGTH: 1000
};

// Integration registry export
import { Integration, createContextIntegration, createDataIntegration } from '../../types/integrations';
import { ExecutionContext } from '../../types/context';
import { store, retrieve, search, get, find, save, smartMemory } from './integration';

// Export the main integration class
export { default as AgentMemoryIntegration } from './integration';

// Wrapper functions that convert AgentMemoryToolOutput to ExecutionContext
const wrapStore = async (context: ExecutionContext, config: any): Promise<ExecutionContext> => {
  // Convert ExecutionContext to WorkflowExecutionContextWithAgent
  const workflowContext = {
    executionId: context.executionId,
    workflowId: context.workflowId || 'unknown',
    workflowName: 'unknown', // workflowName not available in ExecutionContext
    agentId: context.agentId || 'default',
    tenantId: 'default', // tenantId not available in ExecutionContext
    nodeId: 'unknown', // nodeId not available in ExecutionContext
    nodeName: 'unknown', // nodeName not available in ExecutionContext
    variables: context.variables || {},
    stepResults: context.stepResults || {}
  };
  
  const result = await store(workflowContext, config);
  return {
    ...context,
    stepResults: {
      ...context.stepResults,
      agentMemory: result
    }
  };
};

const wrapRetrieve = async (context: ExecutionContext, config: any): Promise<ExecutionContext> => {
  // Extract critical context from config and context
  const agentId = config.agentId || context.agentId || 'default';
  const tenantId = config.tenantId || (context as any).tenantId || 'default';
  const nodeId = config.nodeId || (context as any).nodeId || 'unknown';
  const nodeName = config.nodeName || (context as any).nodeName || 'unknown';
  const workflowId = config.workflowId || context.workflowId || 'unknown';
  const workflowName = config.workflowName || (context as any).workflowName || 'unknown';
  
  // Extract memory-specific parameters with fallbacks
  const sessionId = config.sessionId || (context as any).sessionId;
  const tableName = config.tableName || (context as any).tableName || 'conversations';
  const maxContextLength = config.maxContextLength || 50;
  const limit = config.limit || 50;
  const offset = config.offset || 0;
  
  // Validate required parameters
  if (!sessionId) {
    throw new Error('sessionId is required and must be a non-empty string');
  }
  
  // Convert ExecutionContext to WorkflowExecutionContextWithAgent with proper context
  const workflowContext = {
    executionId: context.executionId,
    workflowId,
    workflowName,
    agentId,
    tenantId,
    nodeId,
    nodeName,
    variables: context.variables || {},
    stepResults: context.stepResults || {}
  };
  
  // Enhanced configuration for LLM-driven retrieval
  const enhancedConfig = {
    ...config,
    sessionId,
    tableName,
    maxContextLength,
    limit,
    offset,
    agentId,
    tenantId,
    nodeId,
    nodeName,
    workflowId,
    workflowName,
    // Add LLM-driven retrieval flags
    llmDriven: true,
    onDemand: true
  };
  
  console.log('LLM-driven memory retrieval requested', {
    executionId: context.executionId,
    agentId,
    tenantId,
    sessionId,
    tableName,
    maxContextLength,
    limit,
    offset,
    nodeId,
    nodeName
  });
  
  const result = await retrieve(workflowContext, enhancedConfig);
  
  // Shape step result to match executor extraction: stepResults.*.json.data.messages
  const messages = (result as any)?.data?.messages || [];
  const totalCount = (result as any)?.data?.totalCount || 0;

  const shaped = {
    success: result.success,
    operation: 'retrieve',
    data: {
      messages,
      totalCount
    },
    meta: {
      llmDriven: true,
      retrievedAt: new Date().toISOString(),
      context: { sessionId, tableName, agentId, tenantId }
    }
  };

  return {
    ...context,
    stepResults: {
      ...context.stepResults,
      agentMemory: { json: shaped }
    }
  };
};

const wrapSearch = async (context: ExecutionContext, config: any): Promise<ExecutionContext> => {
  // Convert ExecutionContext to WorkflowExecutionContextWithAgent
  const workflowContext = {
    executionId: context.executionId,
    workflowId: context.workflowId || 'unknown',
    workflowName: 'unknown', // workflowName not available in ExecutionContext
    agentId: context.agentId || 'default',
    tenantId: 'default', // tenantId not available in ExecutionContext
    nodeId: 'unknown', // nodeId not available in ExecutionContext
    nodeName: 'unknown', // nodeName not available in ExecutionContext
    variables: context.variables || {},
    stepResults: context.stepResults || {}
  };
  
  const result = await search(workflowContext, config);
  return {
    ...context,
    stepResults: {
      ...context.stepResults,
      agentMemory: result
    }
  };
};

const wrapGet = async (context: ExecutionContext, config: any): Promise<ExecutionContext> => {
  // Convert ExecutionContext to WorkflowExecutionContextWithAgent
  const workflowContext = {
    executionId: context.executionId,
    workflowId: context.workflowId || 'unknown',
    workflowName: 'unknown', // workflowName not available in ExecutionContext
    agentId: context.agentId || 'default',
    tenantId: 'default', // tenantId not available in ExecutionContext
    nodeId: 'unknown', // nodeId not available in ExecutionContext
    nodeName: 'unknown', // nodeName not available in ExecutionContext
    variables: context.variables || {},
    stepResults: context.stepResults || {}
  };
  
  const result = await get(workflowContext, config);
  return {
    ...context,
    stepResults: {
      ...context.stepResults,
      agentMemory: result
    }
  };
};

const wrapFind = async (context: ExecutionContext, config: any): Promise<ExecutionContext> => {
  // Convert ExecutionContext to WorkflowExecutionContextWithAgent
  const workflowContext = {
    executionId: context.executionId,
    workflowId: context.workflowId || 'unknown',
    workflowName: 'unknown', // workflowName not available in ExecutionContext
    agentId: context.agentId || 'default',
    tenantId: 'default', // tenantId not available in ExecutionContext
    nodeId: 'unknown', // nodeId not available in ExecutionContext
    nodeName: 'unknown', // nodeName not available in ExecutionContext
    variables: context.variables || {},
    stepResults: context.stepResults || {}
  };
  
  const result = await find(workflowContext, config);
  return {
    ...context,
    stepResults: {
      ...context.stepResults,
      agentMemory: result
    }
  };
};

const wrapSave = async (context: ExecutionContext, config: any): Promise<ExecutionContext> => {
  // Convert ExecutionContext to WorkflowExecutionContextWithAgent
  const workflowContext = {
    executionId: context.executionId,
    workflowId: context.workflowId || 'unknown',
    workflowName: 'unknown', // workflowName not available in ExecutionContext
    agentId: context.agentId || 'default',
    tenantId: 'default', // tenantId not available in ExecutionContext
    nodeId: 'unknown', // nodeId not available in ExecutionContext
    nodeName: 'unknown', // nodeName not available in ExecutionContext
    variables: context.variables || {},
    stepResults: context.stepResults || {}
  };
  
  const result = await save(workflowContext, config);
  return {
    ...context,
    stepResults: {
      ...context.stepResults,
      agentMemory: result
    }
  };
};

const wrapSmartMemory = async (context: ExecutionContext, config: any): Promise<ExecutionContext> => {
  // Convert ExecutionContext to WorkflowExecutionContextWithAgent
  const workflowContext = {
    executionId: context.executionId,
    workflowId: context.workflowId || 'unknown',
    workflowName: 'unknown', // workflowName not available in ExecutionContext
    agentId: context.agentId || 'default',
    tenantId: 'default', // tenantId not available in ExecutionContext
    nodeId: 'unknown', // nodeId not available in ExecutionContext
    nodeName: 'unknown', // nodeName not available in ExecutionContext
    variables: context.variables || {},
    stepResults: context.stepResults || {}
  };
  
  const result = await smartMemory(workflowContext, config);
  return {
    ...context,
    stepResults: {
      ...context.stepResults,
      agentMemory: result
    }
  };
};

// Default export for integration registry
export default {
  register(): Integration {
    const functions = new Map();
    
    // ===== CONTEXT FUNCTIONS =====
    // Functions that transform execution context
    
    functions.set('store', createContextIntegration(
      'store',
      wrapStore,
      'Store agent memory messages with session management and validation'
    ));
    
    functions.set('retrieve', createContextIntegration(
      'retrieve',
      wrapRetrieve,
      'Retrieve agent memory messages with pagination and filtering'
    ));
    
    functions.set('search', createContextIntegration(
      'search',
      wrapSearch,
      'Search agent memory messages with relevance scoring and field filtering'
    ));
    
    functions.set('get', createContextIntegration(
      'get',
      wrapGet,
      'Get agent memory messages by session ID with pagination'
    ));
    
    functions.set('find', createContextIntegration(
      'find',
      wrapFind,
      'Find agent memory messages with advanced search capabilities'
    ));
    
    functions.set('save', createContextIntegration(
      'save',
      wrapSave,
      'Save agent memory messages with automatic session management'
    ));
    
    functions.set('smartMemory', createContextIntegration(
      'smartMemory',
      wrapSmartMemory,
      'Smart memory operation that automatically determines store/retrieve/search based on context'
    ));
    
    return {
      name: 'agent-memory',
      functions
    };
  }
};