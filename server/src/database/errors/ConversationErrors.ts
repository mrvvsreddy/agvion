// database/errors/ConversationErrors.ts

/**
 * Base error class for conversation-related errors
 */
export class ConversationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ConversationError';
    Object.setPrototypeOf(this, ConversationError.prototype);
  }
}

/**
 * Resource not found errors
 */
export class ConversationNotFoundError extends ConversationError {
  constructor(conversationId: string, customerId?: string, details?: Record<string, unknown>) {
    super(
      `Conversation not found: ${conversationId}`,
      'CONVERSATION_NOT_FOUND',
      404,
      {
        conversationId,
        customerId,
        ...details
      }
    );
    this.name = 'ConversationNotFoundError';
    Object.setPrototypeOf(this, ConversationNotFoundError.prototype);
  }
}

export class MessageNotFoundError extends ConversationError {
  constructor(messageId: string, details?: Record<string, unknown>) {
    super(
      `Message not found: ${messageId}`,
      'MESSAGE_NOT_FOUND',
      404,
      {
        messageId,
        ...details
      }
    );
    this.name = 'MessageNotFoundError';
    Object.setPrototypeOf(this, MessageNotFoundError.prototype);
  }
}

/**
 * Authorization errors - customer/tenant isolation
 */
export class ConversationUnauthorizedError extends ConversationError {
  constructor(
    conversationId: string,
    customerId: string,
    expectedCustomerId: string,
    details?: Record<string, unknown>
  ) {
    super(
      `Access denied to conversation ${conversationId}: customer ${customerId} does not match conversation's customer ${expectedCustomerId}`,
      'CONVERSATION_UNAUTHORIZED',
      403,
      {
        conversationId,
        customerId,
        expectedCustomerId,
        ...details
      }
    );
    this.name = 'ConversationUnauthorizedError';
    Object.setPrototypeOf(this, ConversationUnauthorizedError.prototype);
  }
}

export class ParticipantUnauthorizedError extends ConversationError {
  constructor(
    agentId: string,
    customerId: string,
    conversationCustomerId: string,
    details?: Record<string, unknown>
  ) {
    super(
      `Agent ${agentId} from customer ${customerId} cannot join conversation owned by customer ${conversationCustomerId}`,
      'PARTICIPANT_UNAUTHORIZED',
      403,
      {
        agentId,
        customerId,
        conversationCustomerId,
        ...details
      }
    );
    this.name = 'ParticipantUnauthorizedError';
    Object.setPrototypeOf(this, ParticipantUnauthorizedError.prototype);
  }
}

export class ParticipantNotFoundError extends ConversationError {
  constructor(
    conversationId: string,
    agentId: string,
    details?: Record<string, unknown>
  ) {
    super(
      `Participant ${agentId} not found in conversation ${conversationId}`,
      'PARTICIPANT_NOT_FOUND',
      404,
      {
        conversationId,
        agentId,
        ...details
      }
    );
    this.name = 'ParticipantNotFoundError';
    Object.setPrototypeOf(this, ParticipantNotFoundError.prototype);
  }
}

/**
 * Validation errors
 */
export class ConversationValidationError extends ConversationError {
  constructor(message: string, field?: string, details?: Record<string, unknown>) {
    super(
      message,
      'CONVERSATION_VALIDATION_ERROR',
      400,
      {
        field,
        ...details
      }
    );
    this.name = 'ConversationValidationError';
    Object.setPrototypeOf(this, ConversationValidationError.prototype);
  }
}

/**
 * Type guards
 */
export function isConversationError(error: unknown): error is ConversationError {
  return error instanceof ConversationError;
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ConversationNotFoundError || error instanceof MessageNotFoundError;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ConversationUnauthorizedError || error instanceof ParticipantUnauthorizedError;
}

export function isParticipantError(error: unknown): boolean {
  return error instanceof ParticipantNotFoundError || error instanceof ParticipantUnauthorizedError;
}

