// Agent Memory Integration - Validation and Sanitization
// Clean validation logic for input sanitization and validation

import logger from '../../utils/logger';
import {
  AgentContext,
  ValidationResult,
  EnhancedValidationResult,
  AGENT_MEMORY_CONSTANTS,
  validateSessionId,
  validateTableName,
  isStoreMessageRequest,
  isGetMessagesRequest,
  isSearchMessagesRequest
} from './types';

// Raw input interface for validation
export interface RawAgentMemoryInput {
  readonly tableName?: unknown;
  readonly sessionId?: unknown;
  readonly operation?: unknown;
  
  // Store operation fields
  readonly systemPrompt?: unknown;
  readonly userPrompt?: unknown;
  readonly userInput?: unknown;
  readonly output?: unknown;
  
  // Get operation fields
  readonly limit?: unknown;
  readonly offset?: unknown;
  readonly orderDirection?: unknown;
  
  // Search operation fields
  readonly query?: unknown;
  readonly searchFields?: unknown;
  readonly minRelevanceScore?: unknown;
  
  // Configuration fields
  readonly autoCreateTable?: unknown;
  readonly maxContextLength?: unknown;
  
  // Agent/Tenant context fields
  readonly agentId?: unknown;
  readonly tenantId?: unknown;
  
  // Execution context fields (to be removed)
  readonly _execution?: unknown;
  readonly _executionContext?: unknown;
  readonly executionId?: unknown;
  readonly nodeId?: unknown;
  readonly timestamp?: unknown;
  
  // Allow any additional fields
  readonly [key: string]: unknown;
}

// Validated input interface
export interface ValidatedAgentMemoryInput {
  readonly tableName: string;
  readonly sessionId: string;
  readonly operation: 'store' | 'get' | 'search';
  
  // Store operation fields
  readonly systemPrompt?: string;
  readonly userPrompt?: string;
  readonly userInput?: string;
  readonly output?: string;
  
  // Get operation fields
  readonly limit?: number;
  readonly offset?: number;
  readonly orderDirection?: 'asc' | 'desc';
  
  // Search operation fields
  readonly query?: string;
  readonly searchFields?: ReadonlyArray<'systemPrompt' | 'userPrompt' | 'userInput' | 'output'>;
  readonly minRelevanceScore?: number;
  
  // Configuration
  readonly autoCreateTable?: boolean;
  readonly maxContextLength?: number;
  
  // Agent/Tenant context
  readonly agentContext: AgentContext;
}

// Validation context
interface ValidationContext {
  readonly agentId: string;
  readonly tenantId: string;
  readonly operation: string;
  readonly tableName: string;
}

export class AgentMemoryValidator {
  /**
   * Validate and transform raw inputs with agent/tenant context
   */
  static async validateAndTransformInputs(
    rawInputs: Record<string, unknown>,
    agentContext: AgentContext
  ): Promise<EnhancedValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Step 1: Validate required core fields
    const tableName = this.validateAndExtractString(rawInputs.tableName, 'tableName', errors);
    const sessionId = this.validateAndExtractString(rawInputs.sessionId, 'sessionId', errors);
    const operation = this.validateAndExtractOperation(rawInputs.operation, errors);

    // Early return if core fields are invalid
    if (errors.length > 0 || tableName === null || sessionId === null) {
      return { isValid: false, errors, warnings };
    }

    const validTableName = tableName!;
    const validSessionId = sessionId!;

    // Step 2: Validate core field formats
    const tableValidation = validateTableName(validTableName);
    if (!tableValidation.isValid) {
      errors.push(...tableValidation.errors.map(e => `tableName: ${e}`));
    }

    const sessionValidation = validateSessionId(validSessionId);
    if (!sessionValidation.isValid) {
      errors.push(...sessionValidation.errors.map(e => `sessionId: ${e}`));
    }

    // Step 3: Operation-specific validation
    const operationValidation = this.validateOperationSpecificFields(operation, rawInputs, errors, warnings);
    
    // Step 4: Configuration validation
    const configValidation = this.validateConfigurationFields(rawInputs, errors, warnings, agentContext);

    if (errors.length > 0) {
      return { isValid: false, errors, warnings };
    }

    // Step 5: Build validated input
    const validatedInput: ValidatedAgentMemoryInput = {
      tableName: validTableName,
      sessionId: validSessionId,
      operation,
      agentContext,
      ...operationValidation,
      ...configValidation
    };

    return {
      isValid: true,
      errors: [],
      warnings,
      validatedInput
    };
  }

  /**
   * Validate agent context
   */
  static validateAgentContext(context: AgentContext): ValidationResult {
    const errors: string[] = [];

    if (!context.agentId || typeof context.agentId !== 'string') {
      errors.push('agentId is required and must be a string');
    } else if (context.agentId.trim().length === 0) {
      errors.push('agentId cannot be empty');
    } else if (context.agentId.length > 100) {
      errors.push('agentId cannot exceed 100 characters');
    }

    if (!context.tenantId || typeof context.tenantId !== 'string') {
      errors.push('tenantId is required and must be a string');
    } else if (context.tenantId.trim().length === 0) {
      errors.push('tenantId cannot be empty');
    } else if (context.tenantId.length > 100) {
      errors.push('tenantId cannot exceed 100 characters');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Validate store message request with context
   */
  static validateStoreMessageRequest(
    request: any,
    context: ValidationContext
  ): ValidationResult {
    const errors: string[] = [];

    if (!isStoreMessageRequest(request)) {
      errors.push('Invalid store message request format');
      return { isValid: false, errors };
    }

    const sessionValidation = validateSessionId(request.sessionId);
    if (!sessionValidation.isValid) {
      errors.push(...sessionValidation.errors);
    }

    const totalLength = (request.systemPrompt?.length ?? 0) +
                       (request.userPrompt?.length ?? 0) +
                       request.userInput.length +
                       request.output.length;

    if (totalLength > AGENT_MEMORY_CONSTANTS.MAX_MESSAGE_LENGTH) {
      errors.push(`Message too long (max ${AGENT_MEMORY_CONSTANTS.MAX_MESSAGE_LENGTH})`);
    }

    if (request.userInput.trim().length === 0) {
      errors.push('User input cannot be empty');
    }

    if (request.output.trim().length === 0) {
      errors.push('Output cannot be empty');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Validate get messages request with context
   */
  static validateGetMessagesRequest(
    request: any,
    context: ValidationContext
  ): ValidationResult {
    const errors: string[] = [];

    if (!isGetMessagesRequest(request)) {
      errors.push('Invalid get messages request format');
      return { isValid: false, errors };
    }

    const sessionValidation = validateSessionId(request.sessionId);
    if (!sessionValidation.isValid) {
      errors.push(...sessionValidation.errors);
    }

    if (request.limit !== undefined && (request.limit < 1 || request.limit > AGENT_MEMORY_CONSTANTS.MAX_LIMIT)) {
      errors.push(`Invalid limit (must be 1-${AGENT_MEMORY_CONSTANTS.MAX_LIMIT})`);
    }

    if (request.offset !== undefined && request.offset < 0) {
      errors.push('Invalid offset (must be >= 0)');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Validate search messages request with context
   */
  static validateSearchMessagesRequest(
    request: any,
    context: ValidationContext
  ): ValidationResult {
    const errors: string[] = [];

    if (!isSearchMessagesRequest(request)) {
      errors.push('Invalid search messages request format');
      return { isValid: false, errors };
    }

    const sessionValidation = validateSessionId(request.sessionId);
    if (!sessionValidation.isValid) {
      errors.push(...sessionValidation.errors);
    }

    if (request.query.trim().length === 0) {
      errors.push('Search query cannot be empty');
    }

    if (request.query.length > AGENT_MEMORY_CONSTANTS.MAX_QUERY_LENGTH) {
      errors.push(`Search query too long (max ${AGENT_MEMORY_CONSTANTS.MAX_QUERY_LENGTH})`);
    }

    if (request.limit !== undefined && (request.limit < 1 || request.limit > AGENT_MEMORY_CONSTANTS.MAX_LIMIT)) {
      errors.push(`Invalid limit (must be 1-${AGENT_MEMORY_CONSTANTS.MAX_LIMIT})`);
    }

    if (request.minRelevanceScore !== undefined && 
        (request.minRelevanceScore < 0 || request.minRelevanceScore > 1)) {
      errors.push('Invalid relevance score (must be 0-1)');
    }

    if (request.searchFields !== undefined) {
      const invalidFields = request.searchFields.filter(
        (field: unknown) => !AGENT_MEMORY_CONSTANTS.SUPPORTED_SEARCH_FIELDS.includes(field as any)
      );
      if (invalidFields.length > 0) {
        errors.push(`Invalid search fields: ${invalidFields.join(', ')}`);
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(value: unknown, fieldName: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      return null;
    }

    // Remove null characters and trim
    return value.replace(/\0/g, '').trim();
  }

  /**
   * Sanitize number input
   */
  static sanitizeNumber(value: unknown, fieldName: string): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'number') {
      return isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? null : parsed;
    }

    return null;
  }

  /**
   * Sanitize boolean input
   */
  static sanitizeBoolean(value: unknown, fieldName: string): boolean | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        return true;
      }
      if (lower === 'false' || lower === '0' || lower === 'no') {
        return false;
      }
    }

    return null;
  }

  // Private helper methods
  private static validateAndExtractString(
    value: unknown,
    fieldName: string,
    errors: string[],
    required: boolean = true
  ): string | null {
    if (value === undefined || value === null) {
      if (required) {
        errors.push(`${fieldName} is required`);
      }
      return null;
    }

    if (typeof value !== 'string') {
      errors.push(`${fieldName} must be a string`);
      return null;
    }

    return value;
  }

  private static validateAndExtractNumber(
    value: unknown,
    fieldName: string,
    errors: string[],
    required: boolean = true
  ): number | null {
    if (value === undefined || value === null) {
      if (required) {
        errors.push(`${fieldName} is required`);
      }
      return null;
    }

    if (typeof value !== 'number') {
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
          return parsed;
        }
      }
      errors.push(`${fieldName} must be a number`);
      return null;
    }

    if (!isFinite(value)) {
      errors.push(`${fieldName} must be a finite number`);
      return null;
    }

    return value;
  }

  private static validateAndExtractOperation(
    value: unknown,
    errors: string[]
  ): 'store' | 'get' | 'search' {
    if (!value || typeof value !== 'string') {
      errors.push('operation is required and must be a string');
      return 'store';
    }

    const operationMap: Record<string, 'store' | 'get' | 'search'> = {
      'store': 'store',
      'save': 'store',
      'insert': 'store',
      'add': 'store',
      'get': 'get',
      'retrieve': 'get',
      'fetch': 'get',
      'read': 'get',
      'search': 'search',
      'find': 'search',
      'query': 'search'
    };

    const normalizedOperation = value.toLowerCase().trim();
    const mappedOperation = operationMap[normalizedOperation];
    
    if (!mappedOperation) {
      errors.push('operation must be one of: store, get, search (or their aliases)');
      return 'store';
    }

    return mappedOperation;
  }

  private static validateOperationSpecificFields(
    operation: 'store' | 'get' | 'search',
    rawInputs: Record<string, unknown>,
    errors: string[],
    warnings: string[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    switch (operation) {
      case 'store':
        return this.validateStoreFields(rawInputs, errors, warnings);
      
      case 'get':
        return this.validateGetFields(rawInputs, errors, warnings);
      
      case 'search':
        return this.validateSearchFields(rawInputs, errors, warnings);
      
      default:
        errors.push(`Unsupported operation: ${operation}`);
        return result;
    }
  }

  private static validateStoreFields(
    rawInputs: Record<string, unknown>,
    errors: string[],
    warnings: string[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Required fields for store
    const userInput = this.validateAndExtractString(rawInputs.userInput, 'userInput', errors, true);
    const output = this.validateAndExtractString(rawInputs.output, 'output', errors, true);

    if (userInput !== null) {
      if (userInput.trim().length === 0) {
        errors.push('userInput cannot be empty or whitespace only');
      } else {
        result.userInput = userInput;
      }
    }

    if (output !== null) {
      if (output.trim().length === 0) {
        errors.push('output cannot be empty or whitespace only');
      } else {
        result.output = output;
      }
    }

    // Optional fields for store
    const systemPrompt = this.validateAndExtractString(rawInputs.systemPrompt, 'systemPrompt', [], false);
    const userPrompt = this.validateAndExtractString(rawInputs.userPrompt, 'userPrompt', [], false);

    if (systemPrompt !== null) {
      result.systemPrompt = systemPrompt;
      if (systemPrompt.length > AGENT_MEMORY_CONSTANTS.MAX_MESSAGE_LENGTH / 4) {
        warnings.push('systemPrompt is quite long and may affect performance');
      }
    }

    if (userPrompt !== null) {
      result.userPrompt = userPrompt;
      if (userPrompt.length > AGENT_MEMORY_CONSTANTS.MAX_MESSAGE_LENGTH / 4) {
        warnings.push('userPrompt is quite long and may affect performance');
      }
    }

    // Validate total message length
    const totalLength = (result.systemPrompt as string || '').length +
                       (result.userPrompt as string || '').length +
                       (result.userInput as string || '').length +
                       (result.output as string || '').length;

    if (totalLength > AGENT_MEMORY_CONSTANTS.MAX_MESSAGE_LENGTH) {
      errors.push(`Total message length (${totalLength}) exceeds maximum (${AGENT_MEMORY_CONSTANTS.MAX_MESSAGE_LENGTH})`);
    } else if (totalLength > AGENT_MEMORY_CONSTANTS.MAX_MESSAGE_LENGTH * 0.8) {
      warnings.push(`Total message length (${totalLength}) is approaching the maximum limit`);
    }

    return result;
  }

  private static validateGetFields(
    rawInputs: Record<string, unknown>,
    errors: string[],
    warnings: string[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Validate limit
    const limit = this.validateAndExtractNumber(rawInputs.limit, 'limit', errors, false);
    if (limit !== null) {
      if (!Number.isInteger(limit) || limit < 1) {
        errors.push('limit must be a positive integer');
      } else if (limit > AGENT_MEMORY_CONSTANTS.MAX_LIMIT) {
        errors.push(`limit cannot exceed ${AGENT_MEMORY_CONSTANTS.MAX_LIMIT}`);
      } else {
        result.limit = limit;
        if (limit > AGENT_MEMORY_CONSTANTS.DEFAULT_LIMIT * 2) {
          warnings.push('Large limit values may affect performance');
        }
      }
    }

    // Validate offset
    const offset = this.validateAndExtractNumber(rawInputs.offset, 'offset', errors, false);
    if (offset !== null) {
      if (!Number.isInteger(offset) || offset < 0) {
        errors.push('offset must be a non-negative integer');
      } else {
        result.offset = offset;
      }
    }

    // Validate order direction
    if (rawInputs.orderDirection !== undefined) {
      if (rawInputs.orderDirection === 'asc' || rawInputs.orderDirection === 'desc') {
        result.orderDirection = rawInputs.orderDirection;
      } else {
        errors.push('orderDirection must be "asc" or "desc"');
      }
    }

    return result;
  }

  private static validateSearchFields(
    rawInputs: Record<string, unknown>,
    errors: string[],
    warnings: string[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Required query field
    const query = this.validateAndExtractString(rawInputs.query, 'query', errors, true);
    if (query !== null) {
      if (query.trim().length === 0) {
        errors.push('query cannot be empty or whitespace only');
      } else if (query.length > AGENT_MEMORY_CONSTANTS.MAX_QUERY_LENGTH) {
        errors.push(`query length cannot exceed ${AGENT_MEMORY_CONSTANTS.MAX_QUERY_LENGTH}`);
      } else {
        result.query = query.trim();
        if (query.length < AGENT_MEMORY_CONSTANTS.MIN_QUERY_LENGTH) {
          warnings.push('Very short queries may not return meaningful results');
        }
      }
    }

    // Validate search fields
    if (rawInputs.searchFields !== undefined) {
      if (!Array.isArray(rawInputs.searchFields)) {
        errors.push('searchFields must be an array');
      } else {
        const validFields = rawInputs.searchFields.filter((field: unknown) => {
          return typeof field === 'string' && 
                 AGENT_MEMORY_CONSTANTS.SUPPORTED_SEARCH_FIELDS.includes(field as any);
        });

        if (validFields.length === 0) {
          errors.push('searchFields must contain at least one valid field');
        } else if (validFields.length !== rawInputs.searchFields.length) {
          const invalidFields = rawInputs.searchFields.filter(
            (field: unknown) => !validFields.includes(field)
          );
          errors.push(`Invalid search fields: ${invalidFields.join(', ')}`);
        } else {
          result.searchFields = validFields as ReadonlyArray<'systemPrompt' | 'userPrompt' | 'userInput' | 'output'>;
        }
      }
    }

    // Include common get operation fields for search
    const getFields = this.validateGetFields(rawInputs, errors, warnings);
    Object.assign(result, getFields);

    // Validate relevance score
    const minRelevanceScore = this.validateAndExtractNumber(rawInputs.minRelevanceScore, 'minRelevanceScore', errors, false);
    if (minRelevanceScore !== null) {
      if (minRelevanceScore < 0 || minRelevanceScore > 1) {
        errors.push('minRelevanceScore must be between 0 and 1');
      } else {
        result.minRelevanceScore = minRelevanceScore;
        if (minRelevanceScore > 0.8) {
          warnings.push('High relevance scores may return very few results');
        }
      }
    }

    return result;
  }

  private static validateConfigurationFields(
    rawInputs: Record<string, unknown>,
    errors: string[],
    warnings: string[],
    agentContext: AgentContext
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Validate autoCreateTable
    if (rawInputs.autoCreateTable !== undefined) {
      if (typeof rawInputs.autoCreateTable === 'boolean') {
        result.autoCreateTable = rawInputs.autoCreateTable;
        
        if (rawInputs.autoCreateTable && agentContext.agentId === 'system') {
          warnings.push('Auto table creation enabled for system agent - ensure proper permissions');
        }
      } else {
        errors.push('autoCreateTable must be a boolean');
      }
    }

    // Validate maxContextLength
    const maxContextLength = this.validateAndExtractNumber(rawInputs.maxContextLength, 'maxContextLength', errors, false);
    if (maxContextLength !== null) {
      if (!Number.isInteger(maxContextLength) || maxContextLength < 1) {
        errors.push('maxContextLength must be a positive integer');
      } else {
        result.maxContextLength = maxContextLength;
        if (maxContextLength > AGENT_MEMORY_CONSTANTS.MAX_LIMIT) {
          warnings.push(`maxContextLength (${maxContextLength}) exceeds recommended maximum for agent ${agentContext.agentId}`);
        }
      }
    }

    return result;
  }
}

