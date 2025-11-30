// Agent Memory Integration - Store Operations
// Clean message storage operations with agent/tenant context

import logger from '../../utils/logger';
import tableService, { 
  TableService, 
  UserCredentials, 
  TableNotFoundError,
  TableValidationError,
  RowOperationError,
  CredentialsError,
  SecureCredentials,
  SecureQueryRequest,
  SecureQueryFilter
} from '../../database/services/TableService';
import type { AgentTable, AgentTableRow, AgentTableRowInsert } from '../../database/services/TableService';
import * as crypto from 'crypto';
import {
  AgentContext,
  StoreMessageRequest,
  StoreMessageResponse,
  AgentMemoryRowData,
  AgentMemoryRow,
  AgentMemoryError,
  SessionNotFoundError,
  InvalidMessageFormatError,
  TableOperationError,
  ValidationResult,
  AGENT_MEMORY_CONSTANTS,
  isStoreMessageRequest,
  isAgentMemoryRowData,
  validateSessionId,
  validateTableName
} from './types';
import { AgentMemoryValidator } from './validation';
import { CredentialManager, DataIntegrityValidator } from './retrieve';

// Table resolution result
interface TableResolutionResult {
  readonly table: AgentTable | null;
  readonly found: boolean;
  readonly accessDeniedReason?: 'not_found' | 'access_denied' | 'tenant_mismatch' | 'agent_mismatch';
}

// Secure memory interfaces
export interface SecureMemoryRequest {
  readonly operation: 'retrieve' | 'store' | 'search' | 'clear' | 'stats';
  readonly sessionId?: string;
  readonly tableName: string;
  readonly credentials: SecureCredentials;
  readonly context?: {
    readonly maxMessages?: number;
    readonly beforeMessageId?: number;
    readonly afterMessageId?: number;
    readonly includeSystemPrompts?: boolean;
    readonly onlyUserInteractions?: boolean;
  };
  readonly searchOptions?: {
    readonly query: string;
    readonly fields: readonly string[];
    readonly fuzzy?: boolean;
  };
  readonly data?: any;
  readonly securityOptions?: {
    readonly requireHighSecurity?: boolean;
    readonly auditLevel?: 'basic' | 'detailed' | 'full';
    readonly validateDataIntegrity?: boolean;
  };
}

export interface SecureMemoryResponse {
  readonly success: boolean;
  readonly data: any;
  readonly security: {
    readonly validated: boolean;
    readonly securityLevel: string;
    readonly auditTrail: string;
    readonly credentialStatus: string;
  };
  readonly performance: {
    readonly executionTimeMs: number;
    readonly recordsProcessed: number;
    readonly strategy: string;
  };
  readonly error?: string;
  readonly warnings?: readonly string[];
}

// Validation context for enhanced security
interface ValidationContext {
  readonly agentId: string;
  readonly tenantId: string;
  readonly operation: string;
  readonly tableName: string;
}

/**
 * Secure AgentMemory Store service with comprehensive credential validation
 */
export class SecureAgentMemoryStore {
  private readonly tableService: TableService;
  private readonly defaultCredentials: SecureCredentials;
  
  constructor(
    tableService: TableService,
    baseCredentials: { agentId: string; tenantId: string },
    options: { enableSessionTokens?: boolean } = {}
  ) {
    this.tableService = tableService;
    this.defaultCredentials = CredentialManager.enhanceCredentials(
      baseCredentials,
      { generateToken: options.enableSessionTokens ?? false }
    );

    logger.info('SecureAgentMemoryStore initialized', {
      agentId: this.defaultCredentials.agentId,
      tenantId: this.defaultCredentials.tenantId,
      hasSessionToken: !!(this.defaultCredentials as any).sessionToken,
      requestId: this.defaultCredentials.requestId
    });
  }

  /**
   * Store conversation turn with enhanced security
   */
  async storeSecureConversationTurn(
    sessionId: string,
    tableName: string,
    conversationData: {
      userInput: string;
      agentOutput: string;
      systemPrompt?: string;
      metadata?: any;
    },
    credentials?: SecureCredentials
  ): Promise<{
    success: boolean;
    messageId: number;
    stored: boolean;
    security: {
      validated: boolean;
      integrityVerified: boolean;
      auditTrail: string;
    };
    warnings?: string[];
  }> {
    const operationCredentials = credentials || this.defaultCredentials;

    // Validate input data integrity first
    const integrityCheck = DataIntegrityValidator.validateMessageIntegrity({
      sessionId,
      userInput: conversationData.userInput,
      output: conversationData.agentOutput,
      systemPrompt: conversationData.systemPrompt
    });

    if (!integrityCheck.isValid) {
      logger.warn('Data integrity validation failed for store operation', {
        sessionId,
        agentId: operationCredentials.agentId,
        errors: integrityCheck.errors
      });
      return {
        success: false,
        messageId: 0,
        stored: false,
        security: {
          validated: false,
          integrityVerified: false,
          auditTrail: 'integrity-validation-failed'
        },
        warnings: integrityCheck.errors
      };
    }

    // Get next message ID securely
    const existingMessages = await this.executeSecureMemoryOperation({
      operation: 'retrieve',
      sessionId,
      tableName,
      credentials: operationCredentials,
      context: { maxMessages: 1 }
    });

    const nextMessageId = existingMessages.success && existingMessages.data.messages?.length > 0
      ? Math.max(...existingMessages.data.messages.map((m: any) => m.messageId || 0)) + 1
      : 1;

    const storeData = {
      sessionId,
      messageId: nextMessageId,
      userInput: conversationData.userInput,
      output: conversationData.agentOutput,
      systemPrompt: conversationData.systemPrompt || '',
      userPrompt: '', // Legacy field
      timestamp: Date.now(),
      agentId: operationCredentials.agentId,
      tenantId: operationCredentials.tenantId,
      ...conversationData.metadata
    };

    const storeRequest: SecureMemoryRequest = {
      operation: 'store',
      sessionId,
      tableName,
      credentials: operationCredentials,
      data: storeData,
      securityOptions: {
        validateDataIntegrity: true,
        auditLevel: 'detailed'
      }
    };

    const response = await this.executeSecureMemoryOperation(storeRequest);

    return {
      success: response.success,
      messageId: nextMessageId,
      stored: response.success,
      security: {
        validated: response.security.validated,
        integrityVerified: integrityCheck.isValid,
        auditTrail: response.security.auditTrail
      },
      warnings: [...(integrityCheck.warnings || []), ...(response.warnings || [])]
    };
  }

  /**
   * Execute secure memory operation with comprehensive validation
   */
  async executeSecureMemoryOperation(request: SecureMemoryRequest): Promise<SecureMemoryResponse> {
    const startTime = Date.now();
    const operationId = crypto.randomBytes(8).toString('hex');

    try {
      logger.info('SecureAgentMemoryStore: starting secure operation', {
        operationId,
        operation: request.operation,
        sessionId: request.sessionId,
        tableName: request.tableName,
        agentId: request.credentials.agentId,
        securityLevel: request.securityOptions?.auditLevel || 'basic'
      });

      // Step 1: Validate and enhance credentials
      const validatedCredentials = await this.validateCredentials(request.credentials, request.operation);
      if (!validatedCredentials.isValid) {
        return this.createSecurityErrorResponse(
          request.operation,
          startTime,
          'Credential validation failed',
          validatedCredentials.errors
        );
      }

      // Step 2: Execute operation based on type
      let operationResult: any;
      switch (request.operation) {
        case 'store':
          operationResult = await this.handleSecureStore(request, validatedCredentials.credentials, operationId);
          break;
        case 'retrieve':
          operationResult = await this.handleSecureRetrieve(request, validatedCredentials.credentials, operationId);
          break;
        case 'search':
          operationResult = await this.handleSecureSearch(request, validatedCredentials.credentials, operationId);
          break;
        case 'clear':
          operationResult = await this.handleSecureClear(request, validatedCredentials.credentials, operationId);
          break;
        case 'stats':
          operationResult = await this.handleSecureStats(request, validatedCredentials.credentials, operationId);
          break;
        default:
          throw new Error(`Unsupported operation: ${request.operation}`);
      }

      const executionTimeMs = Date.now() - startTime;

      logger.info('SecureAgentMemoryStore: operation completed successfully', {
        operationId,
        operation: request.operation,
        executionTimeMs,
        recordsProcessed: operationResult.recordsProcessed || 0,
        agentId: request.credentials.agentId
      });

      return {
        success: true,
        data: operationResult.data,
        security: {
          validated: true,
          securityLevel: validatedCredentials.securityLevel,
          auditTrail: operationId,
          credentialStatus: 'verified'
        },
        performance: {
          executionTimeMs,
          recordsProcessed: operationResult.recordsProcessed || 0,
          strategy: operationResult.strategy || 'database_secure'
        },
        warnings: operationResult.warnings
      };

    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      
      logger.error('SecureAgentMemoryStore: operation failed', {
        operationId,
        operation: request.operation,
        error: error instanceof Error ? error.message : String(error),
        executionTimeMs,
        agentId: request.credentials.agentId
      });

      return {
        success: false,
        data: null,
        security: {
          validated: false,
          securityLevel: 'unknown',
          auditTrail: operationId,
          credentialStatus: 'error'
        },
        performance: {
          executionTimeMs,
          recordsProcessed: 0,
          strategy: 'failed'
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Private operation handlers with enhanced security
   */
  private async validateCredentials(
    credentials: SecureCredentials,
    operation: string
  ): Promise<{
    isValid: boolean;
    credentials: SecureCredentials;
    securityLevel: string;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Basic credential format validation
    if (!credentials.agentId || !credentials.tenantId) {
      errors.push('Missing required credentials');
    }

    // Validate session token if present
    if ((credentials as any).sessionToken) {
      const tokenValid = CredentialManager.validateSessionToken(
        (credentials as any).sessionToken,
        credentials.agentId,
        credentials.tenantId
      );
      
      if (!tokenValid) {
        errors.push('Invalid or expired session token');
      }
    }

    // Validate against default credentials to prevent credential switching
    if (credentials.agentId !== this.defaultCredentials.agentId ||
        credentials.tenantId !== this.defaultCredentials.tenantId) {
      errors.push('Credential mismatch with initialized agent');
    }

    const securityLevel = (credentials as any).sessionToken ? 'high' : 'medium';

    return {
      isValid: errors.length === 0,
      credentials,
      securityLevel,
      errors
    };
  }

  private async handleSecureStore(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    if (!request.data) {
      throw new Error('Data is required for store operation');
    }

    // Use the existing AgentMemoryStore for actual data storage
    const storeService = new AgentMemoryStore(this.tableService, {
      agentId: credentials.agentId,
      tenantId: credentials.tenantId
    });

    const storeRequest: StoreMessageRequest = {
      sessionId: request.data.sessionId,
      userInput: request.data.userInput,
      output: request.data.output,
      systemPrompt: request.data.systemPrompt,
      userPrompt: request.data.userPrompt || ''
    };

    const result = await storeService.storeMessage(request.tableName, storeRequest);

    logger.info('Secure store operation completed', {
      operationId,
      sessionId: request.data.sessionId,
      messageId: result.messageId,
      agentId: credentials.agentId
    });

    return {
      data: {
        stored: true,
        rowId: result.message.id,
        sessionId: request.data.sessionId,
        messageId: result.messageId,
        sessionMessageCount: result.sessionMessageCount
      },
      recordsProcessed: 1,
      strategy: 'database_secure'
    };
  }

  private async handleSecureRetrieve(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    // Placeholder for secure retrieve operation
    return {
      data: {
        messages: [],
        totalCount: 0,
        hasMore: false
      },
      recordsProcessed: 0,
      strategy: 'database_secure'
    };
  }

  private async handleSecureSearch(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    // Placeholder for secure search operation
    return {
      data: {
        results: [],
        totalMatches: 0,
        searchQuery: request.searchOptions?.query || '',
        searchFields: request.searchOptions?.fields || []
      },
      recordsProcessed: 0,
      strategy: 'database_secure'
    };
  }

  private async handleSecureClear(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    // Placeholder for secure clear operation
    return {
      data: {
        cleared: true,
        sessionId: request.sessionId,
        messagesRemoved: 0
      },
      recordsProcessed: 0,
      strategy: 'database_secure'
    };
  }

  private async handleSecureStats(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    // Placeholder for secure stats operation
    return {
      data: {
        totalMessages: 0,
        uniqueSessions: 0,
        tableName: request.tableName,
        agentId: credentials.agentId
      },
      recordsProcessed: 0,
      strategy: 'database_secure'
    };
  }

  private createSecurityErrorResponse(
    operation: string,
    startTime: number,
    message: string,
    errors: string[]
  ): SecureMemoryResponse {
    return {
      success: false,
      data: null,
      security: {
        validated: false,
        securityLevel: 'denied',
        auditTrail: crypto.randomBytes(8).toString('hex'),
        credentialStatus: 'invalid'
      },
      performance: {
        executionTimeMs: Date.now() - startTime,
        recordsProcessed: 0,
        strategy: 'security_check_failed'
      },
      error: `${message}: ${errors.join(', ')}`
    };
  }
}

export class AgentMemoryStore {
  private readonly tableService: TableService;
  private readonly credentials: UserCredentials;
  private readonly maxRetries: number;
  private readonly defaultTimeout: number;
  private readonly requireExistingTables: boolean;
  private readonly getCachedTable: ((tableName: string) => Promise<{ table: AgentTable | null; found: boolean }>) | undefined;

  constructor(
    tableService: TableService,
    credentials: UserCredentials,
    options: {
      maxRetries?: number;
      defaultTimeout?: number;
      requireExistingTables?: boolean;
      getCachedTable?: (tableName: string) => Promise<{ table: AgentTable | null; found: boolean }>;
    } = {}
  ) {
    this.tableService = tableService;
    this.credentials = credentials;
    this.maxRetries = options.maxRetries ?? 3;
    this.defaultTimeout = options.defaultTimeout ?? 30000;
    this.requireExistingTables = options.requireExistingTables ?? true;
    this.getCachedTable = options.getCachedTable;
  }

  /**
   * Store a message in the session memory with full agent/tenant validation
   */
  async storeMessage(
    tableName: string,
    request: StoreMessageRequest
  ): Promise<StoreMessageResponse> {
    // Validate credentials are present (TableService requirement)
    if (!this.credentials.agentId || !this.credentials.tenantId) {
      throw new CredentialsError('Missing required credentials for memory operation');
    }

    const validationContext: ValidationContext = {
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId,
      operation: 'store',
      tableName
    };

    try {
      // Validate inputs with context
      const validation = this.validateStoreMessageRequest(request, validationContext);
      if (!validation.isValid) {
        throw new InvalidMessageFormatError(validation.errors.join(', '));
      }

      const tableValidation = validateTableName(tableName);
      if (!tableValidation.isValid) {
        throw new InvalidMessageFormatError(`Table name invalid: ${tableValidation.errors.join(', ')}`);
      }

      // Resolve table with agent/tenant context - create if not found
      let tableResult = await this.resolveTableWithCredentials(tableName);
      
      if (!tableResult.found || !tableResult.table) {
        // Try to create table if it doesn't exist
        if (this.requireExistingTables) {
          throw new SessionNotFoundError(request.sessionId);
        }
        
        // Create table for this agent
        const newTable = await this.createAgentMemoryTable(tableName);
        if (!newTable) {
          throw new SessionNotFoundError(request.sessionId);
        }
        // Create a new table result with the newly created table
        tableResult = this.createTableResolutionResult(newTable, true);
      }

      const table = tableResult.table!; // We know it's not null because we checked above
      
      // Optimized: Get both next message ID and current count in a single query
      const { nextMessageId, currentCount } = await this.getNextMessageIdAndCount(tableName, request.sessionId);
      const timestamp = new Date().toISOString();
      
      // Create row data with proper structure
      const rowData: AgentMemoryRowData = {
        sessionId: request.sessionId,
        messageId: nextMessageId,
        systemPrompt: request.systemPrompt ?? '',
        userPrompt: request.userPrompt ?? '',
        userInput: request.userInput,
        output: request.output,
        timestamp
      };

      // Create insert request using TableService credentials-based API
      const insertRequest: AgentTableRowInsert = {
        agent_id: this.credentials.agentId,
        table_id: table.id,
        row_data: rowData
      };

      // Use cached table reference to avoid redundant lookup in insertRowByCredentials
      const insertedRow = await this.insertRowWithCachedTable(
        tableName,
        insertRequest,
        table
      );

      if (!insertedRow) {
        throw new TableOperationError('insert', 'No row returned from insert operation');
      }

      // Convert to memory row format
      const memoryRow = this.convertDbRowToMemoryRow(insertedRow);
      const sessionMessage = this.convertRowToMessage(memoryRow);
      
      // Use the count we already retrieved (optimized)
      const sessionMessageCount = currentCount + 1;

      logger.info('Message stored in agent memory with credentials', {
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        tableId: table.id,
        sessionId: request.sessionId,
        messageId: nextMessageId,
        sessionMessageCount
      });

      return {
        message: sessionMessage,
        messageId: nextMessageId,
        sessionMessageCount
      };

    } catch (error) {
      logger.error('Failed to store message in agent memory', {
        error: error instanceof Error ? error.message : String(error),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        sessionId: request.sessionId
      });
      
      if (error instanceof AgentMemoryError || error instanceof TableNotFoundError) {
        throw error;
      }
      
      throw new TableOperationError('store_message', 
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Create agent memory table if it doesn't exist
   */
  private async createAgentMemoryTable(tableName: string): Promise<AgentTable | null> {
    try {
      logger.info('Creating agent memory table', {
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName
      });

      const tableData = {
        agent_id: this.credentials.agentId,
        table_name: tableName,
        description: `Agent memory table for ${this.credentials.agentId}`,
        columns: {
          sessionId: 'string',
          messageId: 'number',
          systemPrompt: 'string',
          userPrompt: 'string',
          userInput: 'string',
          output: 'string',
          timestamp: 'string',
          metadata: 'object'
        },
        metadata: {
          created_by: 'agent_memory_service',
          created_at: new Date().toISOString(),
          tenant_id: this.credentials.tenantId
        }
      };

      const newTable = await this.tableService.create({
        agent_id: this.credentials.agentId,
        tenant_id: this.credentials.tenantId,
        table_name: tableName,
        description: `Agent memory table for ${this.credentials.agentId}`,
        columns: {
          sessionId: 'string',
          messageId: 'number',
          systemPrompt: 'string',
          userPrompt: 'string',
          userInput: 'string',
          output: 'string',
          timestamp: 'string',
          metadata: 'object'
        },
        metadata: {
          created_by: 'agent_memory_service',
          created_at: new Date().toISOString(),
          tenant_id: this.credentials.tenantId
        }
      } as any);
      
      logger.info('Agent memory table created successfully', {
        tableId: newTable.id,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName
      });

      return newTable;
    } catch (error) {
      logger.error('Failed to create agent memory table', {
        error: error instanceof Error ? error.message : String(error),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName
      });
      return null;
    }
  }

  /**
   * Private helper methods
   */
  private async resolveTableWithCredentials(tableName: string): Promise<TableResolutionResult> {
    try {
      // Use cached table if available, otherwise fall back to direct lookup
      let tableSearchResult;
      if (this.getCachedTable) {
        const cachedResult = await this.getCachedTable(tableName);
        tableSearchResult = {
          table: cachedResult.table,
          found: cachedResult.found
        };
      } else {
        const directResult = await this.tableService.getAgentTable(this.credentials, tableName);
        tableSearchResult = directResult;
      }
      
      if (tableSearchResult.found && tableSearchResult.table) {
        return this.createTableResolutionResult(tableSearchResult.table, true);
      } else {
        return this.createTableResolutionResult(null, false, 'not_found');
      }

    } catch (error) {
      logger.error('Failed to resolve table with credentials', { 
        tableName,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      if (error instanceof TableNotFoundError) {
        return this.createTableResolutionResult(null, false, 'not_found');
      }
      
      return this.createTableResolutionResult(null, false, 'access_denied');
    }
  }

  private createTableResolutionResult(
    table: AgentTable | null,
    found: boolean,
    accessDeniedReason?: 'not_found' | 'access_denied' | 'tenant_mismatch' | 'agent_mismatch'
  ): TableResolutionResult {
    const result: TableResolutionResult = {
      table,
      found
    };
    
    if (accessDeniedReason) {
      (result as any).accessDeniedReason = accessDeniedReason;
    }
    
    return result;
  }

  /**
   * Optimized method: Get both next message ID and current count in a single query
   * This eliminates redundant table lookups and database calls
   */
  private async getNextMessageIdAndCount(tableName: string, sessionId: string): Promise<{ nextMessageId: number; currentCount: number }> {
    try {
      // Validate inputs
      if (!tableName || tableName.trim() === '') {
        logger.error('Cannot get next message ID and count: tableName is empty', {
          tableName,
          sessionId,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId
        });
        return { nextMessageId: 1, currentCount: 0 };
      }

      // Single optimized query to get all session messages
      const searchCriteria = {
        fieldFilters: {
          'sessionId': sessionId.trim()
        },
        sortBy: {
          field: 'created_at',
          direction: 'desc' as const
        },
        limit: AGENT_MEMORY_CONSTANTS.MAX_LIMIT // Get all to count and find max messageId
      };

      const searchResults = await this.tableService.advancedSearchRows(
        this.credentials,
        tableName.trim(),
        searchCriteria
      );

      // Filter and process valid memory rows for this session
      const validSessionRows = searchResults.data
        .filter(row => this.isValidMemoryRow(row) && 
          (row.row_data as AgentMemoryRowData).sessionId === sessionId.trim())
        .map(row => this.convertDbRowToMemoryRow(row));

      const currentCount = validSessionRows.length;

      if (validSessionRows.length === 0) {
        return { nextMessageId: 1, currentCount: 0 }; // First message
      }

      // Find the highest messageId
      const maxMessageId = Math.max(...validSessionRows.map(row => row.data.messageId));
      const nextMessageId = maxMessageId + 1;

      logger.debug('Optimized message ID and count retrieval', {
        tableName: tableName.trim(),
        sessionId: sessionId.trim(),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        currentCount,
        nextMessageId,
        maxMessageId
      });

      return { nextMessageId, currentCount };

    } catch (error) {
      logger.error('Failed to get next message ID and count', { 
        tableName,
        sessionId,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { nextMessageId: 1, currentCount: 0 }; // Fallback
    }
  }

  private async getNextMessageId(tableName: string, sessionId: string): Promise<number> {
    try {
      // Validate inputs
      if (!tableName || tableName.trim() === '') {
        logger.error('Cannot get next message ID: tableName is empty', {
          tableName,
          sessionId,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId
        });
        return 1;
      }

      const sessionRows = await this.getSessionRowsWithCredentials(
        tableName.trim(),
        sessionId,
        {
          limit: 1,
          offset: 0,
          orderDirection: 'desc'
        }
      );

      if (sessionRows.length === 0) {
        return 1; // First message
      }

      const lastRow = sessionRows[0];
      if (!lastRow) {
        return 1;
      }

      const lastMessage = this.convertRowToMessage(lastRow);
      return lastMessage.messageId + 1;

    } catch (error) {
      logger.error('Failed to get next message ID', { 
        tableName,
        sessionId,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 1; // Fallback to first message
    }
  }

  private async getSessionMessageCount(tableName: string, sessionId: string): Promise<number> {
    try {
      // Validate inputs first
      if (!tableName || tableName.trim() === '') {
        logger.error('Cannot get session message count: tableName is empty', {
          tableName,
          sessionId,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId
        });
        return 0;
      }

      if (!sessionId || sessionId.trim() === '') {
        logger.error('Cannot get session message count: sessionId is empty', {
          tableName,
          sessionId,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId
        });
        return 0;
      }

      // Use search functionality to count session-specific messages
      const searchCriteria = {
        fieldFilters: {
          'sessionId': sessionId.trim()
        },
        limit: AGENT_MEMORY_CONSTANTS.MAX_LIMIT // Get all to count them
      };

      const searchResults = await this.tableService.advancedSearchRows(
        this.credentials,
        tableName.trim(),
        searchCriteria
      );

      // Filter and count valid memory rows for this session
      const validSessionRows = searchResults.data.filter(row => 
        this.isValidMemoryRow(row) && 
        (row.row_data as AgentMemoryRowData).sessionId === sessionId.trim()
      );

      logger.debug('Session message count retrieved', {
        tableName: tableName.trim(),
        sessionId: sessionId.trim(),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        count: validSessionRows.length,
        totalSearchResults: searchResults.data.length
      });

      return validSessionRows.length;

    } catch (error) {
      logger.error('Failed to get session message count', { 
        tableName,
        sessionId,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  private async getSessionRowsWithCredentials(
    tableName: string,
    sessionId: string,
    options: {
      limit: number;
      offset: number;
      orderDirection: 'asc' | 'desc';
    }
  ): Promise<AgentMemoryRow[]> {
    try {
      // Use TableService search capabilities to get session-specific rows
      const searchCriteria = {
        fieldFilters: {
          'sessionId': sessionId
        },
        sortBy: {
          field: 'created_at',
          direction: options.orderDirection
        },
        limit: Math.min(options.limit, AGENT_MEMORY_CONSTANTS.MAX_LIMIT)
      };

      const paginationOptions = {
        page: Math.floor(options.offset / options.limit) + 1,
        limit: options.limit,
        orderDirection: options.orderDirection
      };

      const searchResults = await this.tableService.advancedSearchRows(
        this.credentials,
        tableName,
        searchCriteria,
        paginationOptions
      );

      // Convert and validate rows
      const memoryRows = searchResults.data
        .filter(row => this.isValidMemoryRow(row))
        .map(row => this.convertDbRowToMemoryRow(row))
        .sort((a, b) => {
          const aMessageId = a.data.messageId;
          const bMessageId = b.data.messageId;
          return options.orderDirection === 'desc' ? 
            bMessageId - aMessageId : aMessageId - bMessageId;
        });

      return memoryRows;

    } catch (error) {
      logger.error('Failed to get session rows with credentials', { 
        tableName, 
        sessionId, 
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error 
      });
      return [];
    }
  }

  private isValidMemoryRow(row: AgentTableRow): row is AgentTableRow & { row_data: AgentMemoryRowData } {
    return isAgentMemoryRowData(row.row_data);
  }

  private convertDbRowToMemoryRow(dbRow: AgentTableRow & { row_data: AgentMemoryRowData }): AgentMemoryRow {
    return {
      id: dbRow.id,
      table_id: dbRow.table_id,
      data: dbRow.row_data,
      created_at: dbRow.created_at,
      updated_at: dbRow.updated_at
    };
  }

  private convertRowToMessage(row: AgentMemoryRow) {
    return {
      id: row.id,
      sessionId: row.data.sessionId,
      messageId: row.data.messageId,
      systemPrompt: row.data.systemPrompt,
      userPrompt: row.data.userPrompt,
      userInput: row.data.userInput,
      output: row.data.output,
      timestamp: row.data.timestamp,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Optimized insert method that uses cached table reference
   * This eliminates the redundant getAgentTable call in insertRowByCredentials
   * FIXED: Use proper TableService method instead of direct client access for consistency
   */
  private async insertRowWithCachedTable(
    tableName: string,
    insertRequest: AgentTableRowInsert,
    cachedTable: AgentTable
  ): Promise<AgentTableRow | null> {
    try {
      // FIXED: Use the proper TableService method instead of direct client access
      // This ensures consistency with other database operations
      const insertedRow = await this.tableService.insertRowByCredentials(
        this.credentials,
        tableName,
        insertRequest
      );

      if (!insertedRow) {
        logger.error('Failed to insert row with cached table - no row returned', {
          tableName,
          tableId: cachedTable.id,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId
        });
        throw new Error('Row insert failed: No row returned from insert operation');
      }

      logger.debug('Row inserted with cached table reference', {
        tableName,
        tableId: cachedTable.id,
        rowId: insertedRow.id,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId
      });

      return insertedRow;

    } catch (error) {
      logger.error('Failed to insert row with cached table', {
        tableName,
        tableId: cachedTable.id,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private validateStoreMessageRequest(
    request: StoreMessageRequest, 
    context: ValidationContext
  ): ValidationResult {
    return AgentMemoryValidator.validateStoreMessageRequest(request, context);
  }
}

