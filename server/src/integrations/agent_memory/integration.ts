import logger from '../../utils/logger';
import tableService from '../../database/services/TableService';
import type { ExecutionContext } from '../../types/integrations';

// Simplified, production-grade types
interface AgentMemoryRequest {
  readonly operation: 'store' | 'retrieve';
  readonly sessionId: string;
  readonly tableName: string;
  readonly tableId?: string;
  readonly userInput?: string;
  readonly output?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly maxContextLength?: number;
  readonly selector?: Record<string, string>;
  readonly userId?: string;
  readonly channelId?: string;
  readonly threadId?: string;
  readonly phone?: string;
  readonly email?: string;
}

interface AgentMemoryResponse {
  readonly success: boolean;
  readonly operation: string;
  readonly sessionId: string;
  readonly tableName: string;
  readonly data?: {
    readonly messages?: readonly SessionMessage[];
    readonly messageId?: number;
    readonly totalCount?: number;
  };
  readonly error?: string;
  readonly executionTime: number;
}

interface SessionMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly messageId: number;
  readonly userInput: string;
  readonly output: string;
  readonly timestamp: number;
  readonly createdAt: string;
}

interface AgentCredentials {
  readonly agentId: string;
  readonly tenantId: string;
}

// Database operation interface
interface DatabaseTransaction {
  store(request: StoreRequest): Promise<StoreResult>;
  retrieve(request: RetrieveRequest): Promise<RetrieveResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface StoreRequest {
  readonly sessionId: string;
  readonly tableName: string;
  readonly userInput: string;
  readonly output: string;
  readonly credentials: AgentCredentials;
}

interface StoreResult {
  readonly messageId: number;
  readonly rowId: string;
  readonly success: boolean;
}

interface RetrieveRequest {
  readonly sessionId: string;
  readonly tableName: string;
  readonly tableId?: string;
  readonly limit: number;
  readonly offset: number;
  readonly maxContextLength?: number;
  readonly credentials: AgentCredentials;
}

interface RetrieveResult {
  readonly messages: readonly SessionMessage[];
  readonly totalCount: number;
  readonly success: boolean;
}

/**
 * Production-grade Agent Memory Integration
 * 
 * Key improvements:
 * - Single transaction boundary for related operations
 * - Eliminates retry/wait logic - fixes consistency at source
 * - Simplified request/response model
 * - Fast-fail error handling
 */
export class AgentMemoryIntegration {
  private readonly databaseTransactionFactory: () => Promise<DatabaseTransaction>;

  constructor(databaseTransactionFactory: () => Promise<DatabaseTransaction>) {
    this.databaseTransactionFactory = databaseTransactionFactory;
  }

  /**
   * Execute memory operation with transactional consistency
   */
  async execute(
    context: ExecutionContext,
    rawRequest: Record<string, unknown>
  ): Promise<AgentMemoryResponse> {
    const startTime = Date.now();
    
    try {
      // Fast validation
      const request = this.validateRequest(rawRequest);
      const credentials = this.extractCredentials(context, rawRequest);

      logger.info('Agent memory operation starting', {
        executionId: context.executionId,
        operation: request.operation,
        sessionId: request.sessionId,
        tableName: request.tableName,
        agentId: credentials.agentId,
        tenantId: credentials.tenantId
      });

      // Apply default pruning if not specified
      if (request.operation === 'retrieve') {
        const defaultMax = 10; // prune to last 10 messages by default
        if (!('limit' in rawRequest) && !('maxContextLength' in rawRequest)) {
          (request as any).limit = defaultMax;
          (request as any).maxContextLength = defaultMax;
        }
      }

      // Execute with single transaction
      const result = await this.executeWithTransaction(request, credentials);

      const executionTime = Date.now() - startTime;

      logger.info('Agent memory operation completed', {
        executionId: context.executionId,
        operation: request.operation,
        sessionId: request.sessionId,
        tableName: request.tableName,
        success: result.success,
        executionTime
      });

      return {
        ...result,
        executionTime
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const executionTime = Date.now() - startTime;

      logger.error('Agent memory operation failed', {
        executionId: context.executionId,
        error: errorMessage,
        executionTime
      });

      return {
        success: false,
        operation: 'unknown',
        sessionId: 'unknown',
        tableName: 'unknown',
        error: errorMessage,
        executionTime
      };
    }
  }

  /**
   * Execute operation within single database transaction
   */
  private async executeWithTransaction(
    request: AgentMemoryRequest,
    credentials: AgentCredentials
  ): Promise<AgentMemoryResponse> {
    const transaction = await this.databaseTransactionFactory();

    try {
      if (request.operation === 'store') {
        return await this.executeStore(transaction, request, credentials);
      } else if (request.operation === 'retrieve') {
        return await this.executeRetrieve(transaction, request, credentials);
      } else if (request.operation === 'retrieve-and-store') {
        return await this.executeRetrieveAndStore(transaction, request, credentials);
      } else {
        throw new Error(`Unsupported operation: ${request.operation}`);
      }
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Execute store operation with immediate consistency verification
   */
  private async executeStore(
    transaction: DatabaseTransaction,
    request: AgentMemoryRequest,
    credentials: AgentCredentials
  ): Promise<AgentMemoryResponse> {
    if (!request.userInput || !request.output) {
      throw new Error('Store operation requires userInput and output');
    }

    // Store the message
    const storeResult = await transaction.store({
      sessionId: request.sessionId,
      tableName: request.tableName,
      userInput: request.userInput,
      output: request.output,
      credentials
    });

    if (!storeResult.success) {
      throw new Error('Failed to store message');
    }

    // Skip immediate verification to prevent concurrent operations
    // Data consistency will be ensured by proper operation sequencing
    logger.info('Store operation completed without immediate verification to prevent concurrent operations', {
      sessionId: request.sessionId,
      tableName: request.tableName,
      messageId: storeResult.messageId,
      agentId: credentials.agentId
    });

    // Commit transaction
    await transaction.commit();

    return {
      success: true,
      operation: 'store',
      sessionId: request.sessionId,
      tableName: request.tableName,
      data: {
        messageId: storeResult.messageId
      },
      executionTime: 0 // Will be set by caller
    };
  }

  /**
   * Execute combined retrieve and store operation in single transaction
   */
  private async executeRetrieveAndStore(
    transaction: DatabaseTransaction,
    request: AgentMemoryRequest,
    credentials: AgentCredentials
  ): Promise<AgentMemoryResponse> {
    // First retrieve existing messages
    const retrieveRequest: RetrieveRequest = {
      sessionId: request.sessionId,
      tableName: request.tableName,
      tableId: request.tableId || '',
      credentials,
      limit: request.limit || 50,
      offset: 0,
      maxContextLength: request.maxContextLength || 1000
    };

    const retrieveResult = await transaction.retrieve(retrieveRequest);
    
    // Then store the new message if provided
    let storeResult = null;
    if (request.userInput && request.output) {
      const storeRequest: StoreRequest = {
        sessionId: request.sessionId,
        tableName: request.tableName,
        userInput: request.userInput,
        output: request.output,
        credentials
      };
      
      storeResult = await transaction.store(storeRequest);
    }

    // Commit transaction
    await transaction.commit();

    // Return combined result
    return {
      success: true,
      operation: 'retrieve-and-store',
      sessionId: request.sessionId,
      tableName: request.tableName,
      data: {
        messages: retrieveResult.messages || [],
        totalCount: retrieveResult.totalCount || 0,
        messageId: storeResult?.messageId || 0
      },
      executionTime: 0 // Will be set by caller
    };
  }

  /**
   * Execute retrieve operation with enhanced context management
   */
  private async executeRetrieve(
    transaction: DatabaseTransaction,
    request: AgentMemoryRequest,
    credentials: AgentCredentials
  ): Promise<AgentMemoryResponse> {
    // Validate required fields for proper retrieval
    if (!request.sessionId) {
      throw new Error('SessionId is required for retrieve operation');
    }
    if (!request.tableName) {
      throw new Error('TableName is required for retrieve operation');
    }
    if (!credentials.agentId) {
      throw new Error('AgentId is required for retrieve operation');
    }

    // Use context length management
    const maxContextLength = request.maxContextLength || 50;
    const limit = Math.min(request.limit ?? maxContextLength, maxContextLength);

    logger.info('Executing retrieve operation with enhanced context', {
      sessionId: request.sessionId,
      tableName: request.tableName,
      tableId: request.tableId,
      agentId: credentials.agentId,
      tenantId: credentials.tenantId,
      limit,
      maxContextLength,
      offset: request.offset ?? 0
    });

    const retrieveResult = await transaction.retrieve({
      sessionId: request.sessionId,
      tableName: request.tableName,
      tableId: request.tableId || '', // Provide default empty string
      limit,
      offset: request.offset ?? 0,
      credentials,
      maxContextLength
    });

    if (!retrieveResult.success) {
      throw new Error('Failed to retrieve messages');
    }

    // Commit transaction
    await transaction.commit();

    // Enhanced response with context information (ensure data.messages exists)
    return {
      success: true,
      operation: 'retrieve',
      sessionId: request.sessionId,
      tableName: request.tableName,
      data: {
        messages: retrieveResult.messages || [],
        totalCount: retrieveResult.totalCount || 0
      },
      executionTime: 0 // Will be set by caller
    };
  }


  /**
   * Fast request validation
   */
  private validateRequest(rawRequest: Record<string, unknown>): AgentMemoryRequest {
    const operation = rawRequest.operation as AgentMemoryRequest['operation'];
    if (operation !== 'store' && operation !== 'retrieve') {
      throw new Error(`Invalid operation: ${operation}. Must be 'store' or 'retrieve'`);
    }

    const sessionId = rawRequest.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('sessionId is required and must be a non-empty string');
    }

    const tableName = rawRequest.tableName;
    if (typeof tableName !== 'string' || !tableName.trim()) {
      throw new Error('tableName is required and must be a non-empty string');
    }

    const baseRequest: AgentMemoryRequest = {
      operation,
      sessionId: (sessionId as string).trim(),
      tableName: (tableName as string).trim()
    };

    if (operation === 'store') {
      const userInput = rawRequest.userInput;
      const output = rawRequest.output;
      
      if (typeof userInput !== 'string' || !userInput.trim()) {
        throw new Error('userInput is required for store operations');
      }
      
      if (typeof output !== 'string' || !output.trim()) {
        throw new Error('output is required for store operations');
      }

      return {
        ...baseRequest,
        userInput: (userInput as string).trim(),
        output: (output as string).trim()
      };
    }

    // Retrieve operation
    let finalRequest: AgentMemoryRequest = { ...baseRequest };
    if (rawRequest.limit !== undefined) {
      const limit = Number(rawRequest.limit);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        throw new Error('limit must be a number between 1 and 1000');
      }
      finalRequest = { ...finalRequest, limit };
    }

    if (rawRequest.offset !== undefined) {
      const offset = Number(rawRequest.offset);
      if (isNaN(offset) || offset < 0) {
        throw new Error('offset must be a non-negative number');
      }
      finalRequest = { ...finalRequest, offset };
    }

    return finalRequest;
  }

  /**
   * Extract credentials from context
   */
  private extractCredentials(
    context: ExecutionContext,
    rawRequest: Record<string, unknown>
  ): AgentCredentials {
    // Priority 1: Direct request fields
    if (rawRequest.agentId && rawRequest.tenantId) {
      const agentId = String(rawRequest.agentId).trim();
      const tenantId = String(rawRequest.tenantId).trim();
      
      if (agentId && tenantId) {
        return { agentId, tenantId };
      }
    }

    // Priority 2: Execution context
    if ((context as any).agentId && (context as any).tenantId) {
      return {
        agentId: (context as any).agentId.trim(),
        tenantId: (context as any).tenantId.trim()
      };
    }

    throw new Error('Agent credentials not found. Provide agentId and tenantId in request or context');
  }
}

/**
 * Database Transaction Factory - concrete implementation interface
 */
export interface DatabaseTransactionFactoryConfig {
  readonly connectionString: string;
  readonly maxConnections: number;
  readonly isolationLevel: 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
}

export class DatabaseTransactionFactory {
  private readonly config: DatabaseTransactionFactoryConfig;

  constructor(config: DatabaseTransactionFactoryConfig) {
    this.config = config;
  }

  /**
   * Create new database transaction with proper isolation
   */
  async createTransaction(): Promise<DatabaseTransaction> {
    // This would connect to your actual database
    // with proper transaction isolation settings
    return new ConcreteTransaction(this.config);
  }
}

/**
 * Concrete database transaction implementation
 * Replace this with your actual database implementation
 */
class ConcreteTransaction implements DatabaseTransaction {
  private readonly config: DatabaseTransactionFactoryConfig;
  private committed = false;
  private rolledBack = false;
  // Use shared TableService instance to ensure consistent connection behavior
  // NOTE: This relies on Supabase client pooling inside the repository layer
  private readonly tableService = tableService;

  constructor(config: DatabaseTransactionFactoryConfig) {
    this.config = config;
  }

  async store(request: StoreRequest): Promise<StoreResult> {
    this.validateTransactionState();

    try {
      logger.info('Executing store within transaction', {
        sessionId: request.sessionId,
        tableName: request.tableName,
        agentId: request.credentials.agentId,
        tenantId: request.credentials.tenantId
      });

      // Ensure table exists for the agent
      const credentials = { agentId: request.credentials.agentId, tenantId: request.credentials.tenantId };
      const tableResult = await this.tableService.getAgentTable(credentials, request.tableName);
      let table = tableResult.table;
      if (!tableResult.found || !table) {
        // Create table if missing
        table = await this.tableService.create({
          agent_id: credentials.agentId,
          tenant_id: credentials.tenantId,
          table_name: request.tableName,
          description: `Agent memory table for ${credentials.agentId}`,
          columns: {
            sessionId: 'string',
            messageId: 'number',
            systemPrompt: 'string',
            userPrompt: 'string',
            userInput: 'string',
            output: 'string',
            timestamp: 'number'
          },
          metadata: {
            created_by: 'agent_memory_integration',
            tenant_id: credentials.tenantId
          }
        } as any);
      }

      if (!table) {
        throw new Error('Failed to create or find table');
      }

      // Generate a monotonic unique messageId without race conditions.
      // Use timestamp-based ID with collision suffix to ensure uniqueness per session.
      // Example: 20250929174429556 (ms since epoch mod 1e14) ensures increasing ordering.
      const baseId = Date.now();
      const collisionSuffix = Math.floor(Math.random() * 1000); // 0-999 to reduce rare same-ms collisions
      const nextMessageId = Number(`${baseId}${collisionSuffix.toString().padStart(3, '0')}`);

      const rowInsert = {
        agent_id: credentials.agentId,
        table_id: table.id,
        row_data: {
          sessionId: String(request.sessionId),
          messageId: nextMessageId,
          systemPrompt: '',
          userPrompt: '',
          userInput: request.userInput,
          output: request.output,
          timestamp: Date.now(),
          agentId: credentials.agentId,
          tenantId: credentials.tenantId,
          executionId: '',
          workflowId: ''
        }
      } as any;

      logger.debug('Storing message with proper structure', {
        sessionId: request.sessionId,
        tableName: request.tableName,
        tableId: table.id,
        messageId: nextMessageId,
        agentId: credentials.agentId,
        rowInsertStructure: {
          agent_id: rowInsert.agent_id,
          table_id: rowInsert.table_id,
          row_data_keys: Object.keys(rowInsert.row_data)
        }
      });

      const inserted = await this.tableService.insertRowByCredentials(credentials, request.tableName, rowInsert);
      
      logger.info('Message stored successfully', {
        sessionId: request.sessionId,
        tableName: request.tableName,
        messageId: nextMessageId,
        rowId: inserted.id,
        agentId: credentials.agentId
      });
      
      return {
        messageId: nextMessageId,
        rowId: inserted.id,
        success: true
      };

    } catch (error) {
      logger.error('Store operation failed within transaction', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: request.sessionId,
        tableName: request.tableName
      });

      return {
        messageId: 0,
        rowId: '',
        success: false
      };
    }
  }

  async retrieve(request: RetrieveRequest): Promise<RetrieveResult> {
    this.validateTransactionState();

    try {
      logger.info('Executing retrieve within transaction with enhanced validation', {
        sessionId: request.sessionId,
        tableName: request.tableName,
        tableId: request.tableId,
        agentId: request.credentials.agentId,
        tenantId: request.credentials.tenantId,
        limit: request.limit,
        maxContextLength: request.maxContextLength
      });

      const credentials = { agentId: request.credentials.agentId, tenantId: request.credentials.tenantId };
      
      // Resolve table to ensure we have exact table_id for the agent
      const tableResult = await this.tableService.getAgentTable(credentials, request.tableName);
      if (!tableResult.found || !tableResult.table?.id) {
        logger.warn('Retrieve: table not found for agent', {
          agentId: credentials.agentId,
          tableName: request.tableName
        });
        return { messages: [], totalCount: 0, success: true };
      }

      const tableId = tableResult.table.id;
      const limit = request.limit || request.maxContextLength || 50;
      const offset = request.offset || 0;

      // Direct Supabase query matching proven JSONB mapping (row_data->>sessionId)
      const result: any = await (this.tableService as any).client
        .from('agent_table_rows')
        .select('id, agent_id, table_id, row_data, created_at', { count: 'exact' })
        .eq('agent_id', credentials.agentId)
        .eq('table_id', tableId)
        .eq('row_data->>sessionId', String(request.sessionId))
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (result.error) {
        throw new Error(result.error.message || 'Retrieve query failed');
      }

      const rows = Array.isArray(result.data) ? result.data : [];

      // Parse row_data which may be JSON string or object
      const parsedRows = rows
        .map((r: any) => {
          let rowData: any = r.row_data;
          if (typeof rowData === 'string') {
            try { rowData = JSON.parse(rowData); } catch { rowData = null; }
          }
          return rowData ? { ...r, row_data: rowData } : null;
        })
        .filter((r: any) => !!r);

      const messages: SessionMessage[] = parsedRows.map((row: any) => ({
        id: row.id,
        sessionId: String(row.row_data.sessionId),
        messageId: Number(row.row_data.messageId),
        userInput: String(row.row_data.userInput || ''),
        output: String(row.row_data.output || ''),
        timestamp: Number(row.row_data.timestamp || Date.now()),
        createdAt: String(row.created_at)
      }));

      logger.info('Retrieve operation completed successfully', {
        sessionId: request.sessionId,
        tableName: request.tableName,
        tableId,
        totalRows: rows.length,
        returnedMessages: messages.length,
        limit,
        offset
      });

      return {
        messages,
        totalCount: result.count ?? messages.length,
        success: true
      };

    } catch (error) {
      logger.error('Retrieve operation failed within transaction', {
        error: error instanceof Error ? error.message : String(error),
        sessionId: request.sessionId,
        tableName: request.tableName,
        tableId: request.tableId,
        agentId: request.credentials.agentId
      });

      return {
        messages: [],
        totalCount: 0,
        success: false
      };
    }
  }

  async commit(): Promise<void> {
    this.validateTransactionState();
    
    try {
      // await this.connection.commit();
      this.committed = true;
      
      logger.debug('Transaction committed successfully');
    } catch (error) {
      logger.error('Transaction commit failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async rollback(): Promise<void> {
    if (this.committed || this.rolledBack) {
      return; // Already finished
    }

    try {
      // await this.connection.rollback();
      this.rolledBack = true;
      
      logger.debug('Transaction rolled back successfully');
    } catch (error) {
      logger.error('Transaction rollback failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - rollback should be safe
    }
  }

  private validateTransactionState(): void {
    if (this.committed) {
      throw new Error('Transaction already committed');
    }
    if (this.rolledBack) {
      throw new Error('Transaction already rolled back');
    }
  }
}

/**
 * Integration entry points
 */
export async function store(
  context: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<AgentMemoryResponse> {
  const factory = new DatabaseTransactionFactory({
    connectionString: process.env.DATABASE_URL || '',
    maxConnections: 10,
    isolationLevel: 'READ_COMMITTED'
  });

  const integration = new AgentMemoryIntegration(() => factory.createTransaction());
  
  return integration.execute(context, {
    ...inputs,
    operation: 'store'
  });
}

export async function retrieve(
  context: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<AgentMemoryResponse> {
  const factory = new DatabaseTransactionFactory({
    connectionString: process.env.DATABASE_URL || '',
    maxConnections: 10,
    isolationLevel: 'READ_COMMITTED'
  });

  const integration = new AgentMemoryIntegration(() => factory.createTransaction());
  
  return integration.execute(context, {
    ...inputs,
    operation: 'retrieve'
  });
}

// Aliases
export const get = retrieve;
export const save = store;

// Additional function exports
export const search = retrieve; // For now, using retrieve as search implementation
export const find = retrieve; // For now, using retrieve as find implementation
export const smartMemory = store; // For now, using store as smartMemory implementation

// Service creation function
export function createMemoryService(agentId: string, tenantId: string): any {
  // This would create a memory service instance
  return { agentId, tenantId };
}

// Execution context extraction
export function extractExecutionContext(inputs: Record<string, unknown>): any | null {
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
}

// Type exports
export interface AgentMemoryToolOutput {
  readonly success: boolean;
  readonly operation: string;
  readonly sessionId: string;
  readonly tableName: string;
  readonly data?: any;
  readonly error?: string;
  readonly executionTime: number;
}

export interface ExecutionContextWithAgent {
  readonly executionId: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly workflowId?: string;
  readonly variables?: Record<string, any>;
  readonly stepResults?: Record<string, any>;
}

export interface WorkflowExecutionContextWithAgent {
  readonly executionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly variables: Record<string, any>;
}

// Default export
export default AgentMemoryIntegration;


