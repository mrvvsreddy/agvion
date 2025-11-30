// Agent Memory Integration - Core Service
// Main service orchestrating all agent memory operations

import logger from '../../utils/logger';
import tableService, { 
  TableService, 
  UserCredentials, 
  TableNotFoundError,
  TableValidationError,
  RowOperationError,
  CredentialsError 
} from '../../database/services/TableService';
import type { AgentTable, AgentTableRow, AgentTableRowInsert } from '../../database/services/TableService';
import {
  AgentContext,
  AgentMemoryServiceConfig,
  StoreMessageRequest,
  StoreMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
  SearchMessagesRequest,
  SearchMessagesResponse,
  SessionStats,
  AgentMemoryError,
  SessionNotFoundError,
  InvalidMessageFormatError,
  TableOperationError,
  ValidationResult,
  AGENT_MEMORY_CONSTANTS,
  validateSessionId,
  validateTableName,
  buildSelectorKey
} from './types';
import { AgentMemoryValidator } from './validation';
import { AgentMemoryStore } from './store';
import { AgentMemoryRetrieve } from './retrieve';
import { AgentMemorySearch } from './search';

export class AgentMemoryService {
  private readonly tableService: TableService;
  private readonly credentials: UserCredentials;
  private readonly maxRetries: number;
  private readonly defaultTimeout: number;
  private readonly requireExistingTables: boolean;
  private readonly store: AgentMemoryStore;
  private readonly retrieve: AgentMemoryRetrieve;
  private readonly search: AgentMemorySearch;
  
  // Table caching for performance optimization
  private readonly tableCache: Map<string, { table: AgentTable; timestamp: number }> = new Map();
  private readonly cacheTimeout: number = 30000; // 30 seconds cache timeout
  
  // Connection health tracking
  private connectionHealthy: boolean = true;
  private lastHealthCheck: number = 0;
  private readonly healthCheckInterval: number = 60000; // 1 minute

  constructor(config: AgentMemoryServiceConfig) {
    // Validate required configuration
    if (!config) {
      throw new AgentMemoryError('INITIALIZATION_ERROR', 'AgentMemoryServiceConfig is required');
    }

    if (!config.context) {
      throw new AgentMemoryError('INITIALIZATION_ERROR', 'AgentContext is required');
    }

    const contextValidation = AgentMemoryValidator.validateAgentContext(config.context);
    if (!contextValidation.isValid) {
      throw new AgentMemoryError('INITIALIZATION_ERROR', 
        `Invalid agent context: ${contextValidation.errors.join(', ')}`);
    }

    // Initialize table service
    if (config.tableService) {
      this.tableService = config.tableService;
    } else if (tableService) {
      this.tableService = tableService;
    } else {
      throw new AgentMemoryError('INITIALIZATION_ERROR', 'TableService is required but not provided');
    }

    // Validate table service connection
    if (!this.tableService || typeof this.tableService.getAgentTable !== 'function') {
      throw new AgentMemoryError('INITIALIZATION_ERROR', 'TableService is not properly initialized');
    }

    // Set immutable credentials for TableService operations
    this.credentials = {
      agentId: config.context.agentId.trim(),
      tenantId: config.context.tenantId.trim()
    };

    // Set configuration options
    this.maxRetries = config.options?.maxRetries ?? 3;
    this.defaultTimeout = config.options?.defaultTimeout ?? 30000;
    this.requireExistingTables = config.options?.requireExistingTables ?? true;
    
    // Initialize operation handlers with cached table function
    const serviceOptions = {
      maxRetries: this.maxRetries,
      defaultTimeout: this.defaultTimeout,
      requireExistingTables: this.requireExistingTables,
      getCachedTable: this.getCachedTable.bind(this)
    };

    this.store = new AgentMemoryStore(this.tableService, this.credentials, serviceOptions);
    this.retrieve = new AgentMemoryRetrieve(this.tableService, this.credentials, serviceOptions);
    this.search = new AgentMemorySearch(this.tableService, this.credentials, serviceOptions);
    
    // Debug logging
    logger.info('AgentMemoryService configuration', {
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId,
      options: config.options,
      requireExistingTables: this.requireExistingTables
    });

    logger.info('AgentMemoryService initialized with credentials', {
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId,
      requireExistingTables: this.requireExistingTables
    });
  }

  /**
   * Store a message in the session memory with full agent/tenant validation
   */
  async storeMessage(
    tableName: string,
    request: StoreMessageRequest
  ): Promise<StoreMessageResponse> {
    return this.store.storeMessage(tableName, request);
  }

  /**
   * Get messages from session memory with agent/tenant validation
   */
  async getMessages(
    tableName: string,
    request: GetMessagesRequest
  ): Promise<GetMessagesResponse> {
    // Compute selectorKey if selector fields provided; pass via options where supported
    const extras: Record<string, string> = {};
    if ((request as any).userId) extras.userId = (request as any).userId;
    if ((request as any).channelId) extras.channelId = (request as any).channelId;
    if ((request as any).threadId) extras.threadId = (request as any).threadId;
    if ((request as any).phone) extras.phone = (request as any).phone;
    if ((request as any).email) extras.email = (request as any).email;
    const selectorKey = buildSelectorKey((request as any).selector as any, request.sessionId, extras);
    (request as any)._selectorKey = selectorKey;
    return this.retrieve.getMessages(tableName, request);
  }

  /**
   * Search messages in session memory using TableService search capabilities
   */
  async searchMessages(
    tableName: string,
    request: SearchMessagesRequest
  ): Promise<SearchMessagesResponse> {
    return this.search.searchMessages(tableName, request);
  }

  /**
   * Get session statistics with agent/tenant validation
   */
  async getSessionStats(tableName: string, sessionId: string): Promise<SessionStats | null> {
    return this.retrieve.getSessionStats(tableName, sessionId);
  }

  /**
   * Delete all messages for a session with agent/tenant validation
   */
  async clearSession(tableName: string, sessionId: string): Promise<boolean> {
    return this.retrieve.clearSession(tableName, sessionId);
  }

  /**
   * Get current agent context (immutable)
   */
  getContext(): Readonly<AgentContext> {
    return {
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId
    };
  }

  /**
   * Get cached table or fetch from database with caching and retry logic
   * This eliminates redundant table lookups across operations
   */
  async getCachedTable(tableName: string): Promise<{ table: AgentTable | null; found: boolean }> {
    const cacheKey = `${this.credentials.agentId}:${this.credentials.tenantId}:${tableName}`;
    const now = Date.now();
    
    // Check cache first
    const cached = this.tableCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      logger.debug('Using cached table reference', {
        tableName,
        tableId: cached.table.id,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        cacheAge: now - cached.timestamp
      });
      return { table: cached.table, found: true };
    }

    // Check connection health first
    const isHealthy = await this.checkConnectionHealth();
    if (!isHealthy) {
      logger.warn('Connection unhealthy, using cached table if available', {
        tableName,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId
      });
      
      // Return cached table even if expired when connection is unhealthy
      if (cached) {
        return { table: cached.table, found: true };
      }
    }

    // Cache miss or expired - fetch from database with retry logic
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.tableService.getAgentTable(this.credentials, tableName);
        
        if (result.found && result.table) {
          // Cache the table for future operations
          this.tableCache.set(cacheKey, { table: result.table, timestamp: now });
          
          logger.info('Table cached for performance optimization', {
            tableName,
            tableId: result.table.id,
            agentId: this.credentials.agentId,
            tenantId: this.credentials.tenantId,
            attempt
          });
        }
        
        return { table: result.table, found: result.found };
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Update connection health on error
        this.connectionHealthy = false;
        
        // Check if it's a network error that might be retryable
        const isRetryableError = this.isRetryableError(lastError);
        
        if (attempt < this.maxRetries && isRetryableError) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          logger.warn('Table lookup failed, retrying', {
            tableName,
            agentId: this.credentials.agentId,
            tenantId: this.credentials.tenantId,
            attempt,
            maxRetries: this.maxRetries,
            delay,
            error: lastError.message
          });
          
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Non-retryable error or max retries reached
        logger.error('Failed to get cached table after retries', {
          tableName,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId,
          attempt,
          maxRetries: this.maxRetries,
          error: lastError.message,
          isRetryableError
        });
        break;
      }
    }
    
    return { table: null, found: false };
  }

  /**
   * Check if an error is retryable (network issues, timeouts, etc.)
   */
  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /fetch failed/i,
      /network error/i,
      /timeout/i,
      /connection/i,
      /econnreset/i,
      /enotfound/i,
      /etimedout/i,
      /socket hang up/i
    ];
    
    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Invalidate table cache for a specific table
   */
  invalidateTableCache(tableName: string): void {
    const cacheKey = `${this.credentials.agentId}:${this.credentials.tenantId}:${tableName}`;
    this.tableCache.delete(cacheKey);
    
    logger.debug('Table cache invalidated', {
      tableName,
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId
    });
  }

  /**
   * Clear all cached tables
   */
  clearTableCache(): void {
    this.tableCache.clear();
    logger.debug('All table caches cleared', {
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId
    });
  }

  /**
   * Check connection health and perform maintenance
   */
  private async checkConnectionHealth(): Promise<boolean> {
    const now = Date.now();
    
    // Only check if enough time has passed since last check
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.connectionHealthy;
    }
    
    this.lastHealthCheck = now;
    
    try {
      // Perform a simple health check query - use a non-interfering approach
      // Just check if we can connect to the database without creating/accessing specific tables
      const testCredentials = { ...this.credentials, tableName: 'health_check' };
      await this.tableService.getAgentTable(testCredentials, 'health_check');
      this.connectionHealthy = true;
      
      logger.debug('Connection health check passed', {
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId
      });
      
    } catch (error) {
      this.connectionHealthy = false;
      
      logger.warn('Connection health check failed', {
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    return this.connectionHealthy;
  }

  /**
   * Get connection status
   */
  isConnectionHealthy(): boolean {
    return this.connectionHealthy;
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{
    readonly status: 'healthy' | 'degraded' | 'unhealthy';
    readonly checks: Record<string, { status: boolean; message: string; duration?: number }>;
    readonly timestamp: string;
    readonly agentContext: AgentContext;
  }> {
    const startTime = Date.now();
    const checks: Record<string, { status: boolean; message: string; duration?: number }> = {};

    try {
      // Check service availability
      const serviceStart = Date.now();
      checks.service = {
        status: true,
        message: `Service available for agent ${this.credentials.agentId}`,
        duration: Date.now() - serviceStart
      };

      // Check table service connection
      const tableServiceStart = Date.now();
      try {
        // Try a simple operation to verify connection
        await this.tableService.getAgentTable(this.credentials, 'test_table');
        checks.tableService = {
          status: true,
          message: 'Table service connection healthy',
          duration: Date.now() - tableServiceStart
        };
      } catch (error) {
        checks.tableService = {
          status: false,
          message: `Table service connection failed: ${error instanceof Error ? error.message : String(error)}`,
          duration: Date.now() - tableServiceStart
        };
      }

      // Check validation functions
      const validationStart = Date.now();
      const testValidation = validateTableName('test_table');
      checks.validation = {
        status: testValidation.isValid,
        message: testValidation.isValid ? 'Validation functions working' : 'Validation functions failed',
        duration: Date.now() - validationStart
      };

      // Check constants availability
      const constantsStart = Date.now();
      checks.constants = {
        status: !!AGENT_MEMORY_CONSTANTS.MAX_LIMIT,
        message: AGENT_MEMORY_CONSTANTS.MAX_LIMIT ? 'Constants loaded' : 'Constants missing',
        duration: Date.now() - constantsStart
      };

      // Check context validation
      const contextStart = Date.now();
      const contextValidation = AgentMemoryValidator.validateAgentContext(this.getContext());
      checks.agentContext = {
        status: contextValidation.isValid,
        message: contextValidation.isValid ? 
          `Agent context valid (${this.credentials.agentId}/${this.credentials.tenantId})` : 
          `Agent context invalid: ${contextValidation.errors.join(', ')}`,
        duration: Date.now() - contextStart
      };

      const allHealthy = Object.values(checks).every(check => check.status);
      const hasWarnings = Object.values(checks).some(check => !check.status);
      const status = allHealthy ? 'healthy' : (hasWarnings ? 'degraded' : 'unhealthy');

      return {
        status,
        checks,
        timestamp: new Date().toISOString(),
        agentContext: this.getContext()
      };

    } catch (error) {
      checks.error = {
        status: false,
        message: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      };

      return {
        status: 'unhealthy',
        checks,
        timestamp: new Date().toISOString(),
        agentContext: this.getContext()
      };
    }
  }
}

// Enhanced factory functions with proper agent/tenant context
let agentMemoryServiceInstances: Map<string, AgentMemoryService> = new Map();

export function createAgentMemoryService(
  agentId: string, 
  tenantId: string,
  tableService?: TableService,
  options?: AgentMemoryServiceConfig['options']
): AgentMemoryService {
  const context: AgentContext = { agentId, tenantId };
  const config: AgentMemoryServiceConfig = {
    tableService,
    context,
    options
  };
  return new AgentMemoryService(config);
}

export function getAgentMemoryService(
  agentId: string, 
  tenantId: string,
  tableService?: TableService,
  options?: AgentMemoryServiceConfig['options']
): AgentMemoryService {
  const instanceKey = `${tenantId}:${agentId}`;
  
  logger.info('getAgentMemoryService called', {
    agentId,
    tenantId,
    instanceKey,
    hasExistingInstance: agentMemoryServiceInstances.has(instanceKey),
    options
  });
  
  if (!agentMemoryServiceInstances.has(instanceKey)) {
    logger.info('Creating new AgentMemoryService instance', {
      agentId,
      tenantId,
      options
    });
    const service = createAgentMemoryService(agentId, tenantId, tableService, options);
    agentMemoryServiceInstances.set(instanceKey, service);
  } else {
    logger.info('Using existing AgentMemoryService instance', {
      agentId,
      tenantId,
      instanceKey
    });
  }
  
  return agentMemoryServiceInstances.get(instanceKey)!;
}

// Cleanup function for service instances
export function clearAgentMemoryServiceCache(agentId?: string, tenantId?: string): void {
  if (agentId && tenantId) {
    const instanceKey = `${tenantId}:${agentId}`;
    agentMemoryServiceInstances.delete(instanceKey);
  } else {
    agentMemoryServiceInstances.clear();
  }
}

// Export enhanced service with proper type safety
export default {
  createAgentMemoryService,
  getAgentMemoryService,
  clearAgentMemoryServiceCache
};

