// knowledge/errors/KnowledgeErrors.ts
export class KnowledgeError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(message: string, statusCode = 400, code = 'KNOWLEDGE_ERROR', details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class CreateKnowledgeBaseError extends KnowledgeError {
  constructor(message = 'Failed to create knowledge base', details?: unknown) {
    super(message, 400, 'KNOWLEDGE_CREATE_ERROR', details);
  }
}

export class GetKnowledgeBasesError extends KnowledgeError {
  constructor(message = 'Failed to fetch knowledge bases', details?: unknown) {
    super(message, 400, 'KNOWLEDGE_LIST_ERROR', details);
  }
}

export class GetKnowledgeBaseError extends KnowledgeError {
  constructor(message = 'Knowledge base not found', details?: unknown) {
    super(message, 404, 'KNOWLEDGE_GET_ERROR', details);
  }
}

export class UpdateKnowledgeBaseError extends KnowledgeError {
  constructor(message = 'Failed to update knowledge base', details?: unknown) {
    super(message, 400, 'KNOWLEDGE_UPDATE_ERROR', details);
  }
}

export class DeleteKnowledgeBaseError extends KnowledgeError {
  constructor(message = 'Failed to delete knowledge base', details?: unknown) {
    super(message, 400, 'KNOWLEDGE_DELETE_ERROR', details);
  }
}

export class UploadKnowledgeBaseError extends KnowledgeError {
  constructor(message = 'Failed to upload files to knowledge base', details?: unknown) {
    super(message, 400, 'KNOWLEDGE_UPLOAD_ERROR', details);
  }
}

export function toHttp(error: unknown): { status: number; body: { success: false; message: string; code?: string } } {
  if (error instanceof KnowledgeError) {
    return { status: error.statusCode, body: { success: false, message: error.message, code: error.code } };
  }
  return { status: 500, body: { success: false, message: 'Internal server error' } };
}


