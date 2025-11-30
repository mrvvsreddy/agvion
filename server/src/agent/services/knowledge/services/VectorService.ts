// path: knowledge/services/VectorService.ts
import { KnowledgeRepository } from './KnowledgeRepository';
import { RETRY, CONFIG } from './resilience';
import { SearchOptions } from './types';
import logger from '../../../../utils/logger';

// ============= Type Definitions =============

// Note: This interface matches KnowledgeRepository's VectorRecord type
// embedding is optional (undefined) not nullable (null)
interface VectorRecord {
  table_id: string;
  agent_id: string;
  tenant_id: string;
  content: string;
  chunk_index?: number;
  embedding?: number[]; // Optional, not nullable - use undefined instead of null
  parent_file_id?: string;
  file_name?: string;
  file_type?: string;
  is_active?: boolean;
  metadata?: Record<string, any>;
}

interface EmbeddingBatchResponse {
  embeddings: (number[] | null)[];
  successCount: number;
  failureCount: number;
}

interface SearchResult {
  id: string;
  content: string;
  file_name: string;
  chunk_index: number;
  similarity: number;
  metadata?: Record<string, any>;
}

// ============= Service Implementation =============

export class VectorService {
  private static instance: VectorService;
  private repository: KnowledgeRepository;
  private embeddingService: any;

  constructor() {
    this.repository = new KnowledgeRepository();
    this.initEmbeddingService();
  }

  private async initEmbeddingService(): Promise<void> {
    try {
      const { awsEmbeddingService } = await import('../../../../integrations/agent_knowledge/aws-embedding-service');
      this.embeddingService = awsEmbeddingService;
      logger.info('Embedding service initialized successfully');
    } catch (error) {
      logger.warn('Failed to load embedding service', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      this.embeddingService = null;
    }
  }

  static getInstance(): VectorService {
    if (!VectorService.instance) {
      VectorService.instance = new VectorService();
    }
    return VectorService.instance;
  }

  /**
   * Generate unique request ID for tracing
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Sanitize string input to prevent injection attacks
   */
  private sanitizeInput(input: string, maxLength: number = 10000): string {
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
   * Validate UUID format
   */
  private isValidUUID(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  /**
   * Validate alphanumeric ID format
   */
  private isValidAlphanumericId(id: string): boolean {
    return /^[A-Za-z0-9\-_]{1,64}$/.test(id);
  }

  /**
   * Generate embeddings with proper error handling and type safety
   */
  private async generateEmbeddingsBatch(
    chunks: string[],
    requestId: string
  ): Promise<(number[] | null)[]> {
    const isConfigured = this.embeddingService?.isConfigured() ?? false;

    if (!isConfigured) {
      logger.debug('Embedding service not configured, returning null embeddings', { requestId });
      return new Array(chunks.length).fill(null);
    }

    try {
      const embeddings = await RETRY.externalApi.execute(
        () => this.embeddingService.generateEmbeddingsBatch(chunks, CONFIG.EMBEDDING_BATCH_SIZE),
        { 
          operation: 'generateEmbeddings', 
          metadata: { 
            batchSize: chunks.length,
            requestId 
          } 
        }
      );

      // FIXED: Type-safe array validation
      if (!Array.isArray(embeddings)) {
        logger.error('Invalid embedding response: not an array', { requestId });
        return new Array(chunks.length).fill(null);
      }

      // Validate response length matches input
      if (embeddings.length !== chunks.length) {
        logger.warn('Embedding count mismatch', {
          requestId,
          expected: chunks.length,
          received: embeddings.length
        });
        // Pad or truncate to match
        const normalized = new Array(chunks.length).fill(null);
        for (let i = 0; i < Math.min(chunks.length, embeddings.length); i++) {
          normalized[i] = embeddings[i];
        }
        return normalized;
      }

      const successfulEmbeddings = embeddings.filter(e => e !== null).length;
      
      if (successfulEmbeddings === 0 && chunks.length > 0) {
        logger.warn('All embeddings failed', { requestId, batchSize: chunks.length });
      } else if (successfulEmbeddings < chunks.length) {
        logger.warn('Some embeddings failed', {
          requestId,
          successful: successfulEmbeddings,
          failed: chunks.length - successfulEmbeddings
        });
      } else {
        logger.debug('All embeddings generated successfully', {
          requestId,
          count: successfulEmbeddings
        });
      }

      return embeddings as (number[] | null)[];
    } catch (error) {
      logger.error('Batch embedding generation failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        batchSize: chunks.length
      });
      throw new Error('Embedding generation failed. Please try again or contact support if problem persists.');
    }
  }

  async generateAndStore(
    chunks: string[],
    context: {
      knowledgeBaseId: string;
      agentId: string;
      tenantId: string;
      parentFileId?: string;
      fileName?: string;
      fileType?: string;
      metadata?: Record<string, any>;
    },
    returnIds?: boolean
  ): Promise<number | string[]> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    let totalInserted = 0;
    const insertedChunkIds: string[] = []; // Track IDs for rollback - declared outside try for catch block access

    try {
      // Validate empty input
      if (!chunks || chunks.length === 0) {
        logger.info('No chunks to store', { requestId });
        return returnIds ? [] : 0;
      }

      // Security: Validate knowledge base ID
      if (!this.isValidUUID(context.knowledgeBaseId)) {
        logger.warn('Invalid knowledge base ID format', { 
          requestId, 
          knowledgeBaseId: context.knowledgeBaseId 
        });
        throw new Error('Invalid knowledge base ID format');
      }

      // Security: Validate agent and tenant IDs
      if (!this.isValidAlphanumericId(context.agentId) || !this.isValidAlphanumericId(context.tenantId)) {
        logger.warn('Invalid agent or tenant ID format', { 
          requestId,
          agentId: context.agentId,
          tenantId: context.tenantId
        });
        throw new Error('Invalid agent or tenant ID format');
      }

      // Sanitize string inputs
      const sanitizedFileName = context.fileName ? this.sanitizeInput(context.fileName, 255) : undefined;
      const sanitizedFileType = context.fileType ? this.sanitizeInput(context.fileType, 50) : undefined;

      logger.info('Starting chunk storage', {
        requestId,
        totalChunks: chunks.length,
        knowledgeBaseId: context.knowledgeBaseId.substring(0, 8) + '...',
        fileName: sanitizedFileName
      });

      // Process in batches to prevent memory issues
      for (let i = 0; i < chunks.length; i += CONFIG.DB_BATCH_SIZE) {
        const batch = chunks.slice(i, Math.min(i + CONFIG.DB_BATCH_SIZE, chunks.length));
        
        // Generate embeddings with error handling
        let embeddings: (number[] | null)[];
        try {
          embeddings = await this.generateEmbeddingsBatch(batch, requestId);
        } catch (error) {
          // FIXED: Rollback all inserted chunks on embedding failure
          if (insertedChunkIds.length > 0) {
            logger.warn('Rolling back partial insert due to embedding failure', {
              requestId,
              rollbackCount: insertedChunkIds.length,
              batchStart: i,
              totalChunks: chunks.length
            });
            
            try {
              await this.repository.deleteVectorsByIds(insertedChunkIds);
            } catch (rollbackError) {
              logger.error('CRITICAL: Rollback failed after embedding error', {
                requestId,
                rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
                insertedChunkIds: insertedChunkIds.length
              });
            }
          }
          
          logger.error('Batch embedding generation failed - ABORTING upload', {
            requestId,
            error: error instanceof Error ? error.message : String(error),
            batchStart: i,
            batchSize: batch.length,
            totalChunks: chunks.length,
            rolledBackChunks: insertedChunkIds.length
          });
          throw new Error(
            `Embedding failed after ${totalInserted} chunks. Rolled back all changes.`
          );
        }

        // Build records with proper type safety
        // With exactOptionalPropertyTypes, we must conditionally include optional properties
        const records: VectorRecord[] = batch.map((chunk, idx) => {
          const globalIndex = i + idx;
          const embedding = embeddings[idx] ?? undefined;

          // FIXED: Conditionally include optional properties to satisfy exactOptionalPropertyTypes
          // For atomic swap, insert with is_active=false initially, will be activated during swap
          const record: VectorRecord = {
            table_id: context.knowledgeBaseId,
            agent_id: context.agentId,
            tenant_id: context.tenantId,
            content: chunk,
            chunk_index: globalIndex,
            is_active: returnIds ? false : true, // If returning IDs (for swap), start inactive
            metadata: {
              ...(context.metadata || {}),
              fileName: sanitizedFileName,
              chunkIndex: globalIndex
            }
          };

          // Only include optional properties if they have values
          if (embedding) {
            record.embedding = embedding;
          }
          if (context.parentFileId) {
            record.parent_file_id = context.parentFileId;
          }
          if (sanitizedFileName) {
            record.file_name = sanitizedFileName;
          }
          if (sanitizedFileType) {
            record.file_type = sanitizedFileType;
          }

          return record;
        });

        // Insert batch with retry and fallback
        try {
          // FIXED: Use insertVectorBatchWithIds to track IDs for rollback
          const batchInsertedIds = await this.repository.insertVectorBatchWithIds(records);
          insertedChunkIds.push(...batchInsertedIds);
          totalInserted += batchInsertedIds.length;
          logger.debug('Batch stored successfully', {
            requestId,
            batchStart: i,
            batchSize: batch.length,
            totalInserted,
            progress: `${Math.min(i + CONFIG.DB_BATCH_SIZE, chunks.length)}/${chunks.length}`
          });
        } catch (error) {
          // Fallback to individual inserts
          logger.info('Falling back to individual inserts for failed batch', {
            requestId,
            reason: error instanceof Error ? error.message : String(error),
            count: records.length
          });
          
          for (let j = 0; j < records.length; j++) {
            try {
              // FIXED: Safe array access with explicit check
              const record = records[j];
              if (!record) {
                logger.warn('Undefined record in batch', { requestId, index: j });
                continue;
              }

              const success = await this.repository.insertVectorSingle(record);
              if (success) {
                totalInserted++;
              }
            } catch (err) {
              logger.debug('Single vector insert failed', {
                requestId,
                index: j,
                error: err instanceof Error ? err.message : String(err)
              });
            }
            
            // Throttle individual inserts
            if (j % 10 === 0 && j > 0) {
              await new Promise(resolve => setTimeout(resolve, CONFIG.INSERT_THROTTLE_MS));
            }
          }
        }

        // Allow event loop to process between batches
        if (i + CONFIG.DB_BATCH_SIZE < chunks.length) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Chunk storage completed', {
        requestId,
        totalChunks: chunks.length,
        totalInserted,
        successRate: `${((totalInserted / chunks.length) * 100).toFixed(1)}%`,
        knowledgeBaseId: context.knowledgeBaseId.substring(0, 8) + '...',
        duration
      });

      // Return IDs if requested (for atomic swap), otherwise return count
      return returnIds ? insertedChunkIds : totalInserted;
    } catch (error) {
      const duration = Date.now() - startTime;
      // Rollback on any error
      if (insertedChunkIds.length > 0) {
        try {
          await this.repository.deleteVectorsByIds(insertedChunkIds);
          logger.warn('Rolled back chunks after storage failure', {
            requestId,
            rolledBackCount: insertedChunkIds.length
          });
        } catch (rollbackError) {
          logger.error('CRITICAL: Rollback failed after storage error', {
            requestId,
            rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
      }

      logger.error('Chunk storage failed with rollback', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        totalChunks: chunks.length,
        totalChunksAttempted: chunks.length,
        rolledBackChunks: insertedChunkIds.length,
        knowledgeBaseId: context.knowledgeBaseId?.substring(0, 8),
        duration
      });
      throw error;
    }
  }

  async search(
    query: string,
    knowledgeBaseId: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      // Security: Validate inputs
      const sanitizedQuery = this.sanitizeInput(query, 10000);
      if (!sanitizedQuery) {
        logger.warn('Empty query after sanitization', { requestId, originalQuery: query });
        throw new Error('Query is required');
      }

      if (!this.isValidUUID(knowledgeBaseId)) {
        logger.warn('Invalid knowledge base ID format', { requestId, knowledgeBaseId });
        throw new Error('Invalid knowledge base ID format');
      }

      // Security: Validate agent and tenant IDs
      if (!this.isValidAlphanumericId(options.agentId) || !this.isValidAlphanumericId(options.tenantId)) {
        logger.warn('Invalid agent or tenant ID format', { 
          requestId,
          agentId: options.agentId,
          tenantId: options.tenantId
        });
        throw new Error('Invalid agent or tenant ID format');
      }

      logger.info('Starting vector search', {
        requestId,
        query: sanitizedQuery.substring(0, 100),
        knowledgeBaseId: knowledgeBaseId.substring(0, 8) + '...',
        limit: options.limit,
        threshold: options.threshold
      });

      // Check embedding service
      if (!this.embeddingService?.isConfigured()) {
        logger.error('Embedding service not configured', { requestId });
        throw new Error('Embedding service not configured');
      }

      // Generate query embedding
      const embeddings = await RETRY.externalApi.execute(
        () => this.embeddingService.generateEmbeddingsBatch([sanitizedQuery], 1),
        { operation: 'generateQueryEmbedding', metadata: { requestId } }
      );
      
      // FIXED: Type-safe embedding extraction with proper null handling
      if (!Array.isArray(embeddings) || embeddings.length === 0) {
        logger.error('Invalid embedding response', { requestId });
        throw new Error('Failed to generate query embedding');
      }

      const queryEmbedding = embeddings[0];
      if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
        logger.error('Query embedding is null or invalid', { requestId });
        throw new Error('Failed to generate query embedding');
      }

      logger.debug('Query embedding generated', {
        requestId,
        embeddingDimension: queryEmbedding.length
      });

      // Search via RPC with proper type safety
      const SupabaseService = (await import('../../../../database/config/supabase')).default;
      const client = SupabaseService.getInstance().getClient();
      
      // FIXED: Strict numeric validation to prevent DoS and privacy leaks
      const limit = Math.min(Math.max(1, Number(options.limit) || 10), 100);
      const threshold = Math.min(Math.max(0, Number(options.threshold) || 0.7), 1);

      // Validate they're actually finite numbers
      if (!Number.isFinite(limit) || !Number.isFinite(threshold)) {
        logger.warn('Invalid numeric parameters', { requestId, limit, threshold });
        throw new Error('Invalid numeric parameters');
      }

      // FIXED: Add strict validation BEFORE RPC call to prevent SQL injection
      if (!this.isValidUUID(knowledgeBaseId)) {
        throw new Error('Invalid knowledge base ID format');
      }
      if (!this.isValidAlphanumericId(options.agentId)) {
        throw new Error('Invalid agent ID format');
      }
      if (!this.isValidAlphanumericId(options.tenantId)) {
        throw new Error('Invalid tenant ID format');
      }

      // FIXED: RPC call with proper parameter passing and validation
      // Supabase RPC expects parameters as an object, not a typed interface
      const params = {
        query_embedding: queryEmbedding,
        knowledge_base_id: knowledgeBaseId,
        p_agent_id: options.agentId,
        p_tenant_id: options.tenantId,
        match_count: limit,
        match_threshold: threshold
      };
      
      const { data, error } = await client.rpc('search_knowledge_chunks', params as any); // Type assertion needed as Supabase RPC types are generic

      if (error) {
        logger.error('RPC search failed', {
          requestId,
          error: error.message,
          code: error.code
        });
        throw error;
      }

      // Type-safe result handling
      let results: SearchResult[] = Array.isArray(data) ? (data as SearchResult[]) : [];

      // Filter by file names if specified (with validation)
      if (options.fileNames && Array.isArray(options.fileNames) && options.fileNames.length > 0) {
        // Security: Validate file names
        const validFileNames = options.fileNames.filter(name => 
          name && 
          typeof name === 'string' && 
          name.length <= 255 && 
          !/[<>:"|?*\\/]/.test(name)
        );
        
        if (validFileNames.length > 0) {
          const fileSet = new Set(validFileNames);
          results = results.filter(r => r.file_name && fileSet.has(r.file_name));
          
          logger.debug('Filtered by file names', {
            requestId,
            requestedFiles: validFileNames.length,
            resultsAfterFilter: results.length
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Vector search completed', {
        requestId,
        resultsCount: results.length,
        knowledgeBaseId: knowledgeBaseId.substring(0, 8) + '...',
        duration
      });

      return results;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Vector search failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        knowledgeBaseId: knowledgeBaseId?.substring(0, 8),
        duration
      });
      throw new Error('Search temporarily unavailable. Please try again.');
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    const checks: any = {
      repository: false,
      embeddingService: false,
      embeddingConfigured: false
    };

    try {
      checks.repository = !!this.repository;
      checks.embeddingService = !!this.embeddingService;
      checks.embeddingConfigured = this.embeddingService?.isConfigured() ?? false;

      const healthy = checks.repository && checks.embeddingService;
      logger.info('VectorService health check completed', { healthy, checks });

      return { healthy, details: checks };
    } catch (error) {
      logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { healthy: false, details: checks };
    }
  }
}

export default VectorService.getInstance();