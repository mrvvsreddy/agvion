// workspace/errors/WorkspaceErrors.ts

/**
 * Base error class for workspace-related errors
 */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/**
 * Authentication and authorization errors
 */
export class WorkspaceAuthError extends WorkspaceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'WORKSPACE_AUTH_ERROR', 401, details);
    this.name = 'WorkspaceAuthError';
  }
}

export class WorkspaceAccessError extends WorkspaceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'WORKSPACE_ACCESS_DENIED', 403, details);
    this.name = 'WorkspaceAccessError';
  }
}

/**
 * Resource not found errors
 */
export class WorkspaceNotFoundError extends WorkspaceError {
  constructor(workspaceId: string, details?: Record<string, unknown>) {
    super(`Workspace not found: ${workspaceId}`, 'WORKSPACE_NOT_FOUND', 404, {
      workspaceId,
      ...details
    });
    this.name = 'WorkspaceNotFoundError';
  }
}

/**
 * Validation errors
 */
export class WorkspaceValidationError extends WorkspaceError {
  constructor(message: string, field?: string, details?: Record<string, unknown>) {
    super(message, 'WORKSPACE_VALIDATION_ERROR', 400, {
      field,
      ...details
    });
    this.name = 'WorkspaceValidationError';
  }
}

/**
 * Cache and data consistency errors
 */
export class WorkspaceCacheError extends WorkspaceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'WORKSPACE_CACHE_ERROR', 500, details);
    this.name = 'WorkspaceCacheError';
  }
}

/**
 * Type guard to check if an error is a WorkspaceError
 */
export function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof WorkspaceError;
}

/**
 * Type guard to check if an error has a statusCode property
 */
export function hasStatusCode(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && 'statusCode' in error && typeof (error as any).statusCode === 'number';
}
