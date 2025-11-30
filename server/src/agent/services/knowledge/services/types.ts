// knowledge/services/types.ts

export interface KnowledgeBase {
  id: string;
  name: string;
  type: 'knowledge';
  agentId: string;
  tenantId: string;
  tableName: string;
  description?: string | undefined;
  hasData: boolean;
  size: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeBaseRequest {
  name: string;
  type: 'knowledge';
  sessionToken: string;
  agentId: string; // Changed from agentToken to agentId
  tenantId: string;
}

export interface GetKnowledgeBasesRequest {
  sessionToken: string;
  tenantId: string;
  agentId: string; // Required - no fallback for security
}

export interface GetKnowledgeBaseRequest {
  knowledgeBaseId: string;
  sessionToken: string;
  tenantId: string;
  agentId: string; // Required - no fallback for security
}

export interface UpdateKnowledgeBaseRequest {
  knowledgeBaseId: string;
  name?: string;
  type?: 'website';
  sessionToken: string;
  tenantId: string;
  agentId: string; // Required - no fallback for security
}

export interface DeleteKnowledgeBaseRequest {
  knowledgeBaseId: string;
  sessionToken: string;
  tenantId: string;
  agentId: string; // Required - no fallback for security
}

export interface UploadRequest {
  knowledgeBaseId: string;
  agentId: string;
  tenantId: string;
  files?: Array<{
    buffer: Buffer;
    fileName: string;
    mimeType?: string;
  }>;
  textContent?: string;
}

export interface UploadResponse {
  success: boolean;
  message?: string;
  chunksCreated?: number;
  chunksInserted?: number;
  filesProcessed?: number;
  fileResults?: Array<{
    fileName: string;
    success: boolean;
    chunksCreated: number;
    error?: string;
  }>;
  failedFiles?: Array<{
    fileName: string;
    error?: string;
  }>;
}

export interface SearchOptions {
  agentId: string;
  tenantId: string;
  fileNames?: string[];
  limit?: number;
  threshold?: number;
}

export interface FileProcessingResult {
  fileName: string;
  success: boolean;
  chunksCreated: number;
  error?: string;
}

export interface DocumentUploadResult {
  fileId: string;
  fileName: string;
  chunkCount: number;
  contentLength: number;
  status: 'success';
}

export interface DocumentEditResult {
  chunkCount: number;
}

export interface DocumentDeleteResult {
  success: boolean;
  message?: string;
}

export interface BulkDeleteResult {
  success: boolean;
  deleted: number;
}

