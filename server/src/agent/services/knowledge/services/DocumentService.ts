// knowledge/services/DocumentService.ts
import { VectorService } from './VectorService';
import { KnowledgeRepository } from './KnowledgeRepository';
import { KnowledgeValidator } from './KnowledgeValidator';
import { RateLimiter, CacheManager, CONFIG } from './resilience';
import { UploadRequest, UploadResponse, FileProcessingResult } from './types';
import logger from '../../../../utils/logger';

export class DocumentService {
  private static instance: DocumentService;
  private vectorService: VectorService;
  private repository: KnowledgeRepository;
  private validator: KnowledgeValidator;
  private rateLimiter: RateLimiter;
  private cache: CacheManager;
  private redis: any;

  constructor() {
    this.vectorService = VectorService.getInstance();
    this.repository = new KnowledgeRepository();
    this.validator = new KnowledgeValidator();
    this.rateLimiter = new RateLimiter();
    this.cache = new CacheManager();
    const { RedisService } = require('../../../../auth/services/RedisService');
    this.redis = RedisService.getInstance();
  }

  static getInstance(): DocumentService {
    if (!DocumentService.instance) {
      DocumentService.instance = new DocumentService();
    }
    return DocumentService.instance;
  }

  /**
   * Generate unique request ID for tracing
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Sanitize string input
   */
  private sanitizeInput(input: string, maxLength: number = 255): string {
    if (!input || typeof input !== 'string') {
      return '';
    }
    // Remove null bytes and control characters
    return input
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
      .substring(0, maxLength);
  }

  /**
   * Invalidate cache with error handling
   */
  private async invalidateCacheSafely(cacheKey: string, requestId: string): Promise<void> {
    try {
      await this.cache.invalidate(cacheKey);
      logger.debug('Cache invalidated', { requestId, cacheKey });
    } catch (error) {
      logger.warn('Cache invalidation failed', {
        requestId,
        cacheKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async upload(request: UploadRequest): Promise<UploadResponse> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      const { knowledgeBaseId, agentId, tenantId, files, textContent } = request;

      logger.info('Document upload started', {
        requestId,
        knowledgeBaseId: knowledgeBaseId?.substring(0, 8),
        agentId: agentId?.substring(0, 8),
        filesCount: files?.length || 0,
        hasTextContent: !!textContent
      });

      // Security: Validate inputs
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(knowledgeBaseId)) {
        logger.warn('Invalid knowledge base ID format', { requestId, knowledgeBaseId });
        return { success: false, message: 'Invalid knowledge base ID format' };
      }

      if (!/^[A-Za-z0-9\-_]{1,64}$/.test(agentId) || !/^[A-Za-z0-9\-_]{1,64}$/.test(tenantId)) {
        logger.warn('Invalid agent or tenant ID format', { requestId, agentId, tenantId });
        return { success: false, message: 'Invalid agent or tenant ID format' };
      }

      // Rate limiting
      const rateCheck = await this.rateLimiter.checkLimit(
        `rate_limit:${tenantId}:${agentId}`,
        CONFIG.UPLOAD_RATE_MAX_PER_MINUTE
      );
      
      if (!rateCheck.allowed) {
        const retryAfter = rateCheck.retryAfter || 60;
        logger.warn('Upload rate limit exceeded', { requestId, retryAfter });
        return {
          success: false,
          message: `Upload rate limit exceeded. Retry after ${retryAfter}s`
        };
      }

      // Verify knowledge base exists and belongs to agent/tenant
      const kb = await this.repository.findById(knowledgeBaseId);
      if (!kb || kb.agent_id !== agentId || kb.tenant_id !== tenantId) {
        logger.warn('Knowledge base not found or access denied', {
          requestId,
          knowledgeBaseId: knowledgeBaseId.substring(0, 8),
          found: !!kb
        });
        return { success: false, message: 'Knowledge base not found or access denied' };
      }

      // Validate files upfront
      if (files && files.length > 0) {
        const validation = this.validateFiles(files);
        if (!validation.valid) {
          logger.warn('File validation failed', {
            requestId,
            error: validation.error
          });
          // FIXED: Only include error property if it's defined
          return validation.error 
            ? { success: false, message: validation.error }
            : { success: false, message: 'File validation failed' };
        }
      }

      let totalChunks = 0;
      let filesProcessed = 0;
      const fileResults: FileProcessingResult[] = [];

      // FIXED: Process files in parallel with concurrency limit
      if (files && files.length > 0) {
        const concurrencyLimit = 3;
        const chunks: typeof files[] = [];
        
        // Split files into chunks
        for (let i = 0; i < files.length; i += concurrencyLimit) {
          chunks.push(files.slice(i, i + concurrencyLimit));
        }

        // Process chunks sequentially, files within chunk in parallel
        for (const chunk of chunks) {
          const results = await Promise.allSettled(
            chunk.map(file => this.processFile(file, {
              knowledgeBaseId,
              agentId,
              tenantId
            }))
          );

          // Process results with improved error logging
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (!result) continue;
            
            if (result.status === 'fulfilled') {
              fileResults.push(result.value);
              if (result.value.success) {
                totalChunks += result.value.chunksCreated;
                filesProcessed++;
              }
            } else {
              // FIXED: Enhanced error logging with full context
              const fileName = chunk[i]?.fileName || 'unknown';
              const error = result.reason;
              
              logger.error('File processing failed in parallel batch', {
                requestId,
                fileName,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                errorType: error?.constructor?.name,
                batchIndex: chunks.indexOf(chunk),
                fileIndex: i
              });
              
              fileResults.push({
                fileName,
                success: false,
                chunksCreated: 0,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }

          // Alert if many files fail in this batch
          const batchFailures = results.filter(r => r && r.status === 'rejected').length;
          if (batchFailures > chunk.length / 2) {
            logger.error('CRITICAL: High file failure rate in batch', {
              requestId,
              failureRate: `${((batchFailures / chunk.length) * 100).toFixed(1)}%`,
              batchSize: chunk.length,
              failedFiles: batchFailures
            });
          }
        }
      }

      // Process text content
      if (textContent && textContent.trim()) {
        // Security: Limit text content size
        if (textContent.length > 10 * 1024 * 1024) { // 10MB
          logger.warn('Text content too large', { requestId, size: textContent.length });
          return { success: false, message: 'Text content too large (max 10MB)' };
        }

        const textChunks = await this.processText(textContent, {
          knowledgeBaseId,
          agentId,
          tenantId
        });
        totalChunks += textChunks;
      }

      // FIXED: Await cache invalidation to prevent race conditions
      try {
        await this.invalidateCacheSafely(`agent:studio:home:${agentId}`, requestId);
      } catch (error) {
        // Log but don't fail the operation
        logger.warn('Cache invalidation failed but operation succeeded', { requestId, error });
      }

      const hadFiles = files && files.length > 0;
      const successCount = fileResults.filter(r => r.success).length;

      if (hadFiles && successCount === 0 && totalChunks === 0) {
        logger.warn('Failed to process any files', { requestId });
        
        // FIXED: Build response with properly typed optional properties
        const failedFiles = fileResults
          .filter(r => !r.success)
          .map(r => {
            // Only include error property if it exists
            if (r.error) {
              return { fileName: r.fileName, error: r.error };
            }
            return { fileName: r.fileName };
          });

        return {
          success: false,
          message: 'Failed to process any files. Check logs for details.',
          chunksCreated: totalChunks,
          chunksInserted: totalChunks,
          filesProcessed: successCount,
          fileResults,
          failedFiles
        };
      }

      // Build successful response
      const duration = Date.now() - startTime;
      logger.info('Document upload completed', {
        requestId,
        totalChunks,
        filesProcessed: successCount,
        duration
      });

      // FIXED: Construct response with explicitly defined optional properties
      const response: UploadResponse = {
        success: totalChunks > 0,
        chunksCreated: totalChunks,
        chunksInserted: totalChunks,
        filesProcessed: successCount,
        message: totalChunks > 0 ? 'Upload completed' : 'No content processed'
      };

      // Only add fileResults if we had files
      if (hadFiles) {
        response.fileResults = fileResults;
        
        const failedFiles = fileResults
          .filter(r => !r.success)
          .map(r => {
            if (r.error) {
              return { fileName: r.fileName, error: r.error };
            }
            return { fileName: r.fileName };
          });
        
        if (failedFiles.length > 0) {
          response.failedFiles = failedFiles;
        }
      }

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Document upload failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        agentId: request.agentId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to upload documents' };
    }
  }

  private validateFiles(files: any[]): { valid: boolean; error?: string } {
    const maxFileSize = CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024;
    const maxTotalSize = CONFIG.MAX_TOTAL_SIZE_MB * 1024 * 1024;
    let totalSize = 0;

    // Security: Limit number of files
    if (files.length > 50) {
      return { valid: false, error: 'Too many files (max 50 per upload)' };
    }

    for (const file of files) {
      // Validate file name
      const nameCheck = this.validator.validateFileName(file.fileName);
      if (!nameCheck.valid) {
        // FIXED: Only include error if it's defined
        return nameCheck.error 
          ? { valid: false, error: nameCheck.error }
          : { valid: false, error: 'Invalid file name' };
      }

      // Validate file type
      if (!this.validator.validateFileType(file.fileName, file.mimeType)) {
        const mimeType = file.mimeType || 'unknown';
        return {
          valid: false,
          error: `File type "${mimeType}" not supported. Only PDF files allowed.`
        };
      }

      // Validate file size
      const sizeCheck = this.validator.validateFileSize(file.buffer, maxFileSize);
      if (!sizeCheck.valid) {
        // FIXED: Only include error if it's defined
        return sizeCheck.error
          ? { valid: false, error: sizeCheck.error }
          : { valid: false, error: 'File size validation failed' };
      }

      totalSize += file.buffer.length;
    }

    // Validate total size
    if (totalSize > maxTotalSize) {
      return {
        valid: false,
        error: `Total upload size exceeds ${Math.round(maxTotalSize / 1024 / 1024)} MB`
      };
    }

    return { valid: true };
  }

  private async processFile(
    file: { buffer: Buffer; fileName: string; mimeType?: string },
    context: { knowledgeBaseId: string; agentId: string; tenantId: string }
  ): Promise<FileProcessingResult> {
    const requestId = this.generateRequestId();
    const { fileName, buffer } = file;
    let parentFileId: string | undefined;

    // Sanitize filename
    const sanitizedFileName = this.sanitizeInput(fileName);
    if (!sanitizedFileName) {
      logger.warn('Invalid filename', { requestId, fileName });
      return {
        fileName,
        success: false,
        chunksCreated: 0,
        error: 'Invalid filename'
      };
    }

    try {
      logger.debug('Processing file', {
        requestId,
        fileName: sanitizedFileName,
        size: buffer.length,
        knowledgeBaseId: context.knowledgeBaseId.substring(0, 8)
      });

      // FIXED: Idempotency check with timeout and abort logic
      const idempotencyKey = `idempotency:upload:${context.tenantId}:${context.agentId}:${context.knowledgeBaseId}:${sanitizedFileName}:${buffer.length}`;
      
      interface IdempotencyResult {
        status: string;
        chunksCreated?: number;
      }

      const IDEMPOTENCY_RETRIES = 3;
      const MAX_IDEMPOTENCY_WAIT_MS = 2000; // Total timeout
      let idempotencyResult: IdempotencyResult | null = null;
      const startTime = Date.now();
      
      for (let i = 0; i < IDEMPOTENCY_RETRIES; i++) {
        // Check total elapsed time
        if (Date.now() - startTime > MAX_IDEMPOTENCY_WAIT_MS) {
          logger.warn('Idempotency check timed out - ABORTING upload for safety', {
            requestId,
            fileName: sanitizedFileName,
            elapsedMs: Date.now() - startTime
          });
          return {
            fileName: sanitizedFileName,
            success: false,
            chunksCreated: 0,
            error: 'Idempotency check timed out. Please retry upload.'
          };
        }

        try {
          // Add per-attempt timeout
          idempotencyResult = await Promise.race([
            this.redis.getJson(idempotencyKey) as Promise<IdempotencyResult | null>,
            new Promise<null>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 500)
            )
          ]);
          break; // Success
        } catch (error) {
          if (i === IDEMPOTENCY_RETRIES - 1) {
            // ABORT instead of proceeding
            logger.warn('Idempotency check failed after retries - ABORTING upload', {
              requestId,
              fileName: sanitizedFileName,
              error: error instanceof Error ? error.message : String(error)
            });
            return {
              fileName: sanitizedFileName,
              success: false,
              chunksCreated: 0,
              error: 'Cannot verify upload uniqueness. Please retry.'
            };
          } else {
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, i)));
          }
        }
      }

      if (idempotencyResult?.status === 'success' && typeof idempotencyResult.chunksCreated === 'number') {
        logger.debug('Idempotent upload detected', {
          requestId,
          fileName: sanitizedFileName,
          chunksCreated: idempotencyResult.chunksCreated
        });
        return { fileName: sanitizedFileName, success: true, chunksCreated: idempotencyResult.chunksCreated };
      }

      // Mark as in-progress
      try {
        await this.redis.setJson(idempotencyKey, { status: 'in_progress', at: new Date().toISOString() }, 3600);
      } catch (progressError) {
        logger.debug('Failed to mark upload as in-progress', {
          requestId,
          error: progressError instanceof Error ? progressError.message : String(progressError)
        });
      }

      // Create file manifest
      parentFileId = await this.repository.createFileManifest({
        tableId: context.knowledgeBaseId,
        agentId: context.agentId,
        tenantId: context.tenantId,
        fileName: sanitizedFileName,
        sizeBytes: buffer.length
      });

      logger.debug('File manifest created', {
        requestId,
        parentFileId: parentFileId.substring(0, 8)
      });

      // Extract text and chunk
      const chunks = await this.extractAndChunk(buffer, sanitizedFileName);
      if (chunks.length === 0) {
        logger.warn('No text extracted from file', {
          requestId,
          fileName: sanitizedFileName
        });
        
        // Cleanup manifest
        try {
          await this.repository.deleteFileManifest(parentFileId);
        } catch (cleanupError) {
          logger.debug('Failed to cleanup manifest', {
            requestId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          });
        }
        
        return {
          fileName: sanitizedFileName,
          success: false,
          chunksCreated: 0,
          error: 'No text extracted from file'
        };
      }

      // Generate embeddings and store
      const chunksCreatedResult = await this.vectorService.generateAndStore(chunks, {
        knowledgeBaseId: context.knowledgeBaseId,
        agentId: context.agentId,
        tenantId: context.tenantId,
        parentFileId,
        fileName: sanitizedFileName,
        fileType: '.pdf',
        metadata: {
          fileName: sanitizedFileName,
          fileType: '.pdf'
        }
      });

      // Handle return type: number | string[]
      const chunksCreated = typeof chunksCreatedResult === 'number' ? chunksCreatedResult : chunksCreatedResult.length;

      if (chunksCreated > 0) {
        // Update manifest with chunk count
        try {
          await this.repository.updateFileManifest(parentFileId, {
            type: 'knowledge_file',
            fileName: sanitizedFileName,
            sizeBytes: buffer.length,
            uploadedAt: new Date().toISOString(),
            is_editable: false,
            chunk_count: chunksCreated
          });
        } catch (manifestUpdateError) {
          logger.debug('Failed to update manifest', {
            requestId,
            error: manifestUpdateError instanceof Error ? manifestUpdateError.message : String(manifestUpdateError)
          });
        }

        // Store idempotent success result
        try {
          await this.redis.setJson(idempotencyKey, {
            status: 'success',
            chunksCreated,
            fileName: sanitizedFileName,
            parentFileId
          }, 3600);
        } catch (idempotencyStoreError) {
          logger.debug('Failed to store idempotency result', {
            requestId,
            error: idempotencyStoreError instanceof Error ? idempotencyStoreError.message : String(idempotencyStoreError)
          });
        }

        logger.debug('File processed successfully', {
          requestId,
          fileName: sanitizedFileName,
          chunksCreated
        });

        return {
          fileName: sanitizedFileName,
          success: true,
          chunksCreated
        };
      } else {
        logger.warn('No chunks stored', {
          requestId,
          fileName: sanitizedFileName
        });
        
        // Cleanup on failure
        try {
          await this.repository.deleteFileManifest(parentFileId);
        } catch (cleanupError) {
          logger.debug('Failed to cleanup manifest', {
            requestId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          });
        }
        
        return {
          fileName: sanitizedFileName,
          success: false,
          chunksCreated: 0,
          error: 'No chunks stored'
        };
      }
    } catch (error) {
      logger.error('File processing error', {
        requestId,
        fileName: sanitizedFileName,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      // Cleanup on error
      if (parentFileId) {
        try {
          await this.repository.deleteFileManifest(parentFileId);
          const SupabaseService = (await import('../../../../database/config/supabase')).default;
          const client = SupabaseService.getInstance().getClient();
          await client.from('agent_vector_data').delete().eq('parent_file_id', parentFileId);
        } catch (cleanupError) {
          logger.debug('Failed to cleanup after error', {
            requestId,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          });
        }
      }

      return {
        fileName: sanitizedFileName,
        success: false,
        chunksCreated: 0,
        error: error instanceof Error ? error.message : String(error || 'Unknown error')
      };
    }
  }

  private async extractAndChunk(
    buffer: Buffer,
    fileName: string
  ): Promise<string[]> {
    const { streamPdfChunks } = await import('../../../../utils/fileProcessor');
    const chunks: string[] = [];

    try {
      // Stream chunks from PDF (memory efficient)
      for await (const chunk of streamPdfChunks(buffer, {
        chunkSize: CONFIG.CHUNK_SIZE,
        overlap: CONFIG.CHUNK_OVERLAP,
        respectBoundaries: true
      })) {
        chunks.push(chunk);
      }
    } catch (error) {
      logger.error('PDF extraction failed', {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to extract text from PDF');
    }

    return chunks;
  }

  private async processText(
    textContent: string,
    context: { knowledgeBaseId: string; agentId: string; tenantId: string }
  ): Promise<number> {
    const requestId = this.generateRequestId();
    
    try {
      logger.debug('Processing text content', {
        requestId,
        length: textContent.length,
        knowledgeBaseId: context.knowledgeBaseId.substring(0, 8)
      });

      const { chunkText } = await import('../../../../utils/fileProcessor');
      
      // Chunk text
      const chunks = chunkText(textContent.trim(), {
        chunkSize: CONFIG.CHUNK_SIZE,
        overlap: CONFIG.CHUNK_OVERLAP
      });

      // Generate embeddings and store
      const chunksCreatedResult = await this.vectorService.generateAndStore(chunks, {
        knowledgeBaseId: context.knowledgeBaseId,
        agentId: context.agentId,
        tenantId: context.tenantId,
        metadata: {
          source: 'text_upload',
          totalChunks: chunks.length
        }
      });

      // Handle return type: number | string[]
      const chunksCreated = typeof chunksCreatedResult === 'number' ? chunksCreatedResult : chunksCreatedResult.length;

      logger.debug('Text content processed', {
        requestId,
        chunksCreated
      });

      return chunksCreated;
    } catch (error) {
      logger.error('Text processing failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  async editDocument(
    fileId: string,
    newContent: string,
    options: { agentId: string; tenantId: string }
  ): Promise<{ success: boolean; chunksCreated?: number; message?: string }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Editing document', {
        requestId,
        fileId: fileId?.substring(0, 8),
        contentLength: newContent?.length || 0
      });

      // Security: Validate inputs
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) {
        logger.warn('Invalid file ID format', { requestId, fileId });
        return { success: false, message: 'Invalid file ID format' };
      }

      if (!/^[A-Za-z0-9\-_]{1,64}$/.test(options.agentId) || !/^[A-Za-z0-9\-_]{1,64}$/.test(options.tenantId)) {
        logger.warn('Invalid agent or tenant ID format', { requestId });
        return { success: false, message: 'Invalid agent or tenant ID format' };
      }

      // Security: Limit content size
      if (newContent.length > 10 * 1024 * 1024) {
        logger.warn('Content too large', { requestId, size: newContent.length });
        return { success: false, message: 'Content too large (max 10MB)' };
      }

      // Sanitize content
      const sanitizedContent = this.sanitizeInput(newContent, 10000000);
      if (!sanitizedContent) {
        logger.warn('Invalid content', { requestId });
        return { success: false, message: 'Invalid content' };
      }

      // Verify document exists and is editable
      const doc = await this.repository.getDocument(fileId, options.agentId);
      if (!doc) {
        logger.warn('Document not found or access denied', { requestId, fileId: fileId.substring(0, 8) });
        return { success: false, message: 'Document not found or access denied' };
      }

      if (doc.tenant_id !== options.tenantId) {
        logger.warn('Access denied', { requestId, fileId: fileId.substring(0, 8) });
        return { success: false, message: 'Access denied' };
      }

      if (!doc.row_data?.is_editable) {
        logger.warn('Document is not editable', { requestId, fileId: fileId.substring(0, 8) });
        return { success: false, message: 'Document is not editable' };
      }

      // FIXED: Type-safe access to row_data with proper type checking
      const rowData = doc.row_data;
      if (!rowData || typeof rowData !== 'object') {
        logger.warn('Invalid row_data structure', { requestId, fileId: fileId.substring(0, 8) });
        return { success: false, message: 'Invalid document structure' };
      }

      // Type guard for FileManifestData
      const isFileManifest = (data: unknown): data is { 
        type: string; 
        fileName?: string; 
        fileType?: string; 
        is_editable?: boolean;
        [key: string]: unknown;
      } => {
        return data !== null && typeof data === 'object' && 'type' in data;
      };

      if (!isFileManifest(rowData)) {
        logger.warn('Row data is not a file manifest', { requestId, fileId: fileId.substring(0, 8) });
        return { success: false, message: 'Invalid document type' };
      }

      const fileName = typeof rowData.fileName === 'string' ? rowData.fileName : '';
      const fileType = typeof rowData.fileType === 'string' ? rowData.fileType : '.txt';
      const isEditable = typeof rowData.is_editable === 'boolean' ? rowData.is_editable : false;

      // Update original content
      const updatedRowData: {
        type: 'knowledge_file';
        fileName: string;
        sizeBytes: number;
        uploadedAt: string;
        is_editable: boolean;
        original_content: string;
        content_length: number;
        updated_at: string;
        [key: string]: unknown;
      } = {
        ...rowData,
        type: 'knowledge_file' as const,
        fileName,
        sizeBytes: typeof rowData.sizeBytes === 'number' ? rowData.sizeBytes : 0,
        uploadedAt: typeof rowData.uploadedAt === 'string' ? rowData.uploadedAt : new Date().toISOString(),
        is_editable: isEditable,
        original_content: sanitizedContent,
        content_length: sanitizedContent.length,
        updated_at: new Date().toISOString()
      };
      
      await this.repository.updateFileManifest(fileId, updatedRowData);

      // FIXED: Use atomic swap to prevent race conditions
      // 1. Generate chunks first (no DB changes yet)
      const { chunkText } = await import('../../../../utils/fileProcessor');
      const chunks = chunkText(sanitizedContent, {
        chunkSize: CONFIG.CHUNK_SIZE,
        overlap: CONFIG.CHUNK_OVERLAP
      });

      // 2. Insert new chunks with is_active=false initially (temporary flag)
      const newChunkIds = await this.vectorService.generateAndStore(chunks, {
        knowledgeBaseId: doc.table_id,
        agentId: options.agentId,
        tenantId: options.tenantId,
        parentFileId: fileId,
        fileName,
        fileType
      }, true) as string[];

      // 3. Atomically swap: activate new, deactivate old (no gap)
      const swapResult = await this.repository.atomicVectorSwap(fileId, newChunkIds, options.tenantId);
      
      logger.debug('Atomic vector swap completed', {
        requestId,
        fileId: fileId.substring(0, 8),
        activated: swapResult.activated,
        deactivated: swapResult.deactivated
      });

      const chunksCreated = newChunkIds.length;

      // Update chunk count
      await this.repository.updateFileManifest(fileId, {
        ...updatedRowData,
        chunk_count: chunksCreated
      });

      // FIXED: Await cache invalidation to prevent race conditions
      try {
        await this.invalidateCacheSafely(`agent:studio:home:${options.agentId}`, requestId);
      } catch (error) {
        // Log but don't fail the operation
        logger.warn('Cache invalidation failed but operation succeeded', { requestId, error });
      }

      const duration = Date.now() - startTime;
      logger.info('Document edited successfully', {
        requestId,
        fileId: fileId.substring(0, 8),
        chunksCreated,
        duration
      });

      return { success: true, chunksCreated };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Document edit failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        fileId: fileId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to edit document' };
    }
  }

  async deleteDocument(
    fileId: string,
    options: { agentId: string; tenantId: string; hard?: boolean }
  ): Promise<{ success: boolean; message?: string }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Deleting document', {
        requestId,
        fileId: fileId?.substring(0, 8),
        hard: options.hard
      });

      // Security: Validate inputs
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) {
        logger.warn('Invalid file ID format', { requestId, fileId });
        return { success: false, message: 'Invalid file ID format' };
      }

      // Verify ownership
      const doc = await this.repository.getDocument(fileId, options.agentId);
      if (!doc) {
        logger.warn('Document not found or access denied', { requestId, fileId: fileId.substring(0, 8) });
        return { success: false, message: 'Document not found or access denied' };
      }

      if (doc.tenant_id !== options.tenantId) {
        logger.warn('Access denied', { requestId, fileId: fileId.substring(0, 8) });
        return { success: false, message: 'Access denied' };
      }

      // Delete vectors
      if (options.hard) {
        await this.repository.hardDeleteVectors(fileId);
      } else {
        await this.repository.softDeleteVectors(fileId);
      }

      // Delete manifest
      await this.repository.deleteFileManifest(fileId);

      // FIXED: Await cache invalidation to prevent race conditions
      try {
        await this.invalidateCacheSafely(`agent:studio:home:${options.agentId}`, requestId);
      } catch (error) {
        // Log but don't fail the operation
        logger.warn('Cache invalidation failed but operation succeeded', { requestId, error });
      }

      const duration = Date.now() - startTime;
      logger.info('Document deleted successfully', {
        requestId,
        fileId: fileId.substring(0, 8),
        duration
      });

      return { success: true };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Document delete failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        fileId: fileId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to delete document' };
    }
  }

  async bulkDelete(
    fileIds: string[],
    options: { agentId: string; tenantId: string; hard?: boolean }
  ): Promise<{ success: boolean; deleted: number }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Bulk delete started', {
        requestId,
        count: fileIds?.length || 0,
        hard: options.hard
      });

      // Security: Limit bulk operations
      if (!fileIds || fileIds.length === 0) {
        return { success: true, deleted: 0 };
      }

      if (fileIds.length > 100) {
        logger.warn('Bulk delete request exceeds limit', {
          requestId,
          requested: fileIds.length,
          limit: 100
        });
        fileIds = fileIds.slice(0, 100);
      }

      let deleted = 0;
      for (const fileId of fileIds) {
        try { 
          const result = await this.deleteDocument(fileId, options);
          if (result.success) deleted++;
        } catch (error) {
          logger.debug('Bulk delete item failed', {
            requestId,
            fileId: fileId?.substring(0, 8),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Bulk delete completed', {
        requestId,
        deleted,
        total: fileIds.length,
        duration
      });

      return { success: true, deleted };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Bulk delete failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        duration
      });
      return { success: true, deleted: 0 };
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    const checks: any = {
      vectorService: false,
      repository: false,
      validator: false,
      rateLimiter: false,
      cache: false,
      redis: false
    };

    try {
      checks.vectorService = !!this.vectorService;
      checks.repository = !!this.repository;
      checks.validator = !!this.validator;
      checks.rateLimiter = !!this.rateLimiter;
      checks.cache = !!this.cache;

      // Check Redis connection
      try {
        checks.redis = await this.redis.ping();
      } catch (error) {
        logger.warn('Redis ping failed in health check', { error });
        checks.redis = false;
      }

      const healthy = Object.values(checks).every(v => v === true);
      logger.info('Health check completed', { healthy, checks });

      return { healthy, details: checks };
    } catch (error) {
      logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { healthy: false, details: checks };
    }
  }

  /**
   * Graceful shutdown - cleanup resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down DocumentService');
    
    // Cleanup any pending operations
    try {
      await this.rateLimiter.shutdown?.();
    } catch (error) {
      logger.warn('RateLimiter shutdown failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      await this.cache.shutdown?.();
    } catch (error) {
      logger.warn('Cache shutdown failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    logger.info('DocumentService shutdown complete');
  }
}

export default DocumentService.getInstance();