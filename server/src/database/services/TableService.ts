// path: database/services/TableService.ts
import { BaseRepository, PaginationOptions, PaginatedResult } from '../repositories/BaseRepository';
import { AgentTablesRepository } from '../repositories/AgentTablesColumnsRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';
import * as crypto from 'crypto';

// Type definitions - Fixed to match actual database schema
type AgentTable = Database['public']['Tables']['agent_tables']['Row'];
type AgentTableInsert = Database['public']['Tables']['agent_tables']['Insert'];
type AgentTableUpdate = Database['public']['Tables']['agent_tables']['Update'];

type AgentTableRow = Database['public']['Tables']['agent_table_rows']['Row'];
type AgentTableRowInsert = Database['public']['Tables']['agent_table_rows']['Insert'];
type AgentTableRowUpdate = Database['public']['Tables']['agent_table_rows']['Update'];

// Enhanced security types
export interface SecureCredentials {
  readonly agentId: string;
  readonly tenantId: string;
  readonly requestId?: string; // For audit trail
}

export interface SecurityContext {
  readonly credentials: SecureCredentials;
  readonly operation: string;
  readonly tableName: string;
  readonly startTime: number;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface SecurityValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly securityLevel: 'low' | 'medium' | 'high';
  readonly allowedOperations: readonly string[];
}

// Secure query types
export interface SecureQueryRequest {
  readonly credentials: SecureCredentials;
  readonly tableName: string;
  readonly filters: SecureQueryFilter[];
  readonly sorting?: SecureQuerySort;
  readonly pagination?: QueryPagination;
  readonly options?: SecureQueryOptions;
}

export interface SecureQueryFilter {
  readonly field: string;
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'contains';
  readonly value: any;
  readonly fieldType: 'direct' | 'jsonb' | 'auto';
  readonly sanitized?: boolean; // Flag to indicate if value has been sanitized
}

export interface SecureQuerySort {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
  readonly fieldType?: 'direct' | 'jsonb' | 'auto';
}

export interface QueryPagination {
  readonly limit: number;
  readonly offset: number;
}

export interface SecureQueryOptions {
  readonly includeCount?: boolean;
  readonly fallbackToClientFiltering?: boolean;
  readonly debugMode?: boolean;
  readonly maxRetries?: number;
  readonly enforceRowLevelSecurity?: boolean;
}

// Field mapping utility
class FieldMapping {
  private static readonly DIRECT_COLUMNS = [
    'id', 'agent_id', 'table_id', 'created_at', 'updated_at'
  ];

  private static readonly JSONB_FIELDS = [
    'sessionId', 'messageId', 'userInput', 'output', 'timestamp',
    'systemPrompt', 'userPrompt', 'executionId', 'workflowId',
    'row_data', 'metadata', 'context', 'state'
  ];

  static getFieldType(field: string): 'direct' | 'jsonb' | 'unknown' {
    if (this.DIRECT_COLUMNS.includes(field)) {
      return 'direct';
    }
    if (this.JSONB_FIELDS.includes(field)) {
      return 'jsonb';
    }
    return 'unknown';
  }

  static isDirectColumn(field: string): boolean {
    return this.DIRECT_COLUMNS.includes(field);
  }

  static isJsonbField(field: string): boolean {
    return this.JSONB_FIELDS.includes(field);
  }

  static getJsonbFieldPath(field: string): string {
    return `row_data->>'${field}'`;
  }

  static getJsonbContainsPath(field: string, value: any): string {
    return `row_data @> '{"${field}": "${value}"}'`;
  }
}

// Security validator class
class SecurityValidator {
  private static readonly AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
  private static readonly TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,50}$/;
  private static readonly TABLE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
  
  private static readonly SUSPICIOUS_PATTERNS = [
    /union\s+select/i,
    /drop\s+table/i,
    /delete\s+from/i,
    /update\s+.*set/i,
    /insert\s+into/i,
    /--/,
    /\/\*/,
    /xp_/i,
    /sp_/i,
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i
  ];

  static validateCredentials(credentials: SecureCredentials): SecurityValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate agentId
    if (!credentials.agentId || !this.AGENT_ID_PATTERN.test(credentials.agentId)) {
      errors.push('Invalid agentId format');
    }

    // Validate tenantId
    if (!credentials.tenantId || !this.TENANT_ID_PATTERN.test(credentials.tenantId)) {
      errors.push('Invalid tenantId format');
    }

    // Check for suspicious content
    const allValues = [credentials.agentId, credentials.tenantId].filter(Boolean);
    for (const value of allValues) {
      if (this.containsSuspiciousPatterns(value)) {
        errors.push('Suspicious content detected in credentials');
        break;
      }
    }

    // Determine security level
    let securityLevel: 'low' | 'medium' | 'high' = 'medium';
    if (errors.length > 0) {
      securityLevel = 'low';
    }

    // Define allowed operations based on security level
    let allowedOperations: string[] = [];
    switch (securityLevel as 'low' | 'medium' | 'high') {
      case 'high':
        allowedOperations = ['read', 'write', 'delete', 'admin'];
        break;
      case 'medium':
        allowedOperations = ['read', 'write'];
        break;
      case 'low':
        allowedOperations = ['read'];
        break;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      securityLevel,
      allowedOperations
    };
  }

  static validateTableAccess(
    credentials: SecureCredentials, 
    tableName: string, 
    operation: string
  ): SecurityValidationResult {
    const baseValidation = this.validateCredentials(credentials);
    
    if (!baseValidation.isValid) {
      return baseValidation;
    }

    const errors: string[] = [...baseValidation.errors];
    const warnings: string[] = [...baseValidation.warnings];

    // Validate table name
    if (!tableName || !this.TABLE_NAME_PATTERN.test(tableName)) {
      errors.push('Invalid table name format');
    }

    // Check if operation is allowed
    const operationMap: Record<string, string> = {
      'SELECT': 'read',
      'INSERT': 'write',
      'UPDATE': 'write',
      'DELETE': 'delete',
      'CREATE': 'admin',
      'DROP': 'admin'
    };

    const requiredPermission = operationMap[operation.toUpperCase()] || 'read';
    if (!baseValidation.allowedOperations.includes(requiredPermission)) {
      errors.push(`Operation '${operation}' not allowed for current security level`);
    }

    // Check for suspicious table names
    if (this.containsSuspiciousPatterns(tableName)) {
      errors.push('Suspicious content detected in table name');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      securityLevel: baseValidation.securityLevel,
      allowedOperations: baseValidation.allowedOperations
    };
  }

  static generateSecurityContext(
    credentials: SecureCredentials, 
    operation: string, 
    tableName: string,
    additionalInfo?: { ipAddress?: string; userAgent?: string }
  ): SecurityContext {
    return {
      credentials: {
        ...credentials,
        requestId: credentials.requestId || this.generateRequestId()
      },
      operation,
      tableName,
      startTime: Date.now(),
      ...(additionalInfo?.ipAddress && { ipAddress: additionalInfo.ipAddress }),
      ...(additionalInfo?.userAgent && { userAgent: additionalInfo.userAgent })
    };
  }

  private static containsSuspiciousPatterns(input: string): boolean {
    return this.SUSPICIOUS_PATTERNS.some(pattern => pattern.test(input));
  }

  private static generateRequestId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}

// Audit logger for security events
class SecurityAuditor {
  static logSecurityEvent(
    event: 'access_granted' | 'access_denied' | 'suspicious_activity' | 'credential_validation',
    context: SecurityContext,
    details?: any
  ): void {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      event,
      agentId: context.credentials.agentId,
      tenantId: context.credentials.tenantId,
      requestId: context.credentials.requestId,
      operation: context.operation,
      tableName: context.tableName,
      executionTimeMs: Date.now() - context.startTime,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      details
    };

    // Log at appropriate level
    switch (event) {
      case 'access_denied':
      case 'suspicious_activity':
        logger.warn('Security event', auditEntry);
        break;
      case 'credential_validation':
        logger.info('Security validation', auditEntry);
        break;
      default:
        logger.debug('Security audit', auditEntry);
    }
  }
}

// Core interfaces (keeping for backward compatibility)
export interface UserCredentials {
  readonly agentId: string;
  readonly tenantId: string;
}

export interface TableSearchResult {
  readonly table: AgentTable | null;
  readonly found: boolean;
  readonly searchCriteria: {
    readonly agentId: string;
    readonly tenantId: string;
    readonly tableName: string;
  };
}

export interface TableWithRowsOptions extends PaginationOptions {
  readonly includeRowCount?: boolean;
}

export interface TableWithRows {
  readonly table: AgentTable;
  readonly rows: PaginatedResult<AgentTableRow>;
  readonly totalRowCount: number;
}

export interface BulkOperationResult {
  readonly successful: string[];
  readonly failed: {
    readonly rowId: string;
    readonly error: string;
  }[];
  readonly totalProcessed: number;
}

export interface CreateTableRequest {
  readonly tableData: AgentTableInsert;
  readonly initialRows?: readonly AgentTableRowInsert[];
}

export interface TableStats {
  readonly totalTables: number;
  readonly tablesWithRows: number;
  readonly totalRows: number;
  readonly averageRowsPerTable: number;
  readonly tablesByAgent: Readonly<Record<string, number>>;
}

// Custom errors
export class TableNotFoundError extends Error {
  public readonly name = 'TableNotFoundError';
  
  constructor(agentId: string, tenantId: string, tableName: string) {
    super(`Table not found: ${tableName} for agent: ${agentId}, tenant: ${tenantId}`);
  }
}

export class TableValidationError extends Error {
  public readonly name = 'TableValidationError';
  
  constructor(message: string) {
    super(`Table validation failed: ${message}`);
  }
}

export class RowOperationError extends Error {
  public readonly name = 'RowOperationError';
  
  constructor(operation: string, details: string) {
    super(`Row ${operation} failed: ${details}`);
  }
}

export class CredentialsError extends Error {
  public readonly name = 'CredentialsError';
  
  constructor(message: string) {
    super(`Credentials validation failed: ${message}`);
  }
}

// Main service class
export class TableService {
  private agentTablesRepository: AgentTablesRepository;
  private readonly maxQueryTimeMs: number = 30000; // 30 second timeout
  private readonly maxResultLimit: number = 1000;
  
  constructor() {
    this.agentTablesRepository = new AgentTablesRepository();
  }

  // Get client access through repository
  private get client(): any {
    return (this.agentTablesRepository as any).client;
  }

  // Compatibility wrappers for methods previously inherited from BaseRepository
  async findById(id: string): Promise<AgentTable | null> {
    const { data, error } = await this.client
      .from('agent_tables')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return null;
    return (data as AgentTable) || null;
  }

  async update(id: string, update: AgentTableUpdate): Promise<AgentTable> {
    const { data, error } = await this.client
      .from('agent_tables')
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Update table failed: ${error.message}`);
    return data as AgentTable;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('agent_tables')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`Delete table failed: ${error.message}`);
  }

  // Find by agent and name
  async findByAgentAndName(agentId: string, tableName: string): Promise<AgentTable | null> {
    return await this.agentTablesRepository.findByAgentAndName(agentId, tableName);
  }

  // Create table
  async create(tableData: AgentTableInsert): Promise<AgentTable> {
    return await this.agentTablesRepository.create(tableData);
  }

  /**
   * Process and validate column metadata
   */
  private processColumnMetadata(columns: any): any {
    if (!Array.isArray(columns)) {
      logger.warn('TableService.processColumnMetadata: columns is not an array', { columns });
      return [];
    }

    const processedColumns = columns.map((col, index) => {
      // Ensure required fields are present
      const processedCol = {
        name: col.name || `column_${index}`,
        type: col.type || 'varchar(255)',
        required: Boolean(col.required),
        primary_key: Boolean(col.primary_key),
        ...col
      };

      // Validate column name
      if (!processedCol.name || typeof processedCol.name !== 'string') {
        throw new Error(`Invalid column name at index ${index}: ${processedCol.name}`);
      }

      // Validate column type
      if (!processedCol.type || typeof processedCol.type !== 'string') {
        throw new Error(`Invalid column type at index ${index}: ${processedCol.type}`);
      }

      return processedCol;
    });

    logger.info('TableService.processColumnMetadata: processed columns', {
      originalCount: columns.length,
      processedCount: processedColumns.length,
      columns: processedColumns
    });

    return processedColumns;
  }

  /**
   * Execute secure query with multi-layer validation
   */
  async executeSecureQuery<T = any>(request: SecureQueryRequest): Promise<{
    data: readonly T[];
    totalCount: number;
    security: {
      validated: boolean;
      securityLevel: 'low' | 'medium' | 'high';
      auditTrail: string;
    };
    performance: {
      queryTimeMs: number;
      strategy: string;
    };
  }> {
    const context = SecurityValidator.generateSecurityContext(
      request.credentials,
      'SELECT',
      request.tableName
    );

    try {
      // Step 1: Validate credentials and permissions
      const securityValidation = SecurityValidator.validateTableAccess(
        request.credentials,
        request.tableName,
        'SELECT'
      );

      SecurityAuditor.logSecurityEvent('credential_validation', context, {
        validation: securityValidation
      });

      if (!securityValidation.isValid) {
        SecurityAuditor.logSecurityEvent('access_denied', context, {
          errors: securityValidation.errors
        });
        throw new Error(`Access denied: ${securityValidation.errors.join(', ')}`);
      }

      // Step 2: Validate and resolve table with ownership verification
      const tableVerification = await this.verifyTableOwnership(request.credentials, request.tableName);
      if (!tableVerification.isOwner || !tableVerification.tableId) {
        SecurityAuditor.logSecurityEvent('access_denied', context, {
          reason: 'table_ownership_verification_failed',
          tableId: tableVerification.tableId
        });
        throw new Error('Table access denied: ownership verification failed');
      }

      SecurityAuditor.logSecurityEvent('access_granted', context, {
        tableId: tableVerification.tableId,
        securityLevel: securityValidation.securityLevel
      });

      // Step 3: Execute query with mandatory security filters
      const queryResult = await this.executeSecureQueryWithFilters(
        request,
        tableVerification.tableId,
        context
      );

      const performance = {
        queryTimeMs: Date.now() - context.startTime,
        strategy: 'database_secure'
      };

      // Step 4: Verify all returned data belongs to the agent
      const verifiedData = this.verifyDataOwnership(queryResult.data, request.credentials) as readonly T[];

      logger.info('Secure query executed successfully', {
        agentId: request.credentials.agentId,
        tableName: request.tableName,
        resultCount: verifiedData.length,
        queryTimeMs: performance.queryTimeMs,
        requestId: context.credentials.requestId
      });

      return {
        data: verifiedData,
        totalCount: queryResult.totalCount,
        security: {
          validated: true,
          securityLevel: securityValidation.securityLevel,
          auditTrail: context.credentials.requestId || 'no-request-id'
        },
        performance
      };

    } catch (error) {
      SecurityAuditor.logSecurityEvent('suspicious_activity', context, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      logger.error('Secure query failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: request.credentials.agentId,
        tableName: request.tableName,
        requestId: context.credentials.requestId
      });

      throw error;
    }
  }

  /**
   * Verify table ownership - critical security function
   */
  private async verifyTableOwnership(
    credentials: SecureCredentials, 
    tableName: string
  ): Promise<{
    isOwner: boolean;
    tableId: string | null;
    verificationDetails: any;
  }> {
    try {
      // Query with explicit agent_id and tenant verification
      const { data, error } = await this.client
        .from('agent_tables')
        .select('id, agent_id, table_name, created_at')
        .eq('agent_id', credentials.agentId)
        .eq('table_name', tableName)
        .maybeSingle();

      if (error) {
        logger.error('Table ownership verification query failed', {
          error: error.message,
          agentId: credentials.agentId,
          tableName
        });
        return {
          isOwner: false,
          tableId: null,
          verificationDetails: { error: error.message }
        };
      }

      const isOwner = data !== null && data.agent_id === credentials.agentId;
      
      return {
        isOwner,
        tableId: data?.id || null,
        verificationDetails: {
          found: data !== null,
          agentIdMatch: data?.agent_id === credentials.agentId,
          tableId: data?.id,
          createdAt: data?.created_at
        }
      };

    } catch (error) {
      logger.error('Table ownership verification failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tableName
      });

      return {
        isOwner: false,
        tableId: null,
        verificationDetails: { 
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Execute query with mandatory security filters
   */
  private async executeSecureQueryWithFilters<T>(
    request: SecureQueryRequest,
    tableId: string,
    context: SecurityContext
  ): Promise<{ data: T[]; totalCount: number }> {
    
    // Build base query with MANDATORY security filters that cannot be bypassed
    let baseQuery = this.client
      .from('agent_table_rows')
      .select('*')
      .eq('table_id', tableId)           // MANDATORY: Must match verified table
      .eq('agent_id', request.credentials.agentId); // MANDATORY: Must match agent

    let countQuery = this.client
      .from('agent_table_rows')
      .select('*', { count: 'exact', head: true })
      .eq('table_id', tableId)           // MANDATORY: Must match verified table
      .eq('agent_id', request.credentials.agentId); // MANDATORY: Must match agent

    // Apply additional filters (these are user-requested, but still validated)
    for (const filter of request.filters) {
      const sanitizedFilter = this.sanitizeFilter(filter);
      
      if (!sanitizedFilter.isValid) {
        logger.warn('Invalid filter skipped in secure query', {
          field: filter.field,
          operator: filter.operator,
          reason: sanitizedFilter.reason,
          agentId: request.credentials.agentId
        });
        continue;
      }

      // Apply the validated filter
      try {
        const filterExpr = this.buildSecureFilterExpression(sanitizedFilter.filter!);
        
        switch (filterExpr.operator) {
          case 'eq':
            baseQuery = baseQuery.eq(filterExpr.field, filterExpr.value);
            countQuery = countQuery.eq(filterExpr.field, filterExpr.value);
            break;
          case 'contains':
            baseQuery = baseQuery.filter(filterExpr.field, 'cs', filterExpr.value);
            countQuery = countQuery.filter(filterExpr.field, 'cs', filterExpr.value);
            break;
          case 'like':
            baseQuery = baseQuery.like(filterExpr.field, filterExpr.value);
            countQuery = countQuery.like(filterExpr.field, filterExpr.value);
            break;
          case 'ilike':
            baseQuery = baseQuery.ilike(filterExpr.field, filterExpr.value);
            countQuery = countQuery.ilike(filterExpr.field, filterExpr.value);
            break;
          case 'gt':
            baseQuery = baseQuery.gt(filterExpr.field, filterExpr.value);
            countQuery = countQuery.gt(filterExpr.field, filterExpr.value);
            break;
          case 'gte':
            baseQuery = baseQuery.gte(filterExpr.field, filterExpr.value);
            countQuery = countQuery.gte(filterExpr.field, filterExpr.value);
            break;
          case 'lt':
            baseQuery = baseQuery.lt(filterExpr.field, filterExpr.value);
            countQuery = countQuery.lt(filterExpr.field, filterExpr.value);
            break;
          case 'lte':
            baseQuery = baseQuery.lte(filterExpr.field, filterExpr.value);
            countQuery = countQuery.lte(filterExpr.field, filterExpr.value);
            break;
          case 'in':
            baseQuery = baseQuery.in(filterExpr.field, filterExpr.value);
            countQuery = countQuery.in(filterExpr.field, filterExpr.value);
            break;
        }
      } catch (filterError) {
        logger.warn('Filter application failed in secure query', {
          field: filter.field,
          error: filterError instanceof Error ? filterError.message : String(filterError),
          agentId: request.credentials.agentId
        });
      }
    }

    // Apply sorting (with validation)
    if (request.sorting) {
      const safeSortField = this.validateSortField(request.sorting.field);
      if (safeSortField) {
        baseQuery = baseQuery.order(safeSortField, { 
          ascending: request.sorting.direction === 'asc' 
        });
      }
    } else {
      baseQuery = baseQuery.order('created_at', { ascending: false });
    }

    // Apply pagination limits
    const safeLimit = Math.min(
      request.pagination?.limit || 50,
      this.maxResultLimit
    );
    const safeOffset = Math.max(request.pagination?.offset || 0, 0);

    baseQuery = baseQuery.limit(safeLimit);
    if (safeOffset > 0) {
      baseQuery = baseQuery.range(safeOffset, safeOffset + safeLimit - 1);
    }

    // Execute with timeout
    const queryPromise = Promise.all([
      baseQuery,
      countQuery
    ]);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Query timeout')), this.maxQueryTimeMs);
    });

    const [{ data, error }, { count, error: countError }] = await Promise.race([
      queryPromise,
      timeoutPromise
    ]) as any;

    if (error) {
      throw new Error(`Secure query failed: ${error.message}`);
    }

    return {
      data: (data as T[]) || [],
      totalCount: count || 0
    };
  }

  /**
   * Verify that all returned data actually belongs to the requesting agent
   * This is a final security check to prevent any data leakage
   */
  private verifyDataOwnership<T>(data: T[], credentials: SecureCredentials): T[] {
    return data.filter(row => {
      const typedRow = row as any;
      
      // Check direct agent_id column
      if (typedRow.agent_id !== credentials.agentId) {
        logger.warn('Data ownership violation detected and prevented', {
          expectedAgentId: credentials.agentId,
          actualAgentId: typedRow.agent_id,
          rowId: typedRow.id
        });
        return false;
      }

      return true;
    });
  }

  /**
   * Sanitize and validate filters for security
   */
  private sanitizeFilter(filter: SecureQueryFilter): {
    isValid: boolean;
    filter?: SecureQueryFilter;
    reason?: string;
  } {
    // Check for SQL injection patterns
    const suspiciousValue = typeof filter.value === 'string' && 
      SecurityValidator['containsSuspiciousPatterns'](filter.value);
    
    if (suspiciousValue) {
      return {
        isValid: false,
        reason: 'Suspicious content in filter value'
      };
    }

    // Validate field names
    const validFields = [
      'sessionId', 'messageId', 'userInput', 'output', 'timestamp',
      'systemPrompt', 'userPrompt', 'executionId', 'workflowId',
      'created_at', 'updated_at', 'id', 'agent_id', 'table_id'
    ];

    if (!validFields.includes(filter.field)) {
      return {
        isValid: false,
        reason: 'Invalid field name'
      };
    }

    // Sanitize string values
    let sanitizedValue = filter.value;
    if (typeof filter.value === 'string') {
      sanitizedValue = filter.value.replace(/[<>'"]/g, ''); // Basic sanitization
    }

    return {
      isValid: true,
      filter: {
        ...filter,
        value: sanitizedValue,
        sanitized: true
      }
    };
  }

  /**
   * Build secure filter expression with validation
   */
  private buildSecureFilterExpression(filter: SecureQueryFilter): {
    field: string;
    operator: string;
    value: any;
  } {
    const isDirectColumn = FieldMapping.isDirectColumn(filter.field);
    
    let field: string;
    let operator: string = filter.operator;
    let value: any = filter.value;

    if (isDirectColumn) {
      field = filter.field;
    } else {
      // JSONB field
      if (filter.operator === 'contains') {
        field = 'row_data';
        operator = 'cs';
        value = JSON.stringify({ [filter.field]: filter.value });
      } else {
        field = FieldMapping.getJsonbFieldPath(filter.field);
        value = String(filter.value);
      }
    }

    return { field, operator, value };
  }

  /**
   * Validate sort field for security
   */
  private validateSortField(field: string): string | null {
    const validSortFields = [
      'created_at', 'updated_at', 'id',
      'row_data->\'messageId\'', 'row_data->\'timestamp\''
    ];

    if (validSortFields.includes(field)) {
      return field;
    }

    // Allow JSONB fields but sanitize
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) {
      return FieldMapping.getJsonbFieldPath(field);
    }

    return null; // Invalid field, use default
  }

  /**
   * Find a table by user credentials and table name with enhanced security
   * Note: Searches by agent_id and table_name (assuming no tenant_id in current schema)
   */
  async getAgentTable(credentials: UserCredentials, tableName: string): Promise<TableSearchResult> {
    // Convert UserCredentials to SecureCredentials for security validation
    const secureCredentials: SecureCredentials = {
      agentId: credentials.agentId,
      tenantId: credentials.tenantId,
      requestId: crypto.randomBytes(16).toString('hex')
    };

    const context = SecurityValidator.generateSecurityContext(
      secureCredentials,
      'SELECT',
      tableName
    );

    try {
      logger.info('TableService.getAgentTable: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        requestId: context.credentials.requestId
      });

      // Enhanced security validation
      const securityValidation = SecurityValidator.validateTableAccess(
        secureCredentials,
        tableName,
        'SELECT'
      );

      SecurityAuditor.logSecurityEvent('credential_validation', context, {
        validation: securityValidation
      });

      if (!securityValidation.isValid) {
        SecurityAuditor.logSecurityEvent('access_denied', context, {
          errors: securityValidation.errors
        });
        throw new Error(`Access denied: ${securityValidation.errors.join(', ')}`);
      }

      // Search by agent_id and table_name (tenant_id not in current schema)
      const { data, error } = await this.client
        .from('agent_tables')
        .select('*')
        .eq('agent_id', credentials.agentId)
        .eq('table_name', tableName)
        .maybeSingle();

      if (error) {
        logger.error('TableService.getAgentTable: database error', {
          error: error.message,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          errorCode: error.code,
          requestId: context.credentials.requestId
        });
        throw new Error(`Failed to get agent table: ${error.message}`);
      }

      const found = data !== null;
      const result: TableSearchResult = {
        table: data as AgentTable | null,
        found,
        searchCriteria: {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        }
      };

      if (found && data) {
        SecurityAuditor.logSecurityEvent('access_granted', context, {
          tableId: data.id,
          securityLevel: securityValidation.securityLevel
        });
        
        logger.info('TableService.getAgentTable: table found', {
          tableId: data.id,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          createdAt: data.created_at,
          requestId: context.credentials.requestId
        });
      } else {
        logger.warn('TableService.getAgentTable: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          requestId: context.credentials.requestId
        });
      }

      return result;
    } catch (error) {
      SecurityAuditor.logSecurityEvent('suspicious_activity', context, {
        error: error instanceof Error ? error.message : String(error)
      });

      logger.error('TableService.getAgentTable: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        requestId: context.credentials.requestId
      });
      throw error;
    }
  }

  /**
   * Get rows by user credentials and table name with pagination
   */
  async getRowsByCredentials(
    credentials: UserCredentials,
    tableName: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<AgentTableRow>> {
    try {
      logger.info('TableService.getRowsByCredentials: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        page: options.page,
        limit: options.limit
      });

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        logger.warn('TableService.getRowsByCredentials: table not found, returning empty result', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
        
        return { 
          data: [], 
          totalCount: 0, 
          page: options.page ?? 1, 
          limit: options.limit ?? 50, 
          totalPages: 0 
        };
      }

      const rows = await this.getTableRows(tableResult.table.id, options);
      
      logger.info('TableService.getRowsByCredentials: operation completed', {
        tableId: tableResult.table.id,
        rowCount: rows.data.length,
        totalCount: rows.totalCount,
        page: rows.page
      });

      return rows;
    } catch (error) {
      logger.error('TableService.getRowsByCredentials: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName
      });
      throw error;
    }
  }

  /**
   * Get a specific row by credentials, table name, and row ID
   */
  async getRowByCredentials(
    credentials: UserCredentials,
    tableName: string,
    rowId: string
  ): Promise<AgentTableRow | null> {
    try {
      logger.info('TableService.getRowByCredentials: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowId
      });

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        logger.warn('TableService.getRowByCredentials: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
        return null;
      }

      const { data, error } = await this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId)
        .eq('id', rowId)
        .maybeSingle();

      if (error) {
        logger.error('TableService.getRowByCredentials: database error', {
          error: error.message,
          tableId: tableResult.table.id,
          rowId,
          errorCode: error.code
        });
        throw new RowOperationError('fetch_single', error.message);
      }

      const row = data as AgentTableRow | null;

      if (row) {
        logger.info('TableService.getRowByCredentials: row found', {
          tableId: tableResult.table.id,
          rowId: row.id,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
      } else {
        logger.warn('TableService.getRowByCredentials: row not found', {
          tableId: tableResult.table.id,
          rowId,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
      }

      return row;
    } catch (error) {
      logger.error('TableService.getRowByCredentials: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowId
      });
      throw error;
    }
  }

  /**
   * Get multiple rows by their IDs using credentials and table name
   */
  async getRowsByIds(
    credentials: UserCredentials,
    tableName: string,
    rowIds: readonly string[]
  ): Promise<AgentTableRow[]> {
    try {
      logger.info('TableService.getRowsByIds: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowCount: rowIds.length
      });

      if (rowIds.length === 0) {
        logger.info('TableService.getRowsByIds: no row IDs provided', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
        return [];
      }

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        logger.warn('TableService.getRowsByIds: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
        return [];
      }

      const { data, error } = await this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId)
        .in('id', rowIds)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('TableService.getRowsByIds: database error', {
          error: error.message,
          tableId: tableResult.table.id,
          rowIds,
          errorCode: error.code
        });
        throw new RowOperationError('fetch_multiple', error.message);
      }

      const rows = data as AgentTableRow[] || [];

      logger.info('TableService.getRowsByIds: operation completed', {
        tableId: tableResult.table.id,
        requestedCount: rowIds.length,
        foundCount: rows.length,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName
      });

      return rows;
    } catch (error) {
      logger.error('TableService.getRowsByIds: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowIds
      });
      throw error;
    }
  }

  /**
   * Get the most recent N rows from a table using credentials
   */
  async getRecentRows(
    credentials: UserCredentials,
    tableName: string,
    count: number = 10
  ): Promise<AgentTableRow[]> {
    try {
      logger.info('TableService.getRecentRows: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        count
      });

      // Validate count parameter
      if (count <= 0 || count > 1000) {
        throw new TableValidationError('count must be between 1 and 1000');
      }

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        logger.warn('TableService.getRecentRows: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
        return [];
      }

      const { data, error } = await this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId)
        .order('created_at', { ascending: false })
        .limit(count);

      if (error) {
        logger.error('TableService.getRecentRows: database error', {
          error: error.message,
          tableId: tableResult.table.id,
          count,
          errorCode: error.code
        });
        throw new RowOperationError('fetch_recent', error.message);
      }

      const rows = data as AgentTableRow[] || [];

      logger.info('TableService.getRecentRows: operation completed', {
        tableId: tableResult.table.id,
        requestedCount: count,
        returnedCount: rows.length,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName
      });

      return rows;
    } catch (error) {
      logger.error('TableService.getRecentRows: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        count
      });
      throw error;
    }
  }

  /**
   * FIXED: Search for data within rows using various search strategies
   * Note: Uses 'row_data' field with proper JSONB syntax
   */
  async searchRowData(
    credentials: UserCredentials,
    tableName: string,
    searchOptions: {
      readonly query: string;
      readonly searchType?: 'text' | 'exact' | 'partial' | 'json_path';
      readonly searchColumns?: readonly string[];
      readonly caseSensitive?: boolean;
      readonly limit?: number;
      readonly includeHighlight?: boolean;
    },
    paginationOptions: PaginationOptions = {}
  ): Promise<PaginatedResult<AgentTableRow & { searchScore?: number; highlights?: string[] }>> {
    try {
      logger.info('TableService.searchRowData: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        searchQuery: searchOptions.query,
        searchType: searchOptions.searchType || 'text',
        searchColumns: searchOptions.searchColumns,
        caseSensitive: searchOptions.caseSensitive || false
      });

      const { 
        query: searchQuery, 
        searchType = 'text',
        searchColumns,
        caseSensitive = false,
        limit: searchLimit = 100
      } = searchOptions;

      // Validate search query
      if (!searchQuery?.trim()) {
        throw new TableValidationError('search query is required and cannot be empty');
      }

      if (searchLimit > 1000) {
        throw new TableValidationError('search limit cannot exceed 1000');
      }

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        logger.warn('TableService.searchRowData: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
        
        return { 
          data: [], 
          totalCount: 0, 
          page: paginationOptions.page ?? 1, 
          limit: paginationOptions.limit ?? 50, 
          totalPages: 0 
        };
      }

      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = paginationOptions;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let baseQuery = this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId);

      let countQuery = this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId);

      // FIXED: Apply search based on type - using correct JSONB syntax
      switch (searchType) {
        case 'text':
          // Full-text search in row_data column (assuming JSONB)
          baseQuery = baseQuery.textSearch('row_data', `'${searchQuery}'`);
          countQuery = countQuery.textSearch('row_data', `'${searchQuery}'`);
          break;

        case 'exact':
          // FIXED: Exact match in row_data column with correct syntax
          if (searchColumns && searchColumns.length > 0) {
            // Search in specific columns with proper JSONB syntax
            const orConditions = searchColumns.map(col => `row_data->>'${col}'.eq.${searchQuery}`).join(',');
            baseQuery = baseQuery.or(orConditions);
            countQuery = countQuery.or(orConditions);
          } else {
            // Search in entire row_data object using text search
            baseQuery = baseQuery.ilike('row_data::text', `%${searchQuery}%`);
            countQuery = countQuery.ilike('row_data::text', `%${searchQuery}%`);
          }
          break;

        case 'partial':
          // FIXED: Partial/fuzzy search using ilike with correct syntax
          if (searchColumns && searchColumns.length > 0) {
            const orConditions = searchColumns
              .map(col => caseSensitive 
                ? `row_data->>'${col}'.like.%${searchQuery}%` 
                : `row_data->>'${col}'.ilike.%${searchQuery}%`
              ).join(',');
            baseQuery = baseQuery.or(orConditions);
            countQuery = countQuery.or(orConditions);
          } else {
            // Search in entire row_data as text
            if (caseSensitive) {
              baseQuery = baseQuery.like('row_data::text', `%${searchQuery}%`);
              countQuery = countQuery.like('row_data::text', `%${searchQuery}%`);
            } else {
              baseQuery = baseQuery.ilike('row_data::text', `%${searchQuery}%`);
              countQuery = countQuery.ilike('row_data::text', `%${searchQuery}%`);
            }
          }
          break;

        case 'json_path':
          // JSONPath search for complex nested searches
          baseQuery = baseQuery.or(`row_data @@ '$.** ? (@.type() == "string" && @ like_regex "${searchQuery}")'`);
          countQuery = countQuery.or(`row_data @@ '$.** ? (@.type() == "string" && @ like_regex "${searchQuery}")'`);
          break;

        default:
          throw new TableValidationError(`Unsupported search type: ${searchType}`);
      }

      // Get total count
      const { count, error: countError } = await countQuery;

      if (countError) {
        logger.error('TableService.searchRowData: count query failed', {
          error: countError.message,
          tableId: tableResult.table.id,
          searchQuery,
          searchType,
          errorCode: countError.code
        });
        throw new RowOperationError('search_count', countError.message);
      }

      // Get paginated results
      const { data, error } = await baseQuery
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .limit(Math.min(searchLimit, limit))
        .range(from, to);

      if (error) {
        logger.error('TableService.searchRowData: database error', {
          error: error.message,
          tableId: tableResult.table.id,
          searchQuery,
          searchType,
          errorCode: error.code
        });
        throw new RowOperationError('search', error.message);
      }

      const rows = data as AgentTableRow[] || [];
      const totalCount = count ?? 0;
      const totalPages = Math.ceil(totalCount / limit);

      // Add search scoring and highlighting if requested
      const processedRows = rows.map(row => {
        const processedRow = { ...row } as AgentTableRow & { searchScore?: number; highlights?: string[] };
        
        if (searchOptions.includeHighlight) {
          // Simple highlighting logic - can be enhanced
          const highlights: string[] = [];
          const dataStr = row.row_data ? JSON.stringify(row.row_data) : '';
          
          if (!dataStr) {
            processedRow.highlights = [];
            processedRow.searchScore = 0;
            return processedRow;
          }
          
          const queryLower = searchQuery.toLowerCase();
          
          if (dataStr.toLowerCase().includes(queryLower)) {
            // Extract context around matches
            const matches = dataStr.toLowerCase().split(queryLower);
            for (let i = 1; i < matches.length; i++) {
              const start = Math.max(0, matches.slice(0, i).join(queryLower).length - 50);
              const end = Math.min(dataStr.length, start + 100);
              highlights.push(dataStr.substring(start, end));
            }
          }
          
          processedRow.highlights = highlights;
          processedRow.searchScore = highlights.length; // Simple scoring
        }

        return processedRow;
      });

      logger.info('TableService.searchRowData: operation completed', {
        tableId: tableResult.table.id,
        searchQuery,
        searchType,
        foundRows: rows.length,
        totalCount,
        page,
        totalPages
      });

      return {
        data: processedRows,
        totalCount,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error('TableService.searchRowData: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        searchQuery: searchOptions.query
      });
      throw error;
    }
  }

  /**
   * FIXED: Advanced search with multiple criteria and ranking
   * Note: Uses 'row_data' field with proper JSONB syntax
   */
  async advancedSearchRows(
    credentials: UserCredentials,
    tableName: string,
    searchCriteria: {
      readonly textSearch?: string;
      readonly fieldFilters?: Record<string, any>;
      readonly dateRange?: {
        readonly from: string;
        readonly to: string;
        readonly field?: string; // which date field to use, defaults to 'created_at'
      };
      readonly numericRange?: {
        readonly field: string;
        readonly min?: number;
        readonly max?: number;
      };
      readonly sortBy?: {
        readonly field: string;
        readonly direction: 'asc' | 'desc';
      };
      readonly limit?: number;
    },
    paginationOptions: PaginationOptions = {}
  ): Promise<PaginatedResult<AgentTableRow>> {
    try {
      logger.info('TableService.advancedSearchRows: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        searchCriteria
      });

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      logger.debug('Table lookup result', {
        tableName,
        found: tableResult.found,
        tableId: tableResult.table?.id,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId
      });
      
      if (!tableResult.found || !tableResult.table) {
        logger.warn('TableService.advancedSearchRows: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
        
        return { 
          data: [], 
          totalCount: 0, 
          page: paginationOptions.page ?? 1, 
          limit: paginationOptions.limit ?? 50, 
          totalPages: 0 
        };
      }

      const { page = 1, limit = 50 } = paginationOptions;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let baseQuery = this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId); // Add direct agent_id filter

      let countQuery = this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId); // Add direct agent_id filter

      logger.debug('Base query filters applied', {
        tableId: tableResult.table.id,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId
      });

      // Skip expensive DEBUG queries in production

      // Apply text search using row_data field
      if (searchCriteria.textSearch?.trim()) {
        // Use simple text search on JSONB fields with proper escaping
        const searchTerm = searchCriteria.textSearch.trim();
        // Use ilike for text search on JSONB::text cast (proper Supabase syntax)
        baseQuery = baseQuery.ilike('row_data::text', `%${searchTerm}%`);
        countQuery = countQuery.ilike('row_data::text', `%${searchTerm}%`);
      }

      // FIXED: Apply field filters using correct JSONB syntax
      if (searchCriteria.fieldFilters) {
        logger.debug('Applying field filters', {
          fieldFilters: searchCriteria.fieldFilters,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId
        });
        
        for (const [field, value] of Object.entries(searchCriteria.fieldFilters)) {
          if (value !== undefined && value !== null) {
            // Skip agent_id and table_id as they are already handled as direct column filters
            if (field === 'agent_id' || field === 'table_id') {
              logger.debug('Skipping direct column filter (already applied)', { field, value });
              continue;
            }
            // Guard: ignore pre-escaped JSONB path expressions; require simple field names
            if (field.includes('->')) {
              logger.warn('Ignoring malformed JSONB field filter; use simple field name', { field, value });
              continue;
            }
            
            // Handle nested JSONB field access (e.g., 'row_data.sessionId')
            if (field.includes('.')) {
              const parts = field.split('.');
              if (parts[0] === 'row_data' && parts.length === 2) {
                // Use direct JSONB field access for nested fields
                const filterField = `row_data->>'${parts[1]}'`;
                const stringValue = String(value); // Ensure value is string for JSONB comparison
                logger.debug('Applying nested field filter', { field, filterField, value, stringValue });
                baseQuery = baseQuery.eq(filterField, stringValue);
                countQuery = countQuery.eq(filterField, stringValue);
              } else {
                // Fallback to direct field access
                const filterField = `row_data->>'${field}'`;
                const stringValue = String(value); // Ensure value is string for JSONB comparison
                logger.debug('Applying fallback field filter', { field, filterField, value, stringValue });
                baseQuery = baseQuery.eq(filterField, stringValue);
                countQuery = countQuery.eq(filterField, stringValue);
              }
            } else {
              // Apply direct field filter
            if (field === 'sessionId') {
                // Use indexed equality on row_data->>'sessionId' to avoid JSONB contains scans
                const filterField = `row_data->>'sessionId'`;
                const stringValue = String(value);
                baseQuery = baseQuery.eq(filterField, stringValue);
                countQuery = countQuery.eq(filterField, stringValue);
              } else {
                // Regular JSONB field filter
                const filterField = `row_data->>'${field}'`;
                const stringValue = String(value);
                logger.debug('Applying direct field filter', { field, filterField, value, stringValue });
                baseQuery = baseQuery.eq(filterField, stringValue);
                countQuery = countQuery.eq(filterField, stringValue);
              }
            }
          }
        }
      }

      // Apply date range
      if (searchCriteria.dateRange) {
        const dateField = searchCriteria.dateRange.field || 'created_at';
        if (searchCriteria.dateRange.from) {
          baseQuery = baseQuery.gte(dateField, searchCriteria.dateRange.from);
          countQuery = countQuery.gte(dateField, searchCriteria.dateRange.from);
        }
        if (searchCriteria.dateRange.to) {
          baseQuery = baseQuery.lte(dateField, searchCriteria.dateRange.to);
          countQuery = countQuery.lte(dateField, searchCriteria.dateRange.to);
        }
      }

      // FIXED: Apply numeric range using correct JSONB syntax
      if (searchCriteria.numericRange) {
        const { field, min, max } = searchCriteria.numericRange;
        if (min !== undefined) {
          // Use filter with proper JSONB numeric casting syntax
          const minFilter = `(row_data->>'${field}')::numeric.gte.${min}`;
          baseQuery = baseQuery.filter(minFilter);
          countQuery = countQuery.filter(minFilter);
        }
        if (max !== undefined) {
          const maxFilter = `(row_data->>'${field}')::numeric.lte.${max}`;
          baseQuery = baseQuery.filter(maxFilter);
          countQuery = countQuery.filter(maxFilter);
        }
      }

      // Get count
      const { count, error: countError } = await countQuery;
      
      if (countError) {
        logger.error('TableService.advancedSearchRows: count query failed', {
          error: countError.message,
          tableId: tableResult.table.id,
          searchCriteria,
          errorCode: countError.code
        });
        throw new RowOperationError('advanced_search_count', countError.message);
      }

      // Apply sorting
      const sortBy = searchCriteria.sortBy || { field: 'created_at', direction: 'desc' };
      if (sortBy.field.startsWith('row_data.')) {
        // FIXED: Sort by row_data field with correct syntax
        const dataField = sortBy.field.replace('row_data.', '');
        baseQuery = baseQuery.order(`row_data->>'${dataField}'`, { ascending: sortBy.direction === 'asc' });
      } else {
        // Sort by table column
        baseQuery = baseQuery.order(sortBy.field, { ascending: sortBy.direction === 'asc' });
      }

      // Apply limit and pagination
      const searchLimit = Math.min(searchCriteria.limit || 1000, 1000);
      
      logger.debug('Executing final query', {
        tableId: tableResult.table.id,
        agentId: credentials.agentId,
        orderBy: sortBy.field,
        orderDirection: sortBy.direction,
        from,
        to,
        searchLimit,
        totalCount: count
      });

      const { data, error } = await baseQuery
        .limit(Math.min(searchLimit, limit))
        .range(from, to);

      logger.debug('Query execution result', {
        dataLength: data?.length || 0,
        totalCount: count,
        hasError: !!error,
        errorMessage: error?.message,
        sampleData: data?.slice(0, 2) // Show first 2 rows for debugging
      });

      if (error) {
        logger.error('TableService.advancedSearchRows: database error', {
          error: error.message,
          tableId: tableResult.table.id,
          searchCriteria,
          errorCode: error.code
        });
        throw new RowOperationError('advanced_search', error.message);
      }

      const rows = data as AgentTableRow[] || [];
      const totalCount = count ?? 0;
      const totalPages = Math.ceil(totalCount / limit);

      logger.info('TableService.advancedSearchRows: operation completed', {
        tableId: tableResult.table.id,
        foundRows: rows.length,
        totalCount,
        page,
        totalPages,
        searchCriteria
      });

      return {
        data: rows,
        totalCount,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error('TableService.advancedSearchRows: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        searchCriteria
      });
      throw error;
    }
  }

  /**
   * Insert a single row by user credentials and table name
   */
  async insertRowByCredentials(
    credentials: UserCredentials,
    tableName: string,
    rowData: AgentTableRowInsert
  ): Promise<AgentTableRow> {
    try {
      logger.info('TableService.insertRowByCredentials: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName
      });

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        const error = new TableNotFoundError(credentials.agentId, credentials.tenantId, tableName);
        logger.error('TableService.insertRowByCredentials: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          error: error.message
        });
        throw error;
      }

      const normalized: AgentTableRowInsert = {
        ...rowData,
        agent_id: credentials.agentId,
        table_id: tableResult.table.id
      } as AgentTableRowInsert;

      const inserted = await this.bulkInsertRows(tableResult.table.id, [normalized]);
      
      if (!inserted[0]) {
        const error = new RowOperationError('insert', 'No row returned from insert operation');
        logger.error('TableService.insertRowByCredentials: insert failed', {
          tableId: tableResult.table.id,
          error: error.message
        });
        throw error;
      }

      logger.info('TableService.insertRowByCredentials: operation completed', {
        tableId: tableResult.table.id,
        rowId: inserted[0].id,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName
      });

      return inserted[0];
    } catch (error) {
      logger.error('TableService.insertRowByCredentials: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName
      });
      throw error;
    }
  }

  /**
   * Update a single row by credentials, table name, and row ID
   */
  async updateRowByCredentials(
    credentials: UserCredentials,
    tableName: string,
    rowId: string,
    updateData: AgentTableRowUpdate
  ): Promise<AgentTableRow | null> {
    try {
      logger.info('TableService.updateRowByCredentials: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowId
      });

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        const error = new TableNotFoundError(credentials.agentId, credentials.tenantId, tableName);
        logger.error('TableService.updateRowByCredentials: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          error: error.message
        });
        throw error;
      }

      const { data, error } = await this.client
        .from('agent_table_rows')
        .update(updateData)
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId)
        .eq('id', rowId)
        .select()
        .maybeSingle();

      if (error) {
        logger.error('TableService.updateRowByCredentials: database error', {
          error: error.message,
          tableId: tableResult.table.id,
          rowId,
          errorCode: error.code
        });
        throw new RowOperationError('update', error.message);
      }

      const updatedRow = data as AgentTableRow | null;

      if (updatedRow) {
        logger.info('TableService.updateRowByCredentials: operation completed', {
          tableId: tableResult.table.id,
          rowId: updatedRow.id,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
      } else {
        logger.warn('TableService.updateRowByCredentials: row not found for update', {
          tableId: tableResult.table.id,
          rowId,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        });
      }

      return updatedRow;
    } catch (error) {
      logger.error('TableService.updateRowByCredentials: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowId
      });
      throw error;
    }
  }

  /**
   * Delete a single row by credentials, table name, and row ID
   */
  async deleteRowByCredentials(
    credentials: UserCredentials,
    tableName: string,
    rowId: string
  ): Promise<boolean> {
    try {
      logger.info('TableService.deleteRowByCredentials: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowId
      });

      const tableResult = await this.getAgentTable(credentials, tableName);
      
      if (!tableResult.found || !tableResult.table) {
        const error = new TableNotFoundError(credentials.agentId, credentials.tenantId, tableName);
        logger.error('TableService.deleteRowByCredentials: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          error: error.message
        });
        throw error;
      }

      const { error } = await this.client
        .from('agent_table_rows')
        .delete()
        .eq('table_id', tableResult.table.id)
        .eq('agent_id', credentials.agentId)
        .eq('id', rowId);

      if (error) {
        logger.error('TableService.deleteRowByCredentials: database error', {
          error: error.message,
          tableId: tableResult.table.id,
          rowId,
          errorCode: error.code
        });
        throw new RowOperationError('delete', error.message);
      }

      logger.info('TableService.deleteRowByCredentials: operation completed', {
        tableId: tableResult.table.id,
        rowId,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName
      });

      return true;
    } catch (error) {
      logger.error('TableService.deleteRowByCredentials: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        rowId
      });
      throw error;
    }
  }

  /**
   * Create table with optional initial rows atomically
   */
  async createTableWithRows(request: CreateTableRequest): Promise<TableWithRows> {
    try {
      logger.info('TableService.createTableWithRows: starting operation', {
        agentId: request.tableData?.agent_id,
        tableName: request.tableData?.table_name,
        initialRowCount: request.initialRows?.length ?? 0,
        columns: request.tableData?.columns
      });
      
      this.validateTableData(request.tableData);
      
      // Process and validate column metadata
      const processedTableData = {
        ...request.tableData,
        columns: this.processColumnMetadata(request.tableData.columns)
      };

      const table = await this.agentTablesRepository.create(processedTableData);
      
      logger.info('TableService.createTableWithRows: table created', {
        tableId: table.id,
        agentId: table.agent_id,
        tableName: table.table_name,
        columns: table.columns,
        columnsCount: Array.isArray(table.columns) ? table.columns.length : 0
      });
      
      let rows: PaginatedResult<AgentTableRow> = {
        data: [],
        totalCount: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      };

      let totalRowCount = 0;

      if (request.initialRows && request.initialRows.length > 0) {
        const rowsToInsert = request.initialRows.map(row => ({
          ...row,
          table_id: table.id,
        }));

        const insertedRows = await this.bulkInsertRows(table.id, rowsToInsert);
        
        rows = {
          data: insertedRows,
          totalCount: insertedRows.length,
          page: 1,
          limit: insertedRows.length,
          totalPages: 1,
        };
        
        totalRowCount = insertedRows.length;

        logger.info('TableService.createTableWithRows: initial rows inserted', {
          tableId: table.id,
          insertedRowCount: insertedRows.length
        });
      }

      logger.info('TableService.createTableWithRows: operation completed', {
        tableId: table.id,
        finalRowCount: totalRowCount
      });

      return { table, rows, totalRowCount };
    } catch (error) {
      logger.error('TableService.createTableWithRows: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        agentId: request.tableData?.agent_id,
        tableName: request.tableData?.table_name
      });
      throw error;
    }
  }

  /**
   * Get all tables for an agent with optional row statistics
   */
  async getAgentTables(
    agentId: string,
    includeRowCounts = false
  ): Promise<readonly (AgentTable & { readonly rowCount?: number })[]> {
    try {
      logger.info('TableService.getAgentTables: starting operation', {
        agentId,
        includeRowCounts
      });
      
      const tables = await this.agentTablesRepository.findByAgent(agentId);
      
      if (includeRowCounts) {
        // Get row counts for each table
        const tablesWithCounts = await Promise.all(
          tables.map(async (table) => {
            try {
              const { data, error } = await this.client
                .from('agent_table_rows')
                .select('*', { count: 'exact', head: true })
                .eq('table_id', table.id);
              
              if (error) {
                logger.warn('Failed to get row count for table', { tableId: table.id, error: error.message });
                return { ...table, rowCount: 0 };
              }
              
              return { ...table, rowCount: data?.length ?? 0 };
            } catch (error) {
              logger.warn('Error getting row count for table', { tableId: table.id, error });
              return { ...table, rowCount: 0 };
            }
          })
        );
        
        logger.info('TableService.getAgentTables: operation completed with row counts', {
          agentId,
          tableCount: tablesWithCounts.length
        });
        
        return tablesWithCounts;
      }

      logger.info('TableService.getAgentTables: operation completed', {
        agentId,
        tableCount: tables.length
      });

      return tables;
    } catch (error) {
      logger.error('TableService.getAgentTables: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        agentId 
      });
      throw error;
    }
  }

  /**
   * Get paginated rows for a specific table
   */
  async getTableRows(
    tableId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<AgentTableRow>> {
    try {
      logger.info('TableService.getTableRows: starting operation', {
        tableId,
        page: options.page,
        limit: options.limit
      });
      
      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { count } = await this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId);

      const { data, error } = await this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('TableService.getTableRows: database error', { 
          error: error.message,
          tableId,
          errorCode: error.code
        });
        throw new RowOperationError('fetch', error.message);
      }

      if (!data) {
        const error = new RowOperationError('fetch', 'No data returned from query');
        logger.error('TableService.getTableRows: no data returned', { tableId });
        throw error;
      }

      const totalCount = count ?? 0;
      const totalPages = Math.ceil(totalCount / limit);

      logger.info('TableService.getTableRows: operation completed', {
        tableId,
        rowsReturned: data.length,
        totalCount,
        page,
        totalPages
      });

      return {
        data: data as AgentTableRow[],
        totalCount,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error('TableService.getTableRows: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        tableId
      });
      throw error;
    }
  }

  /**
   * Get total row count for a table
   */
  async getTableRowCount(tableId: string): Promise<number> {
    try {
      logger.info('TableService.getTableRowCount: starting operation', { tableId });
      
      const { count, error } = await this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId);

      if (error) {
        logger.error('TableService.getTableRowCount: database error', { 
          error: error.message,
          tableId,
          errorCode: error.code
        });
        throw new RowOperationError('count', error.message);
      }

      const result = count ?? 0;
      
      logger.info('TableService.getTableRowCount: operation completed', {
        tableId,
        rowCount: result
      });

      return result;
    } catch (error) {
      logger.error('TableService.getTableRowCount: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        tableId 
      });
      throw error;
    }
  }

  /**
   * Bulk insert rows into a table
   * Note: This method operates at table level and should be used with proper access control
   * to ensure the calling code has permission to modify the specified table
   */
  async bulkInsertRows(tableId: string, rows: readonly AgentTableRowInsert[]): Promise<AgentTableRow[]> {
    try {
      logger.info('TableService.bulkInsertRows: starting operation', {
        tableId,
        rowCount: rows.length
      });
      
      const tableExists = await this.findById(tableId);
      if (!tableExists) {
        const error = new TableNotFoundError('unknown', 'unknown', 'unknown');
        logger.error('TableService.bulkInsertRows: table not found', {
          tableId,
          error: error.message
        });
        throw error;
      }

      if (rows.length === 0) {
        logger.info('TableService.bulkInsertRows: no rows to insert', { tableId });
        return [];
      }

      const normalizedRows = rows.map(row => ({
        ...row,
        table_id: tableId,
      }));

      const { data, error } = await this.client
        .from('agent_table_rows')
        .insert(normalizedRows as any)
        .select();

      if (error) {
        logger.error('TableService.bulkInsertRows: database error', { 
          error: error.message,
          tableId,
          errorCode: error.code
        });
        throw new RowOperationError('bulk_insert', error.message);
      }

      if (!data) {
        const error = new RowOperationError('bulk_insert', 'No data returned from insert operation');
        logger.error('TableService.bulkInsertRows: no data returned', { tableId });
        throw error;
      }

      logger.info('TableService.bulkInsertRows: operation completed', { 
        tableId, 
        insertedCount: data.length
      });
      
      return data as AgentTableRow[];
    } catch (error) {
      logger.error('TableService.bulkInsertRows: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        tableId
      });
      throw error;
    }
  }

  /**
   * Bulk update rows
   * Note: This method operates at table level and should be used with proper access control
   * to ensure the calling code has permission to modify the specified table
   */
  async bulkUpdateRows(
    tableId: string,
    updates: Array<{ rowId: string; data: AgentTableRowUpdate }>
  ): Promise<BulkOperationResult> {
    const successful: string[] = [];
    const failed: Array<{ rowId: string; error: string }> = [];

    try {
      logger.info('TableService.bulkUpdateRows: starting operation', {
        tableId,
        updateCount: updates.length
      });
      
      const tableExists = await this.findById(tableId);
      if (!tableExists) {
        const error = new TableNotFoundError('unknown', 'unknown', 'unknown');
        logger.error('TableService.bulkUpdateRows: table not found', {
          tableId,
          error: error.message
        });
        throw error;
      }

      const batchSize = 50;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async ({ rowId, data }) => {
          try {
            const { error } = await this.client
              .from('agent_table_rows')
              .update(data)
              .eq('id', rowId)
              .eq('table_id', tableId);

            if (error) {
              failed.push({ rowId, error: error.message });
            } else {
              successful.push(rowId);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            failed.push({ rowId, error: errorMsg });
          }
        });

        await Promise.allSettled(batchPromises);
      }

      logger.info('TableService.bulkUpdateRows: operation completed', {
        tableId,
        successful: successful.length,
        failed: failed.length,
        totalProcessed: updates.length,
      });

      return {
        successful,
        failed,
        totalProcessed: updates.length,
      };
    } catch (error) {
      logger.error('TableService.bulkUpdateRows: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        tableId
      });
      throw error;
    }
  }

  /**
   * Bulk delete rows
   * Note: This method operates at table level and should be used with proper access control
   * to ensure the calling code has permission to modify the specified table
   */
  async bulkDeleteRows(tableId: string, rowIds: readonly string[]): Promise<BulkOperationResult> {
    try {
      logger.info('TableService.bulkDeleteRows: starting operation', {
        tableId,
        rowCount: rowIds.length
      });
      
      const tableExists = await this.findById(tableId);
      if (!tableExists) {
        const error = new TableNotFoundError('unknown', 'unknown', 'unknown');
        logger.error('TableService.bulkDeleteRows: table not found', {
          tableId,
          error: error.message
        });
        throw error;
      }

      if (rowIds.length === 0) {
        logger.info('TableService.bulkDeleteRows: no rows to delete', { tableId });
        return { successful: [], failed: [], totalProcessed: 0 };
      }

      const { error } = await this.client
        .from('agent_table_rows')
        .delete()
        .eq('table_id', tableId)
        .in('id', rowIds);

      if (error) {
        logger.error('TableService.bulkDeleteRows: database error', { 
          error: error.message,
          tableId,
          errorCode: error.code
        });
        throw new RowOperationError('bulk_delete', error.message);
      }

      logger.info('TableService.bulkDeleteRows: operation completed', { 
        tableId, 
        deletedCount: rowIds.length 
      });

      return {
        successful: [...rowIds],
        failed: [],
        totalProcessed: rowIds.length,
      };
    } catch (error) {
      logger.error('TableService.bulkDeleteRows: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        tableId
      });
      throw error;
    }
  }

  /**
   * Get comprehensive table statistics
   */
  async getTableStats(agentId?: string): Promise<TableStats> {
    try {
      logger.info('TableService.getTableStats: starting operation', { agentId });
      
      let baseQuery = this.client
        .from('agent_tables')
        .select(`id, agent_id, agent_table_rows(count)`);

      if (agentId) {
        baseQuery = baseQuery.eq('agent_id', agentId);
      }

      const { data: tables, error } = await baseQuery;

      if (error) {
        logger.error('TableService.getTableStats: database error', { 
          error: error.message,
          agentId,
          errorCode: error.code
        });
        throw new Error(`Failed to get table stats: ${error.message}`);
      }

      if (!tables) {
        logger.warn('TableService.getTableStats: no tables found', { agentId });
        return {
          totalTables: 0,
          tablesWithRows: 0,
          totalRows: 0,
          averageRowsPerTable: 0,
          tablesByAgent: {},
        };
      }

      const totalTables = tables.length;
      const tablesWithRows = tables.filter((t: any) => {
        const rowCount = (t.agent_table_rows as any)?.[0]?.count ?? 0;
        return rowCount > 0;
      }).length;
      
      const totalRows = tables.reduce((sum: number, t: any) => {
        const rowCount = (t.agent_table_rows as any)?.[0]?.count ?? 0;
        return sum + rowCount;
      }, 0);
      
      const averageRowsPerTable = totalTables > 0 ? totalRows / totalTables : 0;

      const tablesByAgent: Record<string, number> = {};
      for (const table of tables) {
        const agentId = table.agent_id;
        tablesByAgent[agentId] = (tablesByAgent[agentId] ?? 0) + 1;
      }

      const result = {
        totalTables,
        tablesWithRows,
        totalRows,
        averageRowsPerTable: Math.round(averageRowsPerTable * 100) / 100,
        tablesByAgent,
      };

      logger.info('TableService.getTableStats: operation completed', {
        agentId,
        ...result
      });

      return result;
    } catch (error) {
      logger.error('TableService.getTableStats: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        agentId 
      });
      throw error;
    }
  }

  /**
   * Delete table and all its rows atomically
   */
  async deleteTableWithRows(tableId: string): Promise<void> {
    try {
      logger.info('TableService.deleteTableWithRows: starting operation', { tableId });
      
      const table = await this.findById(tableId);
      if (!table) {
        const error = new TableNotFoundError('unknown', 'unknown', 'unknown');
        logger.error('TableService.deleteTableWithRows: table not found', {
          tableId,
          error: error.message
        });
        throw error;
      }

      // Delete all rows first (foreign key constraint)
      const { error: rowsError } = await this.client
        .from('agent_table_rows')
        .delete()
        .eq('table_id', tableId);

      if (rowsError) {
        logger.error('TableService.deleteTableWithRows: failed to delete table rows', { 
          error: rowsError.message,
          tableId,
          errorCode: rowsError.code
        });
        throw new RowOperationError('delete_all', rowsError.message);
      }

      // Delete the table
      await this.delete(tableId);

      logger.info('TableService.deleteTableWithRows: operation completed', { 
        tableId,
        agentId: table.agent_id,
        tableName: table.table_name
      });
    } catch (error) {
      logger.error('TableService.deleteTableWithRows: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        tableId 
      });
      throw error;
    }
  }

  /**
   * Clean up orphaned rows (rows without valid table references)
   */
  async cleanupOrphanedRows(): Promise<number> {
    try {
      logger.info('TableService.cleanupOrphanedRows: starting operation');

      // Find orphaned rows using proper LEFT JOIN query
      const { data: orphanedRows, error: findError } = await this.client
        .from('agent_table_rows')
        .select('id')
        .not(
          'table_id',
          'in',
          '(SELECT id FROM agent_tables)'
        );

      if (findError) {
        logger.error('TableService.cleanupOrphanedRows: failed to find orphaned rows', {
          error: findError.message,
          errorCode: findError.code
        });
        throw new RowOperationError('cleanup_find', findError.message);
      }

      if (!orphanedRows || orphanedRows.length === 0) {
        logger.info('TableService.cleanupOrphanedRows: no orphaned rows found');
        return 0;
      }

      // Ensure orphanedRows is an array of objects with an 'id' property
      const orphanedIds = Array.isArray(orphanedRows)
        ? orphanedRows
            .filter((row: any) => row && typeof row.id !== 'undefined')
            .map((row: any) => row.id)
        : [];

      // Delete orphaned rows in batches
      const batchSize = 100;
      let totalDeleted = 0;

      for (let i = 0; i < orphanedIds.length; i += batchSize) {
        const batch = orphanedIds.slice(i, i + batchSize);
        
        const { error: deleteError } = await this.client
          .from('agent_table_rows')
          .delete()
          .in('id', batch);

        if (deleteError) {
          logger.error('TableService.cleanupOrphanedRows: batch delete failed', {
            error: deleteError.message,
            batchSize: batch.length,
            errorCode: deleteError.code
          });
          // Continue with next batch instead of throwing
          continue;
        }

        totalDeleted += batch.length;
      }

      logger.info('TableService.cleanupOrphanedRows: operation completed', {
        orphanedFound: orphanedIds.length,
        totalDeleted
      });

      return totalDeleted;
    } catch (error) {
      logger.error('TableService.cleanupOrphanedRows: operation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Convert UserCredentials to SecureCredentials for enhanced security
   */
  private toSecureCredentials(credentials: UserCredentials): SecureCredentials {
    return {
      agentId: credentials.agentId,
      tenantId: credentials.tenantId,
      requestId: crypto.randomBytes(16).toString('hex')
    };
  }

  /**
   * Enhanced security validation using SecurityValidator
   */
  private validateCredentialsSecure(credentials: UserCredentials): SecurityValidationResult {
    const secureCredentials = this.toSecureCredentials(credentials);
    return SecurityValidator.validateCredentials(secureCredentials);
  }

  /**
   * Private validation methods (keeping for backward compatibility)
   */
  private validateCredentials(credentials: UserCredentials): void {
    if (!credentials.agentId?.trim()) {
      throw new CredentialsError('agentId is required and cannot be empty');
    }
    
    if (!credentials.tenantId?.trim()) {
      throw new CredentialsError('tenantId is required and cannot be empty');
    }

    if (credentials.agentId.length > 255) {
      throw new CredentialsError('agentId must be 255 characters or less');
    }
    
    if (credentials.tenantId.length > 255) {
      throw new CredentialsError('tenantId must be 255 characters or less');
    }
  }

  private validateTableName(tableName: string): void {
    if (!tableName?.trim()) {
      throw new TableValidationError('table name is required and cannot be empty');
    }
    
    if (tableName.length > 255) {
      throw new TableValidationError('table name must be 255 characters or less');
    }

    const validTableNameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!validTableNameRegex.test(tableName)) {
      throw new TableValidationError('table name can only contain letters, numbers, underscores, and hyphens');
    }
  }

  private validateTableData(tableData: AgentTableInsert): void {
    if (!tableData.agent_id?.trim()) {
      throw new TableValidationError('agent_id is required and cannot be empty');
    }
    
    if (!tableData.table_name?.trim()) {
      throw new TableValidationError('table name is required and cannot be empty');
    }

    if (tableData.agent_id.length > 255) {
      throw new TableValidationError('agent_id must be 255 characters or less');
    }

    this.validateTableName(tableData.table_name);
  }

  /**
   * Secure method to get table with enhanced security validation
   */
  async getAgentTableSecure(credentials: SecureCredentials, tableName: string): Promise<TableSearchResult> {
    const context = SecurityValidator.generateSecurityContext(
      credentials,
      'SELECT',
      tableName
    );

    try {
      logger.info('TableService.getAgentTableSecure: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        requestId: context.credentials.requestId
      });

      // Enhanced security validation
      const securityValidation = SecurityValidator.validateTableAccess(
        credentials,
        tableName,
        'SELECT'
      );

      SecurityAuditor.logSecurityEvent('credential_validation', context, {
        validation: securityValidation
      });

      if (!securityValidation.isValid) {
        SecurityAuditor.logSecurityEvent('access_denied', context, {
          errors: securityValidation.errors
        });
        throw new Error(`Access denied: ${securityValidation.errors.join(', ')}`);
      }

      // Search by agent_id and table_name
      const { data, error } = await this.client
        .from('agent_tables')
        .select('*')
        .eq('agent_id', credentials.agentId)
        .eq('table_name', tableName)
        .maybeSingle();

      if (error) {
        logger.error('TableService.getAgentTableSecure: database error', {
          error: error.message,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          errorCode: error.code,
          requestId: context.credentials.requestId
        });
        throw new Error(`Failed to get agent table: ${error.message}`);
      }

      const found = data !== null;
      const result: TableSearchResult = {
        table: data as AgentTable | null,
        found,
        searchCriteria: {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName
        }
      };

      if (found && data) {
        SecurityAuditor.logSecurityEvent('access_granted', context, {
          tableId: data.id,
          securityLevel: securityValidation.securityLevel
        });
        
        logger.info('TableService.getAgentTableSecure: table found', {
          tableId: data.id,
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          createdAt: data.created_at,
          requestId: context.credentials.requestId
        });
      } else {
        logger.warn('TableService.getAgentTableSecure: table not found', {
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          tableName,
          requestId: context.credentials.requestId
        });
      }

      return result;
    } catch (error) {
      SecurityAuditor.logSecurityEvent('suspicious_activity', context, {
        error: error instanceof Error ? error.message : String(error)
      });

      logger.error('TableService.getAgentTableSecure: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        requestId: context.credentials.requestId
      });
      throw error;
    }
  }

  /**
   * Secure method to insert row with enhanced security validation
   */
  async insertRowSecure(
    credentials: SecureCredentials,
    tableName: string,
    rowData: AgentTableRowInsert
  ): Promise<AgentTableRow> {
    const context = SecurityValidator.generateSecurityContext(
      credentials,
      'INSERT',
      tableName
    );

    try {
      logger.info('TableService.insertRowSecure: starting operation', {
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        requestId: context.credentials.requestId
      });

      // Enhanced security validation
      const securityValidation = SecurityValidator.validateTableAccess(
        credentials,
        tableName,
        'INSERT'
      );

      SecurityAuditor.logSecurityEvent('credential_validation', context, {
        validation: securityValidation
      });

      if (!securityValidation.isValid) {
        SecurityAuditor.logSecurityEvent('access_denied', context, {
          errors: securityValidation.errors
        });
        throw new Error(`Access denied: ${securityValidation.errors.join(', ')}`);
      }

      // Verify table ownership
      const tableVerification = await this.verifyTableOwnership(credentials, tableName);
      if (!tableVerification.isOwner) {
        SecurityAuditor.logSecurityEvent('access_denied', context, {
          reason: 'table_ownership_verification_failed',
          tableId: tableVerification.tableId
        });
        throw new Error('Table access denied: ownership verification failed');
      }

      if (!tableVerification.tableId) {
        throw new Error('Table ID not found during ownership verification');
      }

      const normalized: AgentTableRowInsert = {
        ...rowData,
        agent_id: credentials.agentId,
        table_id: tableVerification.tableId
      } as AgentTableRowInsert;

      const inserted = await this.bulkInsertRows(tableVerification.tableId, [normalized]);
      
      if (!inserted[0]) {
        const error = new RowOperationError('insert', 'No row returned from insert operation');
        logger.error('TableService.insertRowSecure: insert failed', {
          tableId: tableVerification.tableId,
          error: error.message,
          requestId: context.credentials.requestId
        });
        throw error;
      }

      SecurityAuditor.logSecurityEvent('access_granted', context, {
        tableId: tableVerification.tableId,
        rowId: inserted[0].id,
        securityLevel: securityValidation.securityLevel
      });

      logger.info('TableService.insertRowSecure: operation completed', {
        tableId: tableVerification.tableId,
        rowId: inserted[0].id,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        requestId: context.credentials.requestId
      });

      return inserted[0];
    } catch (error) {
      SecurityAuditor.logSecurityEvent('suspicious_activity', context, {
        error: error instanceof Error ? error.message : String(error)
      });

      logger.error('TableService.insertRowSecure: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: credentials.agentId,
        tenantId: credentials.tenantId,
        tableName,
        requestId: context.credentials.requestId
      });
      throw error;
    }
  }
}

export default new TableService();

// Export types for external use
export type { 
  AgentTable, 
  AgentTableRow, 
  AgentTableRowInsert,
  AgentTableInsert,
  AgentTableUpdate,
  AgentTableRowUpdate
};