// Agent Memory Integration - Search Operations
// Clean message search operations with agent/tenant context

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
  SearchMessagesRequest,
  SearchMessagesResponse,
  SearchMessageResult,
  SessionMessage,
  AgentMemoryRowData,
  AgentMemoryRow,
  AgentMemoryError,
  SessionNotFoundError,
  InvalidMessageFormatError,
  TableOperationError,
  ValidationResult,
  AGENT_MEMORY_CONSTANTS,
  isSearchMessagesRequest,
  isAgentMemoryRowData,
  validateSessionId,
  validateTableName,
  GetMessagesRequest,
  GetMessagesResponse,
  SessionRowQueryOptions
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
 * Secure AgentMemory Search service with comprehensive credential validation
 */
export class SecureAgentMemorySearch {
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

    logger.info('SecureAgentMemorySearch initialized', {
      agentId: this.defaultCredentials.agentId,
      tenantId: this.defaultCredentials.tenantId,
      hasSessionToken: !!(this.defaultCredentials as any).sessionToken,
      requestId: this.defaultCredentials.requestId
    });
  }

  /**
   * Execute secure memory operation with comprehensive validation
   */
  async executeSecureMemoryOperation(request: SecureMemoryRequest): Promise<SecureMemoryResponse> {
    const startTime = Date.now();
    const operationId = crypto.randomBytes(8).toString('hex');

    try {
      logger.info('SecureAgentMemorySearch: starting secure operation', {
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
        case 'search':
          operationResult = await this.handleSecureSearch(request, validatedCredentials.credentials, operationId);
          break;
        case 'retrieve':
          operationResult = await this.handleSecureRetrieve(request, validatedCredentials.credentials, operationId);
          break;
        case 'store':
          operationResult = await this.handleSecureStore(request, validatedCredentials.credentials, operationId);
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

      logger.info('SecureAgentMemorySearch: operation completed successfully', {
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
      
      logger.error('SecureAgentMemorySearch: operation failed', {
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

  private async handleSecureSearch(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    if (!request.searchOptions?.query) {
      throw new Error('Search query is required for search operation');
    }

    // Use the existing AgentMemorySearch for actual data search
    const searchService = new AgentMemorySearch(this.tableService, {
      agentId: credentials.agentId,
      tenantId: credentials.tenantId
    });

    const searchRequest: SearchMessagesRequest = {
      sessionId: request.sessionId || '',
      query: request.searchOptions.query,
      searchFields: request.searchOptions.fields as any,
      minRelevanceScore: 0.1,
      limit: request.context?.maxMessages || 50
    };

    const result = await searchService.searchMessages(request.tableName, searchRequest);

    // Process and validate results
    const processedResults = result.messages.map(msg => ({
      ...msg,
      verified: DataIntegrityValidator.validateSessionData(msg, request.sessionId || '')
    })).filter(result => result.verified);

    logger.info('Secure search operation completed', {
      operationId,
      sessionId: request.sessionId,
      resultsFound: processedResults.length,
      totalMatches: result.totalCount,
      agentId: credentials.agentId
    });

    return {
      data: {
        results: processedResults,
        totalMatches: result.totalCount,
        searchQuery: request.searchOptions.query,
        searchFields: request.searchOptions.fields
      },
      recordsProcessed: processedResults.length,
      strategy: 'database_secure',
      warnings: processedResults.some(r => !r.verified) ? ['Some results failed verification'] : []
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

  private async handleSecureStore(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    // Placeholder for secure store operation
    return {
      data: {
        stored: true,
        rowId: `secure-${operationId}`,
        sessionId: request.data?.sessionId,
        messageId: request.data?.messageId
      },
      recordsProcessed: 1,
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

export class AgentMemorySearch {
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
   * Search messages in session memory using TableService search capabilities
   */
  async searchMessages(
    tableName: string,
    request: SearchMessagesRequest
  ): Promise<SearchMessagesResponse> {
    // Validate credentials are present (TableService requirement)
    if (!this.credentials.agentId || !this.credentials.tenantId) {
      throw new CredentialsError('Missing required credentials for memory operation');
    }

    const validationContext: ValidationContext = {
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId,
      operation: 'search',
      tableName
    };

    try {
      // Validate inputs with context
      const validation = this.validateSearchMessagesRequest(request, validationContext);
      if (!validation.isValid) {
        throw new InvalidMessageFormatError(validation.errors.join(', '));
      }

      const tableValidation = validateTableName(tableName);
      if (!tableValidation.isValid) {
        throw new InvalidMessageFormatError(`Table name invalid: ${tableValidation.errors.join(', ')}`);
      }

      // Resolve table with agent/tenant context
      const tableResult = await this.resolveTableWithCredentials(tableName);
      if (!tableResult.found || !tableResult.table) {
        throw new SessionNotFoundError(request.sessionId);
      }

      const limit = Math.min(
        request.limit ?? AGENT_MEMORY_CONSTANTS.DEFAULT_LIMIT,
        AGENT_MEMORY_CONSTANTS.MAX_LIMIT
      );

      // Use TableService advanced search with session filtering
      const searchCriteria = {
        textSearch: request.query,
        fieldFilters: {
          'sessionId': request.sessionId
        },
        sortBy: {
          field: 'created_at',
          direction: 'desc' as const
        },
        limit
      };

      logger.debug('Searching messages with criteria', {
        searchCriteria,
        sessionId: request.sessionId,
        tableName,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId
      });

      let searchResults;
      try {
        searchResults = await this.tableService.advancedSearchRows(
          this.credentials,
          tableName,
          searchCriteria
        );
      } catch (error) {
        logger.error('Search operation failed, falling back to retrieve', {
          error: error instanceof Error ? error.message : String(error),
          sessionId: request.sessionId,
          tableName,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId
        });
        
        // Fallback to retrieve operation if search fails
        const retrieveResults = await this.getMessages(tableName, {
          sessionId: request.sessionId,
          limit,
          offset: 0,
          orderDirection: 'desc' as const
        });
        
        // Convert retrieve results to search results format
        searchResults = {
          data: retrieveResults.messages.map((msg: SessionMessage) => ({
            id: msg.id,
            row_data: msg,
            created_at: msg.createdAt,
            updated_at: msg.updatedAt
          })),
          totalCount: retrieveResults.totalCount,
          page: 1,
          totalPages: Math.ceil(retrieveResults.totalCount / limit)
        };
      }

      // Convert results to session messages with relevance scoring
      const searchFields = request.searchFields ?? [...AGENT_MEMORY_CONSTANTS.DEFAULT_SEARCH_FIELDS];
      const minRelevanceScore = request.minRelevanceScore ?? AGENT_MEMORY_CONSTANTS.DEFAULT_MIN_RELEVANCE_SCORE;

      const messages: SearchMessageResult[] = searchResults.data
        .filter((row: any) => this.isValidMemoryRow(row))
        .map((row: any) => {
          const memoryRow = this.convertDbRowToMemoryRow(row);
          const message = this.convertRowToMessage(memoryRow);
          const relevanceScore = this.calculateRelevanceScore(message, request.query, searchFields);
          return { ...message, relevanceScore };
        })
        .filter((result: SearchMessageResult) => result.relevanceScore >= minRelevanceScore)
        .sort((a: SearchMessageResult, b: SearchMessageResult) => b.relevanceScore - a.relevanceScore);

      // Audit log for search operations
      logger.info('Agent memory search audit', {
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        sessionId: request.sessionId,
        query: request.query,
        resultCount: messages.length,
        totalMatches: searchResults.totalCount
      });

      return {
        messages,
        totalCount: messages.length,
        searchQuery: request.query
      };

    } catch (error) {
      logger.error('Failed to search messages in agent memory', {
        error: error instanceof Error ? error.message : String(error),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        sessionId: request.sessionId,
        query: request.query
      });

      if (error instanceof AgentMemoryError || error instanceof TableNotFoundError) {
        throw error;
      }

      throw new TableOperationError('search_messages',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Get messages from session memory (fallback method for search)
   */
  async getMessages(
    tableName: string,
    request: GetMessagesRequest
  ): Promise<GetMessagesResponse> {
    // Validate credentials are present (TableService requirement)
    if (!this.credentials.agentId || !this.credentials.tenantId) {
      throw new CredentialsError('Missing required credentials for memory operation');
    }

    const validationContext: ValidationContext = {
      agentId: this.credentials.agentId,
      tenantId: this.credentials.tenantId,
      operation: 'get',
      tableName
    };

    try {
      // Validate inputs with context
      const validation = this.validateGetMessagesRequest(request, validationContext);
      if (!validation.isValid) {
        throw new InvalidMessageFormatError(validation.errors.join(', '));
      }

      const tableValidation = validateTableName(tableName);
      if (!tableValidation.isValid) {
        throw new InvalidMessageFormatError(`Table name invalid: ${tableValidation.errors.join(', ')}`);
      }

      // Resolve table with agent/tenant context
      const tableResult = await this.resolveTableWithCredentials(tableName);
      if (!tableResult.found || !tableResult.table) {
        throw new SessionNotFoundError(request.sessionId);
      }

      const limit = Math.min(
        request.limit ?? AGENT_MEMORY_CONSTANTS.DEFAULT_LIMIT,
        AGENT_MEMORY_CONSTANTS.MAX_LIMIT
      );

      const offset = request.offset ?? 0;
      const orderDirection = request.orderDirection ?? 'desc';

      // Use TableService to get rows with session filtering
      const rowsResult = await this.tableService.getRowsByCredentials(
        this.credentials,
        tableName
      );

      // Filter by session ID and convert to session messages
      const sessionRows = rowsResult.data.filter((row: AgentTableRow) => 
        this.isValidMemoryRow(row) && 
        row.row_data.sessionId === request.sessionId
      );

      // Apply pagination and sorting
      const sortedRows = sessionRows.sort((a: AgentTableRow, b: AgentTableRow) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return orderDirection === 'asc' ? aTime - bTime : bTime - aTime;
      });

      const paginatedRows = sortedRows.slice(offset, offset + limit);

      const messages: SessionMessage[] = paginatedRows.map((row: AgentTableRow & { row_data: AgentMemoryRowData }) => {
        const memoryRow = this.convertDbRowToMemoryRow(row);
        return this.convertRowToMessage(memoryRow);
      });

      const totalCount = sessionRows.length;

      return {
        messages,
        totalCount,
        hasMore: offset + messages.length < totalCount
      };

    } catch (error) {
      logger.error('Failed to get messages in agent memory', {
        error: error instanceof Error ? error.message : String(error),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        sessionId: request.sessionId
      });

      if (error instanceof AgentMemoryError || error instanceof TableNotFoundError) {
        throw error;
      }

      throw new TableOperationError('get_messages',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Calculate relevance score for search results
   */
  private calculateRelevanceScore(
    message: SessionMessage,
    query: string,
    searchFields: ReadonlyArray<'systemPrompt' | 'userPrompt' | 'userInput' | 'output'>
  ): number {
    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 0);
    
    if (queryWords.length === 0) {
      return 0;
    }

    let totalScore = 0;
    let fieldCount = 0;

    for (const field of searchFields) {
      const fieldValue = message[field];
      if (typeof fieldValue !== 'string') continue;
      
      const fieldLower = fieldValue.toLowerCase();
      let fieldScore = 0;

      // Exact phrase match gets highest score
      if (fieldLower.includes(queryLower)) {
        fieldScore += 1.0;
      }

      // Word matches get partial scores
      for (const word of queryWords) {
        if (fieldLower.includes(word)) {
          fieldScore += 0.5 / queryWords.length;
        }
      }

      totalScore += fieldScore;
      fieldCount++;
    }

    return fieldCount > 0 ? totalScore / fieldCount : 0;
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

  private convertRowToMessage(row: AgentMemoryRow): SessionMessage {
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

  private validateSearchMessagesRequest(
    request: SearchMessagesRequest, 
    context: ValidationContext
  ): ValidationResult {
    return AgentMemoryValidator.validateSearchMessagesRequest(request, context);
  }

  private validateGetMessagesRequest(
    request: GetMessagesRequest, 
    context: ValidationContext
  ): ValidationResult {
    return AgentMemoryValidator.validateGetMessagesRequest(request, context);
  }
}

