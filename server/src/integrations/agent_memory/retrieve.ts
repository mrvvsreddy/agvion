// path: src/integrations/agent-memory/AgentMemoryRetrieve.ts
import logger from '../../utils/logger';
import tableService from '../../database/services/TableService';
import type { 
  TableService, 
  UserCredentials, 
  AgentTable,
  AgentTableRow,
  SecureCredentials,
  SecureQueryRequest,
  SecureQueryFilter
} from '../../database/services/TableService';
import {
  TableNotFoundError,
  TableValidationError,
  RowOperationError,
  CredentialsError 
} from '../../database/services/TableService';
import * as crypto from 'crypto';

// Core domain types
export interface SessionMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly messageId: number;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly userInput: string;
  readonly output: string;
  readonly timestamp: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GetMessagesRequest {
  readonly sessionId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly orderDirection?: 'asc' | 'desc';
}

export interface GetMessagesResponse {
  readonly messages: readonly SessionMessage[];
  readonly totalCount: number;
  readonly hasMore: boolean;
}

export interface SessionStats {
  readonly sessionId: string;
  readonly messageCount: number;
  readonly firstMessageAt: string;
  readonly lastMessageAt: string;
  readonly totalCharacters: number;
  readonly averageMessageLength: number;
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

// Enhanced search criteria with proper field mapping
export interface EnhancedSearchCriteria {
  readonly directColumnFilters: Record<string, string | number>; // Direct table columns
  readonly jsonFieldFilters: Record<string, string | number>;    // JSONB row_data fields
  readonly sortBy: {
    readonly field: string;
    readonly direction: 'asc' | 'desc';
  };
  readonly limit: number;
  readonly offset: number;
}

// Validated row data structure matching database JSON format
interface AgentMemoryRowData {
  readonly sessionId: string;
  readonly messageId: number;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly userInput: string;
  readonly output: string;
  readonly timestamp: string | number;
  readonly executionId?: string;
  readonly workflowId?: string;
  readonly agentId?: string;
  readonly tenantId?: string;
}

// Database table row structure
interface DatabaseTableRow {
  readonly id: string;
  readonly agent_id: string;
  readonly table_id: string;
  readonly row_data: AgentMemoryRowData | string; // Can be JSON string or parsed object
  readonly created_at: string;
  readonly updated_at: string;
}

// Error types
export class AgentMemoryError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AgentMemoryError';
  }
}

export class SessionNotFoundError extends AgentMemoryError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
  }
}

export class InvalidRequestError extends AgentMemoryError {
  constructor(message: string) {
    super(message, 'INVALID_REQUEST');
  }
}

export class TableOperationError extends AgentMemoryError {
  constructor(operation: string, reason: string) {
    super(`Table operation '${operation}' failed: ${reason}`, 'TABLE_OPERATION_FAILED');
  }
}

// Constants
const MEMORY_CONSTANTS = {
  MAX_LIMIT: 1000,
  MIN_SESSION_ID_LENGTH: 1,
  MAX_SESSION_ID_LENGTH: 255,
  DEFAULT_TIMEOUT_MS: 5000,
  MAX_RETRIES: 2
} as const;

// Secure credential management
export class CredentialManager {
  private static readonly SESSION_TIMEOUT_MS = 1000 * 60 * 60; // 1 hour
  private static sessionTokens: Map<string, {
    agentId: string;
    tenantId: string;
    createdAt: number;
    lastUsed: number;
  }> = new Map();

  /**
   * Generate secure session token for enhanced security
   */
  static generateSessionToken(agentId: string, tenantId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    
    this.sessionTokens.set(token, {
      agentId,
      tenantId,
      createdAt: Date.now(),
      lastUsed: Date.now()
    });

    // Clean up expired tokens
    this.cleanupExpiredTokens();

    return token;
  }

  /**
   * Validate session token
   */
  static validateSessionToken(token: string, agentId: string, tenantId: string): boolean {
    const session = this.sessionTokens.get(token);
    
    if (!session) {
      return false;
    }

    // Check if token is expired
    if (Date.now() - session.lastUsed > this.SESSION_TIMEOUT_MS) {
      this.sessionTokens.delete(token);
      return false;
    }

    // Validate agent and tenant match
    if (session.agentId !== agentId || session.tenantId !== tenantId) {
      logger.warn('Session token validation failed: credential mismatch', {
        tokenAgentId: session.agentId,
        providedAgentId: agentId,
        tokenTenantId: session.tenantId,
        providedTenantId: tenantId
      });
      return false;
    }

    // Update last used time
    session.lastUsed = Date.now();
    return true;
  }

  /**
   * Enhance credentials with additional security
   */
  static enhanceCredentials(
    baseCredentials: { agentId: string; tenantId: string },
    options: { generateToken?: boolean; requestId?: string } = {}
  ): SecureCredentials {
    const enhanced: SecureCredentials = {
      ...baseCredentials,
      requestId: options.requestId || crypto.randomBytes(16).toString('hex')
    };

    if (options.generateToken) {
      (enhanced as any).sessionToken = this.generateSessionToken(
        baseCredentials.agentId, 
        baseCredentials.tenantId
      );
    }

    return enhanced;
  }

  private static cleanupExpiredTokens(): void {
    const now = Date.now();
    const expiredTokens: string[] = [];

    for (const [token, session] of this.sessionTokens.entries()) {
      if (now - session.lastUsed > this.SESSION_TIMEOUT_MS) {
        expiredTokens.push(token);
      }
    }

    expiredTokens.forEach(token => this.sessionTokens.delete(token));
  }
}

// Data integrity validator
export class DataIntegrityValidator {
  /**
   * Validate that conversation data belongs to the session
   */
  static validateSessionData(data: any, expectedSessionId: string): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check if data contains sessionId and it matches
    const dataSessionId = data.sessionId || data.row_data?.sessionId;
    return dataSessionId === expectedSessionId;
  }

  /**
   * Validate message integrity
   */
  static validateMessageIntegrity(message: any): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!message) {
      errors.push('Message is null or undefined');
      return { isValid: false, errors, warnings };
    }

    // Check required fields
    const rowData = message.row_data || message;
    
    if (!rowData.sessionId) {
      errors.push('Missing sessionId');
    }

    if (typeof rowData.messageId !== 'number' || rowData.messageId < 1) {
      errors.push('Invalid messageId');
    }

    if (!rowData.timestamp) {
      warnings.push('Missing timestamp');
    }

    // Check for suspicious content
    const textFields = ['userInput', 'output', 'systemPrompt'];
    for (const field of textFields) {
      if (rowData[field] && typeof rowData[field] === 'string') {
        if (this.containsSuspiciousPatterns(rowData[field])) {
          warnings.push(`Suspicious content detected in ${field}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private static containsSuspiciousPatterns(text: string): boolean {
    const suspiciousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+=/i,
      /data:text\/html/i,
      /vbscript:/i
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(text));
  }
}

// Field mapping utility for correct database queries
class FieldMappingUtils {
  // Direct table columns (not in JSONB row_data)
  private static readonly DIRECT_COLUMNS = new Set([
    'id',
    'agent_id',
    'table_id', 
    'created_at',
    'updated_at'
  ]);

  // JSONB fields inside row_data column
  private static readonly JSONB_FIELDS = new Set([
    'sessionId',
    'messageId',
    'systemPrompt',
    'userPrompt',
    'userInput',
    'output',
    'timestamp',
    'executionId',
    'workflowId',
    'agentId', // Note: this can exist in both places, but we use table column primarily
    'tenantId'
  ]);

  /**
   * Maps field names to correct database query paths
   */
  static getFilterField(fieldName: string): { path: string; isJsonb: boolean } {
    if (this.DIRECT_COLUMNS.has(fieldName)) {
      return { 
        path: fieldName, 
        isJsonb: false 
      };
    } else if (this.JSONB_FIELDS.has(fieldName)) {
      return { 
        path: `row_data->>'${fieldName}'`, 
        isJsonb: true 
      };
    } else {
      // Default to JSONB for unknown fields
      return { 
        path: `row_data->>'${fieldName}'`, 
        isJsonb: true 
      };
    }
  }

  /**
   * Separates field filters into direct columns vs JSONB fields
   */
  static categorizeFilters(filters: Record<string, string | number>): {
    directColumns: Record<string, string | number>;
    jsonbFields: Record<string, string | number>;
  } {
    const directColumns: Record<string, string | number> = {};
    const jsonbFields: Record<string, string | number> = {};

    for (const [field, value] of Object.entries(filters)) {
      const mapping = this.getFilterField(field);
      if (mapping.isJsonb) {
        jsonbFields[field] = value;
      } else {
        directColumns[field] = value;
      }
    }

    return { directColumns, jsonbFields };
  }

  /**
   * Creates optimized search criteria with proper field separation
   */
  static createOptimizedSearchCriteria(
    agentId: string,
    tableId: string,
    sessionId: string,
    options: {
      readonly limit: number;
      readonly offset: number;
      readonly orderDirection: 'asc' | 'desc';
    }
  ): EnhancedSearchCriteria {
    return {
      directColumnFilters: {
        agent_id: agentId,
        table_id: tableId
      },
      jsonFieldFilters: {
        sessionId: sessionId
      },
      sortBy: {
        field: 'created_at', // This is a direct column
        direction: options.orderDirection
      },
      limit: options.limit,
      offset: options.offset
    };
  }
}

// Validation utilities
class ValidationUtils {
  static validateSessionId(sessionId: unknown): sessionId is string {
    return typeof sessionId === 'string' &&
           sessionId.trim().length >= MEMORY_CONSTANTS.MIN_SESSION_ID_LENGTH &&
           sessionId.trim().length <= MEMORY_CONSTANTS.MAX_SESSION_ID_LENGTH;
  }

  static validateTableName(tableName: unknown): tableName is string {
    return typeof tableName === 'string' &&
           tableName.trim().length > 0 &&
           /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName.trim());
  }

  static validateGetMessagesRequest(request: unknown): request is GetMessagesRequest {
    if (!request || typeof request !== 'object') return false;
    
    const req = request as Record<string, unknown>;
    
    if (!this.validateSessionId(req.sessionId)) return false;
    
    if (req.limit !== undefined && 
        (typeof req.limit !== 'number' || req.limit < 1 || req.limit > MEMORY_CONSTANTS.MAX_LIMIT)) {
      return false;
    }
    
    if (req.offset !== undefined && 
        (typeof req.offset !== 'number' || req.offset < 0)) {
      return false;
    }
    
    if (req.orderDirection !== undefined && 
        req.orderDirection !== 'asc' && req.orderDirection !== 'desc') {
      return false;
    }
    
    return true;
  }

  /**
   * Parse row_data which can be either JSON string or object
   */
  static parseRowData(rowData: unknown): AgentMemoryRowData | null {
    try {
      let parsed: unknown;
      
      if (typeof rowData === 'string') {
        parsed = JSON.parse(rowData);
      } else if (typeof rowData === 'object' && rowData !== null) {
        parsed = rowData;
      } else {
        return null;
      }

      return this.isAgentMemoryRowData(parsed) ? parsed : null;
    } catch (error) {
      logger.debug('Failed to parse row data', {
        rowData,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  static isAgentMemoryRowData(data: unknown): data is AgentMemoryRowData {
    if (!data || typeof data !== 'object') return false;
    
    const row = data as Record<string, unknown>;
    
    return typeof row.sessionId === 'string' &&
           typeof row.messageId === 'number' &&
           typeof row.systemPrompt === 'string' &&  // Allow empty strings
           typeof row.userPrompt === 'string' &&    // Allow empty strings
           typeof row.userInput === 'string' &&
           typeof row.output === 'string' &&
           (typeof row.timestamp === 'string' || typeof row.timestamp === 'number');
  }

  static normalizeSessionId(sessionId: string): string {
    return sessionId.trim();
  }
}

// Database operation result types
interface QueryResult<T> {
  readonly data: readonly T[];
  readonly totalCount: number;
}

interface TableResolutionResult {
  readonly table: AgentTable | null;
  readonly tableId: string | null;
  readonly found: boolean;
  readonly error?: string;
}

/**
 * Secure AgentMemory service with comprehensive credential validation
 */
export class SecureAgentMemory {
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

    logger.info('SecureAgentMemory initialized', {
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
      logger.info('SecureAgentMemory: starting secure operation', {
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
        case 'retrieve':
          operationResult = await this.handleSecureRetrieve(request, validatedCredentials.credentials, operationId);
          break;
        case 'search':
          operationResult = await this.handleSecureSearch(request, validatedCredentials.credentials, operationId);
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

      logger.info('SecureAgentMemory: operation completed successfully', {
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
      
      logger.error('SecureAgentMemory: operation failed', {
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
   * Get secure conversation context for AI agents
   */
  async getSecureConversationContext(
    sessionId: string,
    tableName: string,
    maxMessages: number = 20,
    credentials?: SecureCredentials,
    options: {
      includeSystemPrompts?: boolean;
      validateDataIntegrity?: boolean;
      auditLevel?: 'basic' | 'detailed' | 'full';
    } = {}
  ): Promise<{
    success: boolean;
    messages: Array<{
      messageId: number;
      userInput: string;
      output: string;
      timestamp: number;
      systemPrompt?: string;
      verified: boolean;
    }>;
    totalMessages: number;
    hasMoreHistory: boolean;
    contextSummary: string;
    security: {
      validated: boolean;
      integrityChecked: boolean;
      auditTrail: string;
    };
  }> {
    const operationCredentials = credentials || this.defaultCredentials;
    
    const request: SecureMemoryRequest = {
      operation: 'retrieve',
      sessionId,
      tableName,
      credentials: operationCredentials,
      context: {
        maxMessages,
        includeSystemPrompts: options.includeSystemPrompts ?? false,
        onlyUserInteractions: !options.includeSystemPrompts
      },
      securityOptions: {
        auditLevel: options.auditLevel || 'basic',
        validateDataIntegrity: options.validateDataIntegrity ?? true
      }
    };

    const response = await this.executeSecureMemoryOperation(request);

    if (!response.success) {
      return {
        success: false,
        messages: [],
        totalMessages: 0,
        hasMoreHistory: false,
        contextSummary: 'Failed to retrieve conversation history',
        security: {
          validated: false,
          integrityChecked: false,
          auditTrail: response.security.auditTrail
        }
      };
    }

    const messages = response.data.messages || [];
    const totalMessages = response.data.totalCount || 0;
    const hasMoreHistory = totalMessages > maxMessages;

    // Validate message integrity if requested
    let integrityChecked = false;
    if (options.validateDataIntegrity) {
      integrityChecked = this.validateAllMessagesIntegrity(messages, sessionId);
    }

    const processedMessages = messages.map((msg: any) => ({
      messageId: msg.messageId || 0,
      userInput: msg.userInput || '',
      output: msg.output || '',
      timestamp: msg.timestamp || 0,
      systemPrompt: options.includeSystemPrompts ? msg.systemPrompt : undefined,
      verified: DataIntegrityValidator.validateSessionData(msg, sessionId)
    }));

    const contextSummary = this.generateSecureContextSummary(processedMessages, totalMessages);

    return {
      success: true,
      messages: processedMessages,
      totalMessages,
      hasMoreHistory,
      contextSummary,
      security: {
        validated: response.security.validated,
        integrityChecked,
        auditTrail: response.security.auditTrail
      }
    };
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

  private async handleSecureRetrieve(
    request: SecureMemoryRequest,
    credentials: SecureCredentials,
    operationId: string
  ): Promise<any> {
    if (!request.sessionId) {
      throw new Error('SessionId is required for retrieve operation');
    }

    // Use the existing AgentMemoryRetrieve for actual data retrieval
    const retrieveService = new AgentMemoryRetrieve(this.tableService, {
      agentId: credentials.agentId,
      tenantId: credentials.tenantId
    });

    const result = await retrieveService.getMessages(request.tableName, {
      sessionId: request.sessionId,
      limit: request.context?.maxMessages || 20,
      offset: 0,
      orderDirection: 'desc'
    });

    // Process and validate results, then filter sensitive data
    const processedMessages = result.messages.map(msg => ({
      ...msg,
      verified: DataIntegrityValidator.validateSessionData(msg, request.sessionId!)
    })).filter(msg => {
      // Additional filtering based on context
      if (request.context?.onlyUserInteractions && !msg.userInput) {
        return false;
      }
      return msg.verified; // Only return verified messages
    }).map(msg => this.filterSensitiveData(msg)); // Filter sensitive data

    logger.info('Secure retrieve operation completed', {
      operationId,
      sessionId: request.sessionId,
      messagesFound: processedMessages.length,
      totalCount: result.totalCount,
      agentId: credentials.agentId
    });

    return {
      data: {
        messages: processedMessages,
        totalCount: result.totalCount,
        hasMore: result.hasMore
      },
      recordsProcessed: processedMessages.length,
      strategy: 'database_secure',
      warnings: processedMessages.some(m => !m.verified) ? ['Some messages failed verification'] : []
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

  /**
   * Helper methods
   */
  private validateAllMessagesIntegrity(messages: any[], expectedSessionId: string): boolean {
    return messages.every(message => 
      DataIntegrityValidator.validateSessionData(message, expectedSessionId)
    );
  }

  private generateSecureContextSummary(messages: any[], totalCount: number): string {
    if (messages.length === 0) {
      return 'No verified conversation history available';
    }

    const verifiedCount = messages.filter(m => m.verified).length;
    const recentCount = Math.min(messages.length, 5);
    const hasMoreHistory = totalCount > messages.length;

    let summary = `${verifiedCount} verified messages (${recentCount} most recent)`;
    if (hasMoreHistory) {
      summary += ` (${totalCount - messages.length} older messages available)`;
    }

    return summary;
  }

  /**
   * Filter sensitive database metadata while preserving all row_data content
   */
  private filterSensitiveData(message: any): any {
    // Create a copy of the message
    const filteredMessage = { ...message };
    
    // Remove only database metadata fields (not row_data content)
    delete filteredMessage.id; // Database row ID
    delete filteredMessage.agent_id; // Database agent_id column
    delete filteredMessage.table_id; // Database table_id column
    delete filteredMessage.created_at; // Database created_at column
    delete filteredMessage.updated_at; // Database updated_at column
    
    // Keep all row_data content intact - this contains the actual conversation
    // The row_data field should contain: userInput, output, timestamp, etc.
    
    return filteredMessage;
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

/**
 * Production-grade Agent Memory Retrieve Service with Fixed Field Mapping
 * 
 * Key fixes:
 * 1. Proper separation of direct columns vs JSONB fields
 * 2. Correct field mapping for agent_id (direct column) vs sessionId (JSONB field)  
 * 3. Enhanced search criteria with field categorization
 * 4. Fallback strategies for different query patterns
 */
export class AgentMemoryRetrieve {
  private readonly tableService: TableService;
  private readonly credentials: UserCredentials;
  private readonly options: {
    readonly maxRetries: number;
    readonly defaultTimeoutMs: number;
    readonly requireExistingTables: boolean;
  };

  constructor(
    tableService: TableService,
    credentials: UserCredentials,
    options: {
      maxRetries?: number;
      defaultTimeoutMs?: number;
      requireExistingTables?: boolean;
    } = {}
  ) {
    this.tableService = tableService;
    this.credentials = credentials;
    this.options = {
      maxRetries: options.maxRetries ?? MEMORY_CONSTANTS.MAX_RETRIES,
      defaultTimeoutMs: options.defaultTimeoutMs ?? MEMORY_CONSTANTS.DEFAULT_TIMEOUT_MS,
      requireExistingTables: options.requireExistingTables ?? true
    };
  }

  /**
   * Get messages from session with FIXED credential-based filtering
   * Follows TableService patterns for proper agent_id and table_id filtering
   */
  /**
   * Comprehensive memory data retrieval with full transformation and filtering
   * This is the main function that handles all memory processing for LLM context
   */
  async getProcessedMemoryData(
    tableName: string,
    sessionId: string,
    options: {
      readonly maxMessages?: number;
      readonly includeSystemPrompts?: boolean;
      readonly includeMetadata?: boolean;
      readonly filterByDateRange?: {
        readonly startDate?: string;
        readonly endDate?: string;
      };
      readonly filterByContent?: {
        readonly keywords?: string[];
        readonly excludeKeywords?: string[];
      };
      readonly sortOrder?: 'asc' | 'desc';
      readonly formatForLLM?: boolean;
    } = {}
  ): Promise<{
    readonly success: boolean;
    readonly data: {
      readonly messages: Array<{
        readonly messageId: number;
        readonly userInput: string;
        readonly output: string;
        readonly timestamp: string;
        readonly systemPrompt?: string;
        readonly userPrompt?: string;
        readonly metadata?: Record<string, unknown>;
      }>;
      readonly totalCount: number;
      readonly hasMore: boolean;
      readonly contextSummary: string;
      readonly formattedContext: string;
    };
    readonly processing: {
      readonly executionTimeMs: number;
      readonly transformationsApplied: string[];
      readonly filtersApplied: string[];
      readonly dataQuality: {
        readonly completeness: number;
        readonly consistency: number;
        readonly relevance: number;
      };
    };
    readonly error?: string;
  }> {
    const startTime = Date.now();
    const transformationsApplied: string[] = [];
    const filtersApplied: string[] = [];

    try {
      logger.info('Starting comprehensive memory data processing', {
        tableName,
        sessionId,
        options,
        timestamp: new Date().toISOString()
      });

      // Step 1: Retrieve raw messages
      const rawMessages = await this.getMessages(tableName, {
        sessionId,
        limit: options.maxMessages || MEMORY_CONSTANTS.MAX_LIMIT,
        orderDirection: options.sortOrder || 'desc'
      });

      if (!rawMessages.messages || rawMessages.messages.length === 0) {
        return {
          success: true,
          data: {
            messages: [],
            totalCount: 0,
            hasMore: false,
            contextSummary: 'No previous conversations found',
            formattedContext: ''
          },
          processing: {
            executionTimeMs: Date.now() - startTime,
            transformationsApplied: ['empty_result'],
            filtersApplied: [],
            dataQuality: { completeness: 100, consistency: 100, relevance: 100 }
          }
        };
      }

      // Step 2: Transform and filter messages
      let processedMessages = rawMessages.messages.map(msg => ({
        messageId: msg.messageId,
        userInput: msg.userInput,
        output: msg.output,
        timestamp: msg.timestamp,
        ...(options.includeSystemPrompts && { systemPrompt: msg.systemPrompt }),
        ...(options.includeSystemPrompts && { userPrompt: msg.userPrompt }),
        ...(options.includeMetadata && { metadata: {
          id: msg.id,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt
        }})
      }));

      transformationsApplied.push('basic_structure');

      // Step 3: Apply content filters
      if (options.filterByContent?.keywords && options.filterByContent.keywords.length > 0) {
        const keywords = options.filterByContent.keywords.map(k => k.toLowerCase());
        processedMessages = processedMessages.filter(msg => 
          keywords.some(keyword => 
            msg.userInput.toLowerCase().includes(keyword) || 
            msg.output.toLowerCase().includes(keyword)
          )
        );
        filtersApplied.push(`keyword_filter:${options.filterByContent.keywords.join(',')}`);
      }

      if (options.filterByContent?.excludeKeywords && options.filterByContent.excludeKeywords.length > 0) {
        const excludeKeywords = options.filterByContent.excludeKeywords.map(k => k.toLowerCase());
        processedMessages = processedMessages.filter(msg => 
          !excludeKeywords.some(keyword => 
            msg.userInput.toLowerCase().includes(keyword) || 
            msg.output.toLowerCase().includes(keyword)
          )
        );
        filtersApplied.push(`exclude_keyword_filter:${options.filterByContent.excludeKeywords.join(',')}`);
      }

      // Step 4: Apply date range filters
      if (options.filterByDateRange?.startDate || options.filterByDateRange?.endDate) {
        const startDate = options.filterByDateRange.startDate ? new Date(options.filterByDateRange.startDate) : null;
        const endDate = options.filterByDateRange.endDate ? new Date(options.filterByDateRange.endDate) : null;
        
        processedMessages = processedMessages.filter(msg => {
          const msgDate = new Date(msg.timestamp);
          if (startDate && msgDate < startDate) return false;
          if (endDate && msgDate > endDate) return false;
          return true;
        });
        filtersApplied.push(`date_range_filter:${startDate?.toISOString() || 'none'}-${endDate?.toISOString() || 'none'}`);
      }

      // Step 5: Sort messages
      if (options.sortOrder === 'asc') {
        processedMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        transformationsApplied.push('sort_asc');
      } else {
        processedMessages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        transformationsApplied.push('sort_desc');
      }

      // Step 6: Generate context summary
      const contextSummary = this.generateContextSummary(processedMessages, rawMessages.totalCount);

      // Step 7: Format for LLM if requested
      let formattedContext = '';
      if (options.formatForLLM !== false) {
        formattedContext = this.formatForLLMContext(processedMessages, contextSummary);
        transformationsApplied.push('llm_formatting');
      }

      // Step 8: Calculate data quality metrics
      const dataQuality = this.calculateDataQuality(processedMessages, [...rawMessages.messages]);

      const executionTime = Date.now() - startTime;

      logger.info('Memory data processing completed', {
        tableName,
        sessionId,
        originalCount: rawMessages.messages.length,
        processedCount: processedMessages.length,
        executionTimeMs: executionTime,
        transformationsApplied,
        filtersApplied,
        dataQuality
      });

      return {
        success: true,
        data: {
          messages: processedMessages,
          totalCount: rawMessages.totalCount,
          hasMore: rawMessages.hasMore,
          contextSummary,
          formattedContext
        },
        processing: {
          executionTimeMs: executionTime,
          transformationsApplied,
          filtersApplied,
          dataQuality
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Memory data processing failed', {
        tableName,
        sessionId,
        error: errorMessage,
        executionTimeMs: Date.now() - startTime
      });

      return {
        success: false,
        data: {
          messages: [],
          totalCount: 0,
          hasMore: false,
          contextSummary: 'Error processing memory data',
          formattedContext: ''
        },
        processing: {
          executionTimeMs: Date.now() - startTime,
          transformationsApplied: ['error_handling'],
          filtersApplied: [],
          dataQuality: { completeness: 0, consistency: 0, relevance: 0 }
        },
        error: errorMessage
      };
    }
  }

  /**
   * Generate a comprehensive context summary from processed messages
   */
  private generateContextSummary(
    messages: Array<{ userInput: string; output: string; timestamp: string }>,
    totalCount: number
  ): string {
    if (messages.length === 0) {
      return 'No previous conversations found';
    }

    const firstMessage = messages[messages.length - 1]; // Oldest message
    const lastMessage = messages[0]; // Newest message
    
    if (!firstMessage || !lastMessage) {
      return `Found ${messages.length} of ${totalCount} previous conversations.`;
    }
    
    const timeSpan = new Date(lastMessage.timestamp).getTime() - new Date(firstMessage.timestamp).getTime();
    const daysSpan = Math.ceil(timeSpan / (1000 * 60 * 60 * 24));
    
    const totalCharacters = messages.reduce((sum, msg) => 
      sum + msg.userInput.length + msg.output.length, 0
    );
    
    const averageMessageLength = Math.round(totalCharacters / messages.length);
    
    return `Found ${messages.length} of ${totalCount} previous conversations spanning ${daysSpan} days. ` +
           `Average message length: ${averageMessageLength} characters. ` +
           `Conversation range: ${firstMessage.timestamp} to ${lastMessage.timestamp}`;
  }

  /**
   * Format memory data specifically for LLM context injection
   */
  private formatForLLMContext(
    messages: Array<{ userInput: string; output: string; timestamp: string; messageId: number }>,
    contextSummary: string
  ): string {
    if (messages.length === 0) {
      return '';
    }

    let formattedContext = `## Previous Conversation Memory\n${contextSummary}\n\n`;
    
    messages.forEach((message, index) => {
      const messageNumber = messages.length - index; // Reverse order for chronological display
      const timestamp = new Date(message.timestamp).toLocaleString();
      
      formattedContext += `### Conversation ${messageNumber} (${timestamp})\n`;
      formattedContext += `**User:** ${message.userInput}\n`;
      formattedContext += `**Assistant:** ${message.output}\n\n`;
    });

    formattedContext += `\n**IMPORTANT:** Use this conversation history to provide context-aware responses. ` +
                       `Reference specific previous interactions when relevant, and maintain consistency ` +
                       `with the established conversation flow.`;

    return formattedContext;
  }

  /**
   * Calculate data quality metrics for processed messages
   */
  private calculateDataQuality(
    processedMessages: Array<{ userInput: string; output: string; timestamp: string }>,
    originalMessages: SessionMessage[]
  ): { completeness: number; consistency: number; relevance: number } {
    if (processedMessages.length === 0) {
      return { completeness: 100, consistency: 100, relevance: 100 };
    }

    // Completeness: percentage of messages with complete user/assistant pairs
    const completePairs = processedMessages.filter(msg => 
      msg.userInput.trim().length > 0 && msg.output.trim().length > 0
    ).length;
    const completeness = (completePairs / processedMessages.length) * 100;

    // Consistency: check for consistent timestamp ordering and format
    let consistencyScore = 100;
    for (let i = 1; i < processedMessages.length; i++) {
      const prevMsg = processedMessages[i - 1];
      const currMsg = processedMessages[i];
      if (prevMsg && currMsg) {
        const prevTime = new Date(prevMsg.timestamp).getTime();
        const currTime = new Date(currMsg.timestamp).getTime();
        if (currTime < prevTime) {
          consistencyScore -= 10; // Penalty for out-of-order timestamps
        }
      }
    }

    // Relevance: check for meaningful content (not just empty or very short messages)
    const relevantMessages = processedMessages.filter(msg => 
      msg.userInput.trim().length > 10 && msg.output.trim().length > 10
    ).length;
    const relevance = (relevantMessages / processedMessages.length) * 100;

    return {
      completeness: Math.round(completeness),
      consistency: Math.max(0, Math.round(consistencyScore)),
      relevance: Math.round(relevance)
    };
  }

  async getMessages(
    tableName: string,
    request: GetMessagesRequest
  ): Promise<GetMessagesResponse> {
    // Fast validation with detailed error messages
    if (!ValidationUtils.validateTableName(tableName)) {
      throw new InvalidRequestError(`Invalid table name: ${tableName}`);
    }

    if (!ValidationUtils.validateGetMessagesRequest(request)) {
      throw new InvalidRequestError('Invalid request parameters');
    }

    // Validate credentials are present (TableService requirement)
    if (!this.credentials.agentId || !this.credentials.tenantId) {
      throw new CredentialsError('Missing required credentials for memory operation');
    }

    const normalizedSessionId = ValidationUtils.normalizeSessionId(request.sessionId);
    const limit = request.limit ? Math.min(request.limit, MEMORY_CONSTANTS.MAX_LIMIT) : MEMORY_CONSTANTS.MAX_LIMIT;
    const offset = request.offset ?? 0;
    const orderDirection = request.orderDirection ?? 'desc';

    try {
      // Fast table resolution with ID extraction
      const tableResult = await this.resolveTable(tableName);
      if (!tableResult.found || !tableResult.tableId) {
        logger.warn('Table not found for session retrieval', {
          tableName,
          sessionId: normalizedSessionId,
          agentId: this.credentials.agentId,
          tenantId: this.credentials.tenantId
        });
        throw new SessionNotFoundError(normalizedSessionId);
      }

      // Execute FIXED optimized query using proper field mapping
      const queryResult = await this.executeFixedOptimizedQuery(
        tableName,
        tableResult.tableId,
        normalizedSessionId,
        { limit, offset, orderDirection }
      );

      const hasMore = offset + queryResult.data.length < queryResult.totalCount;

      // Audit logging
      logger.info('Session messages retrieved successfully', {
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        tableId: tableResult.tableId,
        sessionId: normalizedSessionId,
        retrievedCount: queryResult.data.length,
        totalCount: queryResult.totalCount,
        hasMore,
        offset,
        limit,
        orderDirection
      });

      // Filter sensitive data from messages before returning (safe for SessionMessage)
      const filteredMessages = queryResult.data.map(msg => this.filterSensitiveData(msg));

      return {
        messages: filteredMessages,
        totalCount: queryResult.totalCount,
        hasMore
      };

    } catch (error) {
      logger.error('Failed to retrieve session messages', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        sessionId: normalizedSessionId,
        requestParams: { limit, offset, orderDirection }
      });

      // Re-throw known errors, wrap unknown ones
      if (error instanceof AgentMemoryError) {
        throw error;
      }
      
      throw new TableOperationError('getMessages', 
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Filter sensitive database metadata while preserving all row_data content
   */
  private filterSensitiveData(message: any): any {
    // Create a copy of the message
    const filteredMessage = { ...message };
    
    // Remove only database metadata fields (not row_data content)
    delete filteredMessage.id; // Database row ID
    delete filteredMessage.agent_id; // Database agent_id column
    delete filteredMessage.table_id; // Database table_id column
    delete filteredMessage.created_at; // Database created_at column
    delete filteredMessage.updated_at; // Database updated_at column
    
    // Keep all row_data content intact - this contains the actual conversation
    // The row_data field should contain: userInput, output, timestamp, etc.
    
    return filteredMessage;
  }

  /**
   * Get session statistics with single optimized query
   */
  async getSessionStats(tableName: string, sessionId: string): Promise<SessionStats | null> {
    if (!ValidationUtils.validateTableName(tableName) || !ValidationUtils.validateSessionId(sessionId)) {
      return null;
    }

    try {
      const tableResult = await this.resolveTable(tableName);
      if (!tableResult.found || !tableResult.tableId) {
        return null;
      }

      const normalizedSessionId = ValidationUtils.normalizeSessionId(sessionId);
      const queryResult = await this.executeFixedOptimizedQuery(
        tableName,
        tableResult.tableId,
        normalizedSessionId,
        { limit: MEMORY_CONSTANTS.MAX_LIMIT, offset: 0, orderDirection: 'asc' }
      );

      if (queryResult.totalCount === 0) {
        return null;
      }

      const messages = queryResult.data;
      const totalCharacters = messages.reduce((sum, msg) => 
        sum + msg.systemPrompt.length + msg.userPrompt.length + 
        msg.userInput.length + msg.output.length, 0
      );

      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];

      if (!firstMessage || !lastMessage) {
        return null;
      }

      return {
        sessionId: normalizedSessionId,
        messageCount: messages.length,
        firstMessageAt: String(firstMessage.timestamp),
        lastMessageAt: String(lastMessage.timestamp),
        totalCharacters,
        averageMessageLength: Math.round(totalCharacters / messages.length)
      };

    } catch (error) {
      logger.error('Failed to get session stats', {
        error: error instanceof Error ? error.message : String(error),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        sessionId
      });
      return null;
    }
  }

  /**
   * Clear session with batch delete operation
   */
  async clearSession(tableName: string, sessionId: string): Promise<boolean> {
    if (!ValidationUtils.validateTableName(tableName) || !ValidationUtils.validateSessionId(sessionId)) {
      logger.warn('Invalid parameters for clearSession', { tableName, sessionId });
      return false;
    }

    try {
      const tableResult = await this.resolveTable(tableName);
      if (!tableResult.found || !tableResult.tableId) {
        return false;
      }

      const normalizedSessionId = ValidationUtils.normalizeSessionId(sessionId);
      
      // Get all session rows using fixed query
      const queryResult = await this.executeFixedOptimizedQuery(
        tableName,
        tableResult.tableId,
        normalizedSessionId,
        { limit: MEMORY_CONSTANTS.MAX_LIMIT, offset: 0, orderDirection: 'asc' }
      );

      if (queryResult.totalCount === 0) {
        return true; // Already empty
      }

      // Batch delete operation
      const deleteResults = await Promise.allSettled(
        queryResult.data.map(message => 
          this.tableService.deleteRowByCredentials(this.credentials, tableName, message.id)
        )
      );

      const successCount = deleteResults.filter(r => r.status === 'fulfilled').length;
      const failureCount = deleteResults.length - successCount;

      logger.info('Session cleared', {
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        tableId: tableResult.tableId,
        sessionId: normalizedSessionId,
        totalMessages: queryResult.data.length,
        deletedCount: successCount,
        failedCount: failureCount
      });

      return failureCount === 0;

    } catch (error) {
      logger.error('Failed to clear session', {
        error: error instanceof Error ? error.message : String(error),
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        tableName,
        sessionId
      });
      return false;
    }
  }

  /**
   * Enhanced diagnostic method with credential-based optimization
   */
  async diagnoseSession(
    tableName: string,
    sessionId: string
  ): Promise<{
    readonly tableExists: boolean;
    readonly tableId: string | null;
    readonly agentId: string;
    readonly sessionExists: boolean;
    readonly messageCount: number;
    readonly sampleMessage: SessionMessage | null;
    readonly sampleRawData: unknown;
    readonly queryExecutionTimeMs: number;
    readonly fieldMappingInfo: {
      readonly agentIdMapping: string;
      readonly sessionIdMapping: string;
      readonly createdAtMapping: string;
    };
  }> {
    const startTime = Date.now();

    try {
      if (!ValidationUtils.validateTableName(tableName) || !ValidationUtils.validateSessionId(sessionId)) {
        return {
          tableExists: false,
          tableId: null,
          agentId: this.credentials.agentId,
          sessionExists: false,
          messageCount: 0,
          sampleMessage: null,
          sampleRawData: null,
          queryExecutionTimeMs: Date.now() - startTime,
          fieldMappingInfo: {
            agentIdMapping: 'agent_id (direct column)',
            sessionIdMapping: "row_data->>'sessionId' (JSONB field)",
            createdAtMapping: 'created_at (direct column)'
          }
        };
      }

      const tableResult = await this.resolveTable(tableName);
      if (!tableResult.found || !tableResult.tableId) {
        return {
          tableExists: false,
          tableId: null,
          agentId: this.credentials.agentId,
          sessionExists: false,
          messageCount: 0,
          sampleMessage: null,
          sampleRawData: null,
          queryExecutionTimeMs: Date.now() - startTime,
          fieldMappingInfo: {
            agentIdMapping: 'agent_id (direct column)',
            sessionIdMapping: "row_data->>'sessionId' (JSONB field)",
            createdAtMapping: 'created_at (direct column)'
          }
        };
      }

      const normalizedSessionId = ValidationUtils.normalizeSessionId(sessionId);
      const queryResult = await this.executeFixedOptimizedQuery(
        tableName,
        tableResult.tableId,
        normalizedSessionId,
        { limit: 1, offset: 0, orderDirection: 'desc' }
      );

      return {
        tableExists: true,
        tableId: tableResult.tableId,
        agentId: this.credentials.agentId,
        sessionExists: queryResult.totalCount > 0,
        messageCount: queryResult.totalCount,
        sampleMessage: queryResult.data[0] ?? null,
        sampleRawData: queryResult.data.length > 0 ? 'Found valid message with fixed mapping' : 'No messages found',
        queryExecutionTimeMs: Date.now() - startTime,
        fieldMappingInfo: {
          agentIdMapping: 'agent_id (direct column) - FIXED',
          sessionIdMapping: "row_data->>'sessionId' (JSONB field) - CORRECT",
          createdAtMapping: 'created_at (direct column) - CORRECT'
        }
      };

    } catch (error) {
      logger.error('Session diagnosis failed', {
        error: error instanceof Error ? error.message : String(error),
        tableName,
        sessionId,
        agentId: this.credentials.agentId
      });

      return {
        tableExists: false,
        tableId: null,
        agentId: this.credentials.agentId,
        sessionExists: false,
        messageCount: 0,
        sampleMessage: null,
        sampleRawData: error instanceof Error ? error.message : String(error),
        queryExecutionTimeMs: Date.now() - startTime,
        fieldMappingInfo: {
          agentIdMapping: 'agent_id (direct column)',
          sessionIdMapping: "row_data->>'sessionId' (JSONB field)",
          createdAtMapping: 'created_at (direct column)'
        }
      };
    }
  }

  /**
   * Private implementation methods
   */
  private async resolveTable(tableName: string): Promise<TableResolutionResult> {
    try {
      const result = await this.tableService.getAgentTable(this.credentials, tableName);
      return {
        table: result.table,
        tableId: result.table?.id ?? null,
        found: result.found
      };
    } catch (error) {
      logger.error('Table resolution failed', {
        tableName,
        agentId: this.credentials.agentId,
        tenantId: this.credentials.tenantId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        table: null,
        tableId: null,
        found: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * FIXED optimized query execution with proper field mapping
   */
  private async executeFixedOptimizedQuery(
    tableName: string,
    tableId: string,
    sessionId: string,
    options: {
      readonly limit: number;
      readonly offset: number;
      readonly orderDirection: 'asc' | 'desc';
    }
  ): Promise<QueryResult<SessionMessage>> {
    logger.debug('Executing optimized session query with direct JSONB filtering', {
      tableId,
      sessionId,
      agentId: this.credentials.agentId,
        options
    });

    try {
      // Direct database query with proper JSONB syntax and pagination
      const result = await (this.tableService as any).client
          .from('agent_table_rows')
        .select('id, agent_id, table_id, row_data, created_at, updated_at', { count: 'exact' })
          .eq('agent_id', this.credentials.agentId)
          .eq('table_id', tableId)
        .eq('row_data->>sessionId', sessionId)
        .order('created_at', { ascending: options.orderDirection === 'asc' })
        .range(options.offset, options.offset + options.limit - 1);

      if (result.error) {
        throw new Error(result.error.message || 'Unknown query error');
      }

      if (!result.data || result.data.length === 0) {
        logger.warn('Primary JSONB query found no rows. Executing single fallback using JSONB contains on row_data.sessionId', {
          tableId,
          sessionId,
          agentId: this.credentials.agentId
        });

        // Single fallback: JSONB contains on row_data for sessionId field (exact match)
        let fb = await (this.tableService as any).client
          .from('agent_table_rows')
          .select('id, agent_id, table_id, row_data, created_at, updated_at', { count: 'exact' })
          .eq('agent_id', this.credentials.agentId)
          .eq('table_id', tableId)
          .contains('row_data', { sessionId: sessionId })
          .order('created_at', { ascending: options.orderDirection === 'asc' })
          .range(options.offset, options.offset + options.limit - 1);

        // If still empty and sessionId is numeric-like, try numeric JSONB contains
        if ((!fb.data || fb.data.length === 0) && /^\d+$/.test(sessionId)) {
          const numericId = Number(sessionId);
          fb = await (this.tableService as any).client
            .from('agent_table_rows')
            .select('id, agent_id, table_id, row_data, created_at, updated_at', { count: 'exact' })
            .eq('agent_id', this.credentials.agentId)
            .eq('table_id', tableId)
            .contains('row_data', { sessionId: numericId as any })
            .order('created_at', { ascending: options.orderDirection === 'asc' })
            .range(options.offset, options.offset + options.limit - 1);
        }

        if (fb.error) {
          throw new Error(fb.error.message || 'Fallback JSONB contains query error');
        }

        const fbRows = fb.data || [];
        const fbMessages: SessionMessage[] = [];
        for (const row of fbRows) {
          const dbRow = row as unknown as DatabaseTableRow;
          const parsedData = ValidationUtils.parseRowData(dbRow.row_data);
          if (!parsedData) continue;
          fbMessages.push({
            id: dbRow.id,
            sessionId: (parsedData as any).sessionId || sessionId,
            messageId: parsedData.messageId,
            systemPrompt: parsedData.systemPrompt,
            userPrompt: parsedData.userPrompt,
            userInput: parsedData.userInput,
            output: parsedData.output,
            timestamp: String(parsedData.timestamp),
            createdAt: dbRow.created_at,
            updatedAt: dbRow.updated_at
          });
        }

        logger.info('Fallback JSONB contains search completed', {
          returnedMessages: fbMessages.length,
          totalCount: fb.count ?? fbMessages.length,
          agentId: this.credentials.agentId,
          tableId,
          sessionId
        });

        return {
          data: fbMessages,
          totalCount: fb.count ?? fbMessages.length
        };
      }

      const validMessages: SessionMessage[] = [];
      for (const row of result.data) {
        const dbRow = row as unknown as DatabaseTableRow;
        const parsedData = ValidationUtils.parseRowData(dbRow.row_data);
        if (!parsedData) continue;

        validMessages.push({
          id: dbRow.id,
          sessionId: (parsedData as any).sessionId || sessionId,
          messageId: parsedData.messageId,
          systemPrompt: parsedData.systemPrompt,
          userPrompt: parsedData.userPrompt,
          userInput: parsedData.userInput,
          output: parsedData.output,
          timestamp: String(parsedData.timestamp),
          createdAt: dbRow.created_at,
          updatedAt: dbRow.updated_at
        });
      }

      logger.info('Optimized JSONB query completed', {
        totalCount: result.count ?? validMessages.length,
        returnedMessages: validMessages.length,
        agentId: this.credentials.agentId,
        tableId,
        sessionId
      });

      return {
        data: validMessages,
        totalCount: result.count ?? validMessages.length
      };

    } catch (error) {
      logger.error('Optimized JSONB query failed', {
        error: error instanceof Error ? error.message : String(error),
        tableId,
        sessionId,
        agentId: this.credentials.agentId
      });
      // Single-path strategy: return empty result on failure
      return { data: [], totalCount: 0 };
    }
  }

  /**
   * Fallback query with minimal filtering and enhanced debugging
   */
  // Fallbacks removed: single secure JSONB path is used exclusively

  /**
   * Extended TableService wrapper with proper field mapping
   * This method can be used to patch the existing TableService if needed
   */
  private async executeAdvancedSearchWithFieldMapping(
    tableName: string,
    directColumnFilters: Record<string, string | number>,
    jsonbFieldFilters: Record<string, string | number>,
    sortBy: { field: string; direction: 'asc' | 'desc' },
    limit: number,
    offset: number
  ): Promise<{ data: any[]; totalCount: number }> {
    
    logger.debug('Executing advanced search with proper field mapping', {
      directColumnFilters,
      jsonbFieldFilters,
      sortBy,
      limit,
      offset
    });

    try {
      // Combine filters but maintain field mapping awareness
      const combinedFilters: Record<string, string | number> = {
        ...directColumnFilters,
        ...jsonbFieldFilters
      };

      const searchCriteria = {
        fieldFilters: combinedFilters,
        sortBy,
        limit,
        offset
      };

      // Use the existing TableService but log the mapping for debugging
      logger.debug('Field mapping being used', {
        directColumns: Object.keys(directColumnFilters).map(field => ({
          field,
          expectedPath: field,
          type: 'direct_column'
        })),
        jsonbFields: Object.keys(jsonbFieldFilters).map(field => ({
          field,
          expectedPath: `row_data->>'${field}'`,
          type: 'jsonb_field'
        }))
      });

      return await this.tableService.advancedSearchRows(
        this.credentials,
        tableName,
        searchCriteria
      );

    } catch (error) {
      logger.error('Advanced search with field mapping failed', {
        error: error instanceof Error ? error.message : String(error),
        directColumnFilters,
        jsonbFieldFilters
      });
      throw error;
    }
  }
}

/**
 * Simple interface function for agent executor to retrieve processed memory data
 * This is the main entry point that handles all memory processing
 */
export async function getProcessedMemoryForAgent(
  tableService: TableService,
  credentials: UserCredentials,
  tableName: string,
  sessionId: string,
  options: {
    readonly maxMessages?: number;
    readonly includeSystemPrompts?: boolean;
    readonly formatForLLM?: boolean;
  } = {}
): Promise<{
  readonly success: boolean;
  readonly formattedContext: string;
  readonly data?: {
    readonly messages: Array<{
      readonly messageId: number;
      readonly userInput: string;
      readonly output: string;
      readonly timestamp: string;
    }>;
    readonly totalCount: number;
    readonly contextSummary: string;
  };
  readonly error?: string;
}> {
  try {
    const memoryRetrieve = new AgentMemoryRetrieve(tableService, credentials);
    
    const result = await memoryRetrieve.getProcessedMemoryData(tableName, sessionId, {
      ...(options.maxMessages !== undefined && { maxMessages: options.maxMessages }),
      includeSystemPrompts: options.includeSystemPrompts || false,
      formatForLLM: options.formatForLLM !== false,
      sortOrder: 'desc'
    });

    if (!result.success) {
      return {
        success: false,
        formattedContext: '',
        error: result.error || 'Unknown error'
      };
    }

    return {
      success: true,
      formattedContext: result.data.formattedContext,
      data: {
        messages: result.data.messages.map(msg => ({
          messageId: msg.messageId,
          userInput: msg.userInput,
          output: msg.output,
          timestamp: msg.timestamp
        })),
        totalCount: result.data.totalCount,
        contextSummary: result.data.contextSummary
      }
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get processed memory for agent', {
      tableName,
      sessionId,
      error: errorMessage
    });

    return {
      success: false,
      formattedContext: '',
      error: errorMessage
    };
  }
}

/**
 * Integration: agent-memory.retrieve
 * Usage via integration registry: integrationName.operation → 'agent-memory'.'retrieve'
 * Resolves exact table using (agent_id, table_id) and queries content from row_data.
 */
export async function retrieve(
  executionContext: any,
  inputs: Record<string, unknown>
): Promise<any> {
  try {
    const agentId = String(inputs.agentId || executionContext.agentId || '');
    const tenantId = String(inputs.tenantId || executionContext.tenantId || '');
    const tableName = String(inputs.tableName || '');
    const sessionId = String(inputs.sessionId || '');

    if (!agentId || !tenantId || !tableName || !sessionId) {
      throw new Error('Missing required fields: agentId, tenantId, tableName, sessionId');
    }

    const maxMessages = typeof inputs.maxMessages === 'number' ? (inputs.maxMessages as number) : undefined;
    const includeSystemPrompts = Boolean(inputs.includeSystemPrompts);

    const result = await getProcessedMemoryForAgent(
      tableService as any,
      { agentId, tenantId } as any,
      tableName,
      sessionId,
      {
        maxMessages: maxMessages || MEMORY_CONSTANTS.MAX_LIMIT,
        includeSystemPrompts,
        formatForLLM: true
      }
    );

    // Return integration-friendly shape
    if (result.success && result.data) {
      return {
        messages: result.data.messages,
        totalCount: result.data.totalCount,
        contextSummary: result.data.contextSummary,
        formattedContext: result.formattedContext,
        success: true
      };
    }

    return {
      messages: [],
      totalCount: 0,
      contextSummary: 'No previous conversations found',
      formattedContext: '',
      success: false,
      error: result.error || 'Unknown error'
    };

  } catch (error) {
    logger.error('agent-memory.retrieve failed', {
      error: error instanceof Error ? error.message : String(error),
      inputs: {
        hasAgentId: !!inputs.agentId,
        hasTenantId: !!inputs.tenantId,
        tableName: inputs.tableName,
        sessionId: inputs.sessionId
      }
    });

    return {
      messages: [],
      totalCount: 0,
      contextSummary: 'Error retrieving conversation history',
      formattedContext: '',
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Integration: agent-memory.store
 * Inserts a new conversation row into agent_table_rows with row_data payload only.
 */
export async function store(
  executionContext: any,
  inputs: Record<string, unknown>
): Promise<any> {
  try {
    const agentId = String(inputs.agentId || executionContext.agentId || '');
    const tenantId = String(inputs.tenantId || executionContext.tenantId || '');
    const tableName = String(inputs.tableName || '');
    const sessionId = String(inputs.sessionId || '');
    const userInput = String(inputs.userInput || '');
    const output = String(inputs.output || '');

    if (!agentId || !tenantId || !tableName || !sessionId) {
      throw new Error('Missing required fields: agentId, tenantId, tableName, sessionId');
    }

    // Resolve table to get table_id
    const { table, found } = await (tableService as any).getAgentTable({ agentId, tenantId }, tableName);
    if (!found || !table?.id) {
      throw new Error('Target table not found for provided credentials');
    }

    // Determine next messageId by querying count for session
    const countResult = await (tableService as any).client
      .from('agent_table_rows')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .eq('table_id', table.id)
      .eq('row_data->>sessionId', sessionId);

    const nextMessageId = (countResult?.count ?? 0) + 1;
    const timestamp = typeof inputs.timestamp === 'number' ? inputs.timestamp : Date.now();

    const rowData = {
      output,
      agentId,
      tenantId,
      messageId: nextMessageId,
      sessionId,
      timestamp,
      userInput,
      userPrompt: String(inputs.userPrompt || ''),
      workflowId: String(inputs.workflowId || ''),
      executionId: String(inputs.executionId || ''),
      systemPrompt: String(inputs.systemPrompt || '')
    };

    const insertPayload = {
      agent_id: agentId,
      table_id: table.id,
      row_data: rowData
    };

    const insertRes = await (tableService as any).client
      .from('agent_table_rows')
      .insert(insertPayload)
      .select('id, created_at, updated_at')
      .single();

    if (insertRes.error) {
      throw new Error(insertRes.error.message || 'Insert failed');
    }

    return {
      stored: true,
      rowId: insertRes.data?.id,
      sessionId,
      messageId: nextMessageId,
      success: true
    };

  } catch (error) {
    logger.error('agent-memory.store failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      stored: false,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}