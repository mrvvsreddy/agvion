// Agent Memory Integration - Type Definitions
// Clean, sanitized type definitions for the agent memory system with universal selector support

// Core session message interface
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

// Agent context for multi-tenancy
export interface AgentContext {
  readonly agentId: string;
  readonly tenantId: string;
}

// Request/Response types for operations
export interface StoreMessageRequest {
  readonly sessionId: string;
  readonly systemPrompt?: string;
  readonly userPrompt?: string;
  readonly userInput: string;
  readonly output: string;
  readonly selector?: Record<string, string>; // optional universal selector
  readonly userId?: string; // optional common selector fields
  readonly channelId?: string;
  readonly threadId?: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface StoreMessageResponse {
  readonly message: SessionMessage;
  readonly messageId: number;
  readonly sessionMessageCount: number;
}

export interface GetMessagesRequest {
  readonly sessionId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly orderDirection?: 'asc' | 'desc';
  readonly selector?: Record<string, string>; // optional universal selector
  readonly userId?: string;
  readonly channelId?: string;
  readonly threadId?: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface GetMessagesResponse {
  readonly messages: readonly SessionMessage[];
  readonly totalCount: number;
  readonly hasMore: boolean;
}

export interface SearchMessagesRequest {
  readonly sessionId: string;
  readonly query: string;
  readonly searchFields?: ReadonlyArray<'systemPrompt' | 'userPrompt' | 'userInput' | 'output'>;
  readonly limit?: number;
  readonly minRelevanceScore?: number;
  readonly selector?: Record<string, string>; // optional universal selector
  readonly userId?: string;
  readonly channelId?: string;
  readonly threadId?: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface SearchMessageResult extends SessionMessage {
  readonly relevanceScore: number;
}

export interface SearchMessagesResponse {
  readonly messages: readonly SearchMessageResult[];
  readonly totalCount: number;
  readonly searchQuery: string;
}

// Configuration types
export interface AgentMemoryConfig {
  readonly tableName: string;
  readonly sessionId: string;
  readonly operation: 'store' | 'get' | 'search';
  readonly maxContextLength?: number;
  readonly autoCreateTable?: boolean;
}

export interface AgentMemoryServiceConfig {
  readonly tableService?: any; // TableService type
  readonly context: AgentContext;
  readonly options?: {
  readonly maxRetries?: number;
  readonly defaultTimeout?: number;
  readonly requireExistingTables?: boolean;
} | undefined;
}

// Execution metadata interface
export interface ExecutionMetadata {
  readonly executionId: string;
  readonly nodeId: string;
  readonly timestamp: string;
}

// Database row types
export interface AgentMemoryRowData {
  readonly sessionId: string;
  readonly messageId: number;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly userInput: string;
  readonly output: string;
  readonly timestamp: string;
  readonly selectorKey?: string; // normalized universal key for querying
  readonly selector?: Record<string, string> | null; // stored raw selector fields
}

export interface AgentMemoryRow {
  readonly id: string;
  readonly table_id: string;
  readonly data: AgentMemoryRowData;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentMemoryRowInsert {
  readonly table_id: string;
  readonly data: AgentMemoryRowData;
}

// Validation types
export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

export interface EnhancedValidationResult extends ValidationResult {
  readonly warnings: readonly string[];
  readonly validatedInput?: any;
  readonly contextSource?: 'execution_context' | 'direct_input' | 'default';
}

// Session statistics
export interface SessionStats {
  readonly sessionId: string;
  readonly messageCount: number;
  readonly firstMessageAt: string;
  readonly lastMessageAt: string;
  readonly totalCharacters: number;
  readonly averageMessageLength: number;
}

// Pagination types
export interface PaginationParams {
  readonly limit: number;
  readonly offset: number;
}

export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

// Query options
export interface SessionRowQueryOptions {
  readonly limit: number;
  readonly offset: number;
  readonly orderDirection: 'asc' | 'desc';
}

// Operation results
export type OperationResult<T> = {
  readonly success: true;
  readonly data: T;
} | {
  readonly success: false;
  readonly error: AgentMemoryError;
};

export type AsyncOperationResult<T> = Promise<OperationResult<T>>;

// Error classes
export class AgentMemoryError extends Error {
  public readonly name = 'AgentMemoryError' as const;
  public readonly code: string;
  
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
    Object.setPrototypeOf(this, AgentMemoryError.prototype);
  }
}

export class SessionNotFoundError extends AgentMemoryError {
  constructor(sessionId: string) {
    super('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
    Object.setPrototypeOf(this, SessionNotFoundError.prototype);
  }
}

export class InvalidMessageFormatError extends AgentMemoryError {
  constructor(details: string) {
    super('INVALID_MESSAGE_FORMAT', `Invalid message format: ${details}`);
    Object.setPrototypeOf(this, InvalidMessageFormatError.prototype);
  }
}

export class TableOperationError extends AgentMemoryError {
  constructor(operation: string, details: string) {
    super('TABLE_OPERATION_FAILED', `Table ${operation} failed: ${details}`);
    Object.setPrototypeOf(this, TableOperationError.prototype);
  }
}

// Type guards
export function isStoreMessageRequest(obj: unknown): obj is StoreMessageRequest {
  if (!obj || typeof obj !== 'object') return false;
  const req = obj as Record<string, unknown>;
  
  return typeof req.sessionId === 'string' &&
         typeof req.userInput === 'string' &&
         typeof req.output === 'string' &&
         (req.systemPrompt === undefined || typeof req.systemPrompt === 'string') &&
         (req.userPrompt === undefined || typeof req.userPrompt === 'string');
}

export function isGetMessagesRequest(obj: unknown): obj is GetMessagesRequest {
  if (!obj || typeof obj !== 'object') return false;
  const req = obj as Record<string, unknown>;
  
  return typeof req.sessionId === 'string' &&
         (req.limit === undefined || (typeof req.limit === 'number' && req.limit > 0)) &&
         (req.offset === undefined || (typeof req.offset === 'number' && req.offset >= 0)) &&
         (req.orderDirection === undefined || 
          req.orderDirection === 'asc' || 
          req.orderDirection === 'desc');
}

export function isSearchMessagesRequest(obj: unknown): obj is SearchMessagesRequest {
  if (!obj || typeof obj !== 'object') return false;
  const req = obj as Record<string, unknown>;
  
  const validSearchFields = ['systemPrompt', 'userPrompt', 'userInput', 'output'];
  const isValidSearchFields = (fields: unknown): fields is ReadonlyArray<'systemPrompt' | 'userPrompt' | 'userInput' | 'output'> => {
    return Array.isArray(fields) && fields.every(field => validSearchFields.includes(field as string));
  };
  
  return typeof req.sessionId === 'string' &&
         typeof req.query === 'string' &&
         req.query.trim().length > 0 &&
         (req.searchFields === undefined || isValidSearchFields(req.searchFields)) &&
         (req.limit === undefined || (typeof req.limit === 'number' && req.limit > 0)) &&
         (req.minRelevanceScore === undefined || 
          (typeof req.minRelevanceScore === 'number' && 
           req.minRelevanceScore >= 0 && 
           req.minRelevanceScore <= 1));
}

export function isAgentMemoryRowData(obj: unknown): obj is AgentMemoryRowData {
  if (!obj || typeof obj !== 'object') return false;
  const data = obj as Record<string, unknown>;
  
  return typeof data.sessionId === 'string' &&
         typeof data.messageId === 'number' &&
         typeof data.systemPrompt === 'string' &&
         typeof data.userPrompt === 'string' &&
         typeof data.userInput === 'string' &&
         typeof data.output === 'string' &&
         typeof data.timestamp === 'string';
}

export function isAgentMemoryRow(obj: unknown): obj is AgentMemoryRow {
  if (!obj || typeof obj !== 'object') return false;
  const row = obj as Record<string, unknown>;
  
  return typeof row.id === 'string' &&
         typeof row.table_id === 'string' &&
         isAgentMemoryRowData(row.data) &&
         typeof row.created_at === 'string' &&
         typeof row.updated_at === 'string';
}

// Validation functions
export function validateSessionId(sessionId: string): ValidationResult {
  const errors: string[] = [];
  
  if (sessionId.length === 0) {
    errors.push('Session ID cannot be empty');
  }
  
  if (sessionId.length > AGENT_MEMORY_CONSTANTS.MAX_SESSION_ID_LENGTH) {
    errors.push(`Session ID too long (max ${AGENT_MEMORY_CONSTANTS.MAX_SESSION_ID_LENGTH})`);
  }
  
  // Allow phone number formats by normalizing for validation
  const normalized = normalizeSessionId(sessionId);
  if (normalized.length === 0) {
    errors.push('Session ID format is invalid');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Normalize session ID to a consistent string format
export function normalizeSessionId(sessionId: string): string {
  if (!sessionId) return '';
  const str = sessionId.toString();
  // If looks like a phone number, keep digits only
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }
  // Otherwise trim and lowercase for consistency
  return str.trim().toLowerCase();
}

export function validateTableName(tableName: string): ValidationResult {
  const errors: string[] = [];
  
  if (tableName.length === 0) {
    errors.push('Table name cannot be empty');
  }
  
  if (tableName.length > AGENT_MEMORY_CONSTANTS.MAX_TABLE_NAME_LENGTH) {
    errors.push(`Table name too long (max ${AGENT_MEMORY_CONSTANTS.MAX_TABLE_NAME_LENGTH})`);
  }
  
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(tableName)) {
    errors.push('Table name must start with a letter and contain only alphanumeric characters, hyphens, and underscores');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Constants
export const AGENT_MEMORY_CONSTANTS = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 1000,
  DEFAULT_MIN_RELEVANCE_SCORE: 0.1,
  MAX_MESSAGE_LENGTH: 50000,
  MAX_SESSION_ID_LENGTH: 255,
  MAX_TABLE_NAME_LENGTH: 100,
  TABLE_NAME_PREFIX: 'agent_memory_',
  MIN_QUERY_LENGTH: 1,
  MAX_QUERY_LENGTH: 1000,
  DEFAULT_SEARCH_FIELDS: ['userInput', 'output'] as const,
  SUPPORTED_SEARCH_FIELDS: ['systemPrompt', 'userPrompt', 'userInput', 'output'] as const,
  IGNORED_VALIDATION_FIELDS: ['_execution', '_executionContext'] as const
} as const;

// Build a stable universal key from selector inputs; fallback to sessionId
export function buildSelectorKey(
  selector: Record<string, string> | undefined | null,
  fallbackSessionId: string,
  extras: Partial<Record<'userId' | 'channelId' | 'threadId' | 'phone' | 'email', string>> = {}
): string {
  const parts: Array<[string, string]> = [];
  if (selector) {
    for (const [k, v] of Object.entries(selector)) {
      if (typeof v === 'string' && v.trim()) parts.push([k.trim().toLowerCase(), v.trim()]);
    }
  }
  for (const [k, v] of Object.entries(extras)) {
    if (typeof v === 'string' && v.trim()) parts.push([k, v.trim()]);
  }
  // Always include sessionId as lowest priority if present
  if (typeof fallbackSessionId === 'string' && fallbackSessionId.trim()) {
    parts.push(['sessionId', fallbackSessionId.trim()]);
  }
  if (parts.length === 0) return fallbackSessionId.trim();
  parts.sort((a, b) => a[0].localeCompare(b[0]));
  return parts.map(([k, v]) => `${k}=${v}`).join('|');
}