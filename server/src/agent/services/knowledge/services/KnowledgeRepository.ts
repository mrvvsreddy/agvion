// path: knowledge/services/KnowledgeRepository.ts
import AgentTablesRepository from '../../../../database/repositories/AgentTablesColumnsRepository';
import AgentTableRowsRepository from '../../../../database/repositories/AgentTableRowsRepository';
import SupabaseService from '../../../../database/config/supabase';
import { RETRY, CONFIG } from './resilience';
import logger from '../../../../utils/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============= Type Definitions =============

interface DatabaseError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

interface SupabaseResponse<T> {
  data: T | null;
  error: DatabaseError | null;
  count?: number | null;
  status: number;
  statusText: string;
}

interface VectorRecord {
  id?: string;
  table_id: string;
  agent_id: string;
  tenant_id: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  parent_file_id?: string;
  is_active?: boolean;
  created_at?: string;
}

interface FileManifestData {
  type: 'knowledge_file';
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  is_editable: boolean;
  [key: string]: unknown;
}

interface TableRowRecord {
  id?: string;
  table_id: string;
  agent_id: string;
  tenant_id: string;
  row_data: FileManifestData | Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

// Database table record with nullable description
interface DatabaseTableRecord {
  id: string;
  agent_id: string;
  tenant_id: string;
  table_name: string;
  description: string | null;
  columns: ColumnDefinition[];
  created_at: string;
  updated_at: string;
}

// Application-level table record with required description
interface AgentTableRecord {
  id: string;
  agent_id: string;
  tenant_id: string;
  table_name: string;
  description: string;
  columns: ColumnDefinition[];
  created_at: string;
  updated_at: string;
}

interface ColumnDefinition {
  name: string;
  type: string;
  required: boolean;
  primaryKey?: boolean;
  dimensions?: number;
}

interface CreateTableParams {
  agentId: string;
  tenantId: string;
  tableName: string;
  description: string;
}

interface CreateFileManifestParams {
  tableId: string;
  agentId: string;
  tenantId: string;
  fileName: string;
  sizeBytes: number;
}

// ============= Type Guards & Converters =============

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isDatabaseError(error: unknown): error is DatabaseError {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('code' in error || 'message' in error)
  );
}

function assertUUID(id: string, paramName: string = 'ID'): asserts id is string {
  if (!isUUID(id)) {
    throw new Error(`Invalid ${paramName} format: must be a valid UUID`);
  }
}

/**
 * Convert database table record to application record
 * Ensures description is always a non-empty string
 */
function toAgentTableRecord(dbRecord: DatabaseTableRecord): AgentTableRecord {
  return {
    id: dbRecord.id,
    agent_id: dbRecord.agent_id,
    tenant_id: dbRecord.tenant_id,
    table_name: dbRecord.table_name,
    description: dbRecord.description || '',
    columns: dbRecord.columns,
    created_at: dbRecord.created_at,
    updated_at: dbRecord.updated_at
  };
}

// ============= Repository Implementation =============

export class KnowledgeRepository {
  private agentTablesRepo = AgentTablesRepository;
  private agentRowsRepo = AgentTableRowsRepository;
  private supabase = SupabaseService.getInstance();

  /**
   * Set tenant context for RLS policies before database operations
   * This ensures that Row Level Security policies filter by tenant_id automatically
   */
  private async setTenantContext(tenantId: string): Promise<void> {
    if (!tenantId || typeof tenantId !== 'string') {
      return; // Skip if invalid tenantId
    }
    await this.supabase.setTenantContext(tenantId);
  }

  /**
   * Create a new knowledge base table with default schema
   */
  async createTable(data: CreateTableParams): Promise<AgentTableRecord> {
    // Set tenant context for RLS policy
    await this.setTenantContext(data.tenantId);
    const now = new Date().toISOString();
    
    const tableRecord = {
      agent_id: data.agentId,
      tenant_id: data.tenantId,
      table_name: data.tableName,
      description: data.description,
      columns: this.getDefaultColumns(),
      type: 'knowledge' as const, // Set type to 'knowledge' for knowledge bases
      created_at: now,
      updated_at: now
    };

    const result = await RETRY.database.execute(
      () => this.agentTablesRepo.upsertTable(tableRecord as any),
      { 
        operation: 'createTable', 
        metadata: { agentId: data.agentId.substring(0, 8) } 
      }
    );

    return toAgentTableRecord(result as DatabaseTableRecord);
  }

  /**
   * Find table by ID
   */
  async findById(id: string): Promise<AgentTableRecord | null> {
    assertUUID(id, 'table ID');
    const result = await this.agentTablesRepo.findById(id);
    
    if (!result) {
      return null;
    }
    
    return toAgentTableRecord(result as DatabaseTableRecord);
  }

  /**
   * Find all tables for an agent
   * By default, only returns 'knowledge' and 'custom' types (excludes 'system')
   * Note: agentId is varchar, not UUID
   * Note: tenantId is required for RLS policy filtering
   */
  async findByAgent(agentId: string, allowedTypes?: ('system' | 'knowledge' | 'custom')[], tenantId?: string): Promise<AgentTableRecord[]> {
    // agentId is varchar string, not UUID - no validation needed
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('Agent ID is required and must be a string');
    }
    // Set tenant context if provided (for RLS policy)
    if (tenantId) {
      await this.setTenantContext(tenantId);
    }
    // Default to knowledge and custom types only (exclude system)
    const typesToFetch = allowedTypes || ['knowledge', 'custom'];
    const results = await this.agentTablesRepo.findByAgent(agentId, typesToFetch);
    
    return results.map(r => toAgentTableRecord(r as DatabaseTableRecord));
  }

  /**
   * Update table metadata
   */
  async updateTable(
    id: string, 
    data: Partial<Omit<AgentTableRecord, 'id' | 'created_at'>>
  ): Promise<AgentTableRecord> {
    assertUUID(id, 'table ID');
    
    const result = await RETRY.database.execute(
      () => this.agentTablesRepo.update(id, { 
        ...data, 
        updated_at: new Date().toISOString() 
      }),
      { 
        operation: 'updateTable', 
        metadata: { id: id.substring(0, 8) } 
      }
    );

    return toAgentTableRecord(result as DatabaseTableRecord);
  }

  /**
   * Delete table and all associated data (cascade)
   */
  async deleteTable(id: string): Promise<void> {
    assertUUID(id, 'knowledge base ID');
    
    const client = this.supabase.getClient() as SupabaseClient<any>;

    // Try RPC cascade delete first
    try {
      // Type assertion for RPC call - Supabase typing is too strict
      const rpcCall = client.rpc as any;
      const result = await rpcCall('delete_knowledge_base_cascade', { 
        kb_id: id 
      }) as SupabaseResponse<unknown>;
      
      if (!result.error) {
        logger.debug('Cascade delete succeeded via RPC', { id: id.substring(0, 8) });
        return;
      }
      
      logger.warn('RPC cascade delete failed, using fallback', { 
        id: id.substring(0, 8),
        error: result.error 
      });
    } catch (rpcError) {
      logger.warn('RPC call failed, using manual cascade', { 
        id: id.substring(0, 8),
        error: isDatabaseError(rpcError) ? rpcError.message : String(rpcError)
      });
    }

    // Fallback: manual cascade delete with retry
    await RETRY.database.execute(
      async () => {
        // Delete vectors
        const vectorDelete = await client
          .from('agent_vector_data')
          .delete()
          .eq('table_id', id) as SupabaseResponse<unknown>;
        
        if (vectorDelete.error) {
          logger.warn('Vector deletion failed, continuing', { 
            error: vectorDelete.error 
          });
        }

        // Delete table rows (best effort)
        try {
          const rowsDelete = await client
            .from('agent_table_rows')
            .delete()
            .eq('table_id', id) as SupabaseResponse<unknown>;
          
          if (rowsDelete.error) {
            logger.warn('Table rows deletion failed, continuing', { 
              error: rowsDelete.error 
            });
          }
        } catch (rowError) {
          logger.warn('Table rows delete exception, continuing', { 
            error: isDatabaseError(rowError) ? rowError.message : String(rowError)
          });
        }

        // Delete table definition
        await this.agentTablesRepo.delete(id);
      },
      { 
        operation: 'deleteTableCascade', 
        metadata: { id: id.substring(0, 8) } 
      }
    );
  }

  /**
   * Get vector counts for multiple tables efficiently
   */
  async getVectorCounts(tableIds: string[]): Promise<Map<string, number>> {
    if (!tableIds || tableIds.length === 0) {
      return new Map();
    }

    // Validate and filter IDs
    const validIds = tableIds.filter(isUUID);

    if (validIds.length === 0) {
      logger.debug('No valid UUIDs in getVectorCounts', { 
        providedCount: tableIds.length 
      });
      return new Map();
    }

    const client = this.supabase.getClient();
    
    try {
      const result = await client
        .from('agent_vector_data')
        .select('table_id')
        .in('table_id', validIds) as SupabaseResponse<Array<{ table_id: string }>>;
      
      if (result.error) {
        throw result.error;
      }

      const counts = new Map<string, number>();
      (result.data || []).forEach((row) => {
        counts.set(row.table_id, (counts.get(row.table_id) || 0) + 1);
      });
      
      return counts;
    } catch (error) {
      logger.debug('Error fetching vector counts', { 
        error: isDatabaseError(error) ? error.message : String(error),
        tableIdsCount: validIds.length
      });
      return new Map();
    }
  }

  /**
   * Get file manifests for a table with pagination
   */
  async getFileManifests(tableId: string, limit: number = 100): Promise<FileManifestData[]> {
    assertUUID(tableId, 'table ID');

    try {
      const result = await this.agentRowsRepo.findByTable(tableId, { 
        page: 1, 
        limit 
      });
      
      const rows = (result.data || []) as Array<{ row_data: unknown }>;
      
      return rows
        .map(r => r.row_data)
        .filter((d): d is FileManifestData => 
          d !== null &&
          typeof d === 'object' &&
          'type' in d &&
          d.type === 'knowledge_file'
        );
    } catch (error) {
      logger.debug('Error fetching file manifests', { 
        tableId: tableId.substring(0, 8), 
        error: isDatabaseError(error) ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Insert multiple vector records in a single batch
   */
  async insertVectorBatch(records: VectorRecord[]): Promise<number> {
    if (!records || records.length === 0) {
      return 0;
    }

    // Set tenant context from first record (all should have same tenant_id)
    const firstRecord = records[0];
    if (firstRecord && firstRecord.tenant_id) {
      await this.setTenantContext(firstRecord.tenant_id);
    }

    const client = this.supabase.getClient();
    const batchSize = CONFIG.BATCH_SIZE || 100;
    let totalInserted = 0;

    // Process in sub-batches to avoid payload limits
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      try {
        const inserted = await RETRY.database.execute(
          async () => {
            const result = await client
              .from('agent_vector_data')
              .insert(batch as any) as SupabaseResponse<unknown>;
            
            if (result.error) {
              throw result.error;
            }
            
            return batch.length;
          },
          { 
            operation: 'insertVectorBatch', 
            metadata: { 
              batchSize: batch.length,
              offset: i 
            } 
          }
        );
        
        totalInserted += inserted;
      } catch (error) {
        logger.error('Vector batch insert failed', {
          batchIndex: i,
          batchSize: batch.length,
          error: isDatabaseError(error) ? error.message : String(error)
        });
        throw error;
      }
    }

    return totalInserted;
  }

  /**
   * Insert a single vector record
   */
  async insertVectorSingle(record: VectorRecord): Promise<boolean> {
    // Set tenant context for RLS policy
    if (record.tenant_id) {
      await this.setTenantContext(record.tenant_id);
    }

    const client = this.supabase.getClient();
    
    try {
      await RETRY.database.execute(
        async () => {
          const result = await client
            .from('agent_vector_data')
            .insert([record] as any) as SupabaseResponse<unknown>;
          
          if (result.error) {
            throw result.error;
          }
        },
        { operation: 'insertVectorSingle' }
      );
      
      return true;
    } catch (error) {
      logger.debug('Single vector insert failed', { 
        error: isDatabaseError(error) ? error.message : String(error),
        tableId: record.table_id?.substring(0, 8)
      });
      return false;
    }
  }

  /**
   * CRITICAL METHOD #1: Insert multiple vector records and return their IDs
   * Required for rollback tracking in VectorService.generateAndStore
   * @param records - Array of vector records to insert
   * @returns Array of inserted vector IDs for rollback tracking
   */
  async insertVectorBatchWithIds(records: VectorRecord[]): Promise<string[]> {
    if (!records || records.length === 0) {
      return [];
    }

    // Set tenant context from first record (all should have same tenant_id)
    const firstRecord = records[0];
    if (firstRecord && firstRecord.tenant_id) {
      await this.setTenantContext(firstRecord.tenant_id);
    }

    const client = this.supabase.getClient();
    const batchSize = CONFIG.BATCH_SIZE || 100;
    const allIds: string[] = [];

    // Process in sub-batches to avoid payload limits
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      try {
        const insertedIds = await RETRY.database.execute(
          async () => {
            const result = await client
              .from('agent_vector_data')
              .insert(batch as any)
              .select('id') as SupabaseResponse<Array<{ id: string }>>;

            if (result.error) {
              throw result.error;
            }

            return result.data?.map(r => r.id) || [];
          },
          {
            operation: 'insertVectorBatchWithIds',
            metadata: {
              batchSize: batch.length,
              offset: i
            }
          }
        );

        allIds.push(...insertedIds);

        logger.debug('Vector batch inserted with IDs', {
          batchIndex: i,
          batchSize: batch.length,
          idsReturned: insertedIds.length
        });
      } catch (error) {
        logger.error('Vector batch insert with IDs failed', {
          batchIndex: i,
          batchSize: batch.length,
          error: isDatabaseError(error) ? error.message : String(error)
        });
        throw error;
      }
    }

    return allIds;
  }

  /**
   * CRITICAL METHOD #2: Delete vectors by their IDs (for rollback operations)
   * Required for rollback in VectorService when embeddings fail
   * @param ids - Array of vector IDs to delete
   */
  async deleteVectorsByIds(ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) {
      logger.debug('No vector IDs to delete');
      return;
    }

    // Validate all IDs are UUIDs
    const validIds = ids.filter(isUUID);

    if (validIds.length === 0) {
      logger.warn('No valid UUID IDs provided for deletion', {
        providedCount: ids.length
      });
      return;
    }

    if (validIds.length !== ids.length) {
      logger.warn('Some invalid UUIDs filtered out', {
        total: ids.length,
        valid: validIds.length,
        filtered: ids.length - validIds.length
      });
    }

    const client = this.supabase.getClient();

    try {
      // Delete in batches to avoid query size limits
      const BATCH_SIZE = 100;
      let totalDeleted = 0;

      for (let i = 0; i < validIds.length; i += BATCH_SIZE) {
        const batch = validIds.slice(i, i + BATCH_SIZE);

        const result = await client
          .from('agent_vector_data')
          .delete()
          .in('id', batch) as SupabaseResponse<unknown>;

        if (result.error) {
          throw result.error;
        }

        totalDeleted += batch.length;
      }

      logger.debug('Vectors deleted by IDs', {
        requestedCount: validIds.length,
        deletedCount: totalDeleted
      });
    } catch (error) {
      logger.error('Failed to delete vectors by IDs', {
        idsCount: validIds.length,
        error: isDatabaseError(error) ? error.message : String(error)
      });
      throw new Error(
        `Failed to delete vectors: ${isDatabaseError(error) ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * CRITICAL METHOD #3: Atomically swap vectors: activate new chunks, deactivate old chunks
   * This prevents race conditions where searches return no results during document edits
   * Uses RPC if available, falls back to manual atomic operations
   * @param parentFileId - Parent file ID whose vectors should be deactivated
   * @param newChunkIds - Array of new chunk IDs to activate
   * @param tenantId - Tenant ID for RLS policy (optional, but recommended)
   * @returns Count of activated and deactivated chunks
   */
  async atomicVectorSwap(
    parentFileId: string, 
    newChunkIds: string[],
    tenantId?: string
  ): Promise<{ activated: number; deactivated: number }> {
    assertUUID(parentFileId, 'parent file ID');

    // Validate all new chunk IDs are UUIDs
    if (!newChunkIds.every(id => isUUID(id))) {
      throw new Error('All new chunk IDs must be valid UUIDs');
    }

    // Set tenant context for RLS policy if provided
    if (tenantId) {
      await this.setTenantContext(tenantId);
    }

    const client = this.supabase.getClient() as any;

    try {
      // Try RPC function first if available (more atomic)
      const rpcCall = client.rpc;
      if (rpcCall && typeof rpcCall === 'function') {
        try {
          const { data, error } = await rpcCall('atomic_vector_swap', {
            p_old_parent_id: parentFileId,
            p_new_chunk_ids: newChunkIds
          });

          if (!error && data && data.length > 0) {
            const activated = data[0]?.activated_count || 0;
            const deactivated = data[0]?.deactivated_count || 0;

            logger.debug('Atomic vector swap completed via RPC', {
              parentFileId: parentFileId.substring(0, 8),
              newChunks: newChunkIds.length,
              activated,
              deactivated
            });

            return { activated, deactivated };
          }
        } catch (rpcError) {
          logger.debug('RPC atomic_vector_swap not available, using fallback', {
            error: isDatabaseError(rpcError) ? rpcError.message : String(rpcError)
          });
        }
      }

      // Fallback: Manual atomic swap
      // Strategy: Activate new chunks first, then deactivate old ones
      // This ensures there's always active data available (prevents search gaps)

      let activated = 0;
      let deactivated = 0;

      // 1. Activate new chunks (make them searchable immediately)
      if (newChunkIds.length > 0) {
        const activateResult = await client
          .from('agent_vector_data')
          .update({ is_active: true })
          .in('id', newChunkIds)
          .select('id') as SupabaseResponse<Array<{ id: string }>>;

        if (activateResult.error) {
          throw new Error(`Failed to activate new chunks: ${activateResult.error.message}`);
        }
        activated = activateResult.data?.length || 0;
      }

      // 2. Deactivate old chunks (only those that are still active and not in new set)
      // This prevents deactivating chunks we just activated
      const deactivateResult = await client
        .from('agent_vector_data')
        .update({ 
          is_active: false, 
          replaced_at: new Date().toISOString() 
        })
        .eq('parent_file_id', parentFileId)
        .eq('is_active', true)
        .not('id', 'in', `(${newChunkIds.map(id => `'${id}'`).join(',')})`)
        .select('id') as SupabaseResponse<Array<{ id: string }>>;

      if (deactivateResult.error) {
        logger.warn('Failed to deactivate old chunks after activating new ones', {
          oldFileId: parentFileId.substring(0, 8),
          error: deactivateResult.error
        });
        // Don't throw - new chunks are already active, so search will work
      } else {
        deactivated = deactivateResult.data?.length || 0;
      }

      logger.debug('Atomic vector swap completed (fallback)', {
        parentFileId: parentFileId.substring(0, 8),
        newChunks: newChunkIds.length,
        activated,
        deactivated
      });

      return { activated, deactivated };
    } catch (error) {
      logger.error('Atomic vector swap error', {
        parentFileId: parentFileId.substring(0, 8),
        newChunksCount: newChunkIds.length,
        error: isDatabaseError(error) ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Create a file manifest record
   * Note: agentId and tenantId are varchar strings, not UUIDs
   */
  async createFileManifest(data: CreateFileManifestParams): Promise<string> {
    assertUUID(data.tableId, 'table ID');
    // agentId and tenantId are varchar strings, not UUIDs - just validate they exist
    if (!data.agentId || typeof data.agentId !== 'string') {
      throw new Error('Agent ID is required and must be a string');
    }
    if (!data.tenantId || typeof data.tenantId !== 'string') {
      throw new Error('Tenant ID is required and must be a string');
    }
    // Set tenant context for RLS policy
    await this.setTenantContext(data.tenantId);

    const client = this.supabase.getClient() as any;
    
    const manifestData: FileManifestData = {
      type: 'knowledge_file',
      fileName: data.fileName,
      sizeBytes: data.sizeBytes,
      uploadedAt: new Date().toISOString(),
      is_editable: false
    };

    const record = {
      table_id: data.tableId,
      agent_id: data.agentId,
      tenant_id: data.tenantId,
      row_data: manifestData
    };

    const result = await client
      .from('agent_table_rows')
      .insert([record])
      .select('id')
      .single() as SupabaseResponse<{ id: string }>;
    
    if (result.error || !result.data) {
      throw new Error(
        `Failed to create file manifest: ${result.error?.message || 'Unknown error'}`
      );
    }
    
    return result.data.id;
  }

  /**
   * Update a file manifest's row_data
   */
  async updateFileManifest(fileId: string, data: FileManifestData): Promise<void> {
    assertUUID(fileId, 'file ID');

    const client = this.supabase.getClient() as any;
    
    const result = await client
      .from('agent_table_rows')
      .update({ row_data: data })
      .eq('id', fileId) as SupabaseResponse<unknown>;
    
    if (result.error) {
      throw new Error(`Failed to update file manifest: ${result.error.message}`);
    }
  }

  /**
   * Delete a file manifest record
   */
  async deleteFileManifest(fileId: string): Promise<void> {
    assertUUID(fileId, 'file ID');

    const client = this.supabase.getClient();
    
    const result = await client
      .from('agent_table_rows')
      .delete()
      .eq('id', fileId) as SupabaseResponse<unknown>;
    
    if (result.error) {
      throw new Error(`Failed to delete file manifest: ${result.error.message}`);
    }
  }

  /**
   * Soft delete vectors (mark as inactive)
   */
  async softDeleteVectors(parentFileId: string): Promise<void> {
    assertUUID(parentFileId, 'file ID');

    const client = this.supabase.getClient() as any;
    
    const result = await client
      .from('agent_vector_data')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('parent_file_id', parentFileId)
      .eq('is_active', true) as SupabaseResponse<unknown>;
    
    if (result.error) {
      logger.warn('Soft delete vectors failed', { 
        parentFileId: parentFileId.substring(0, 8),
        error: result.error 
      });
    }
  }

  /**
   * Hard delete vectors (permanent removal)
   */
  async hardDeleteVectors(parentFileId: string): Promise<void> {
    assertUUID(parentFileId, 'file ID');

    const client = this.supabase.getClient();
    
    const result = await client
      .from('agent_vector_data')
      .delete()
      .eq('parent_file_id', parentFileId) as SupabaseResponse<unknown>;
    
    if (result.error) {
      logger.warn('Hard delete vectors failed', { 
        parentFileId: parentFileId.substring(0, 8),
        error: result.error 
      });
    }
  }

  /**
   * Get a document by file ID and agent ID (with access control)
   * Note: agentId is varchar string, not UUID
   */
  async getDocument(fileId: string, agentId: string): Promise<TableRowRecord | null> {
    assertUUID(fileId, 'file ID');
    // agentId is varchar string, not UUID - just validate it exists
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('Agent ID is required and must be a string');
    }

    const client = this.supabase.getClient();
    
    const result = await client
      .from('agent_table_rows')
      .select('*')
      .eq('id', fileId)
      .eq('agent_id', agentId)
      .single() as SupabaseResponse<TableRowRecord>;
    
    if (result.error || !result.data) {
      logger.debug('Document not found', { 
        fileId: fileId.substring(0, 8),
        agentId: agentId.substring(0, 8)
      });
      return null;
    }
    
    return result.data;
  }

  /**
   * Get default column schema for knowledge base tables
   */
  private getDefaultColumns(): ColumnDefinition[] {
    return [
      { name: 'id', type: 'text', required: true, primaryKey: true },
      { name: 'content', type: 'text', required: true },
      { name: 'embedding', type: 'vector', required: false, dimensions: 1024 },
      { name: 'metadata', type: 'json', required: false },
      { name: 'created_at', type: 'timestamp', required: true },
      { name: 'url', type: 'text', required: true },
      { name: 'title', type: 'text', required: false }
    ];
  }

  /**
   * Health check for repository dependencies
   */
  async healthCheck(): Promise<{ healthy: boolean; details: Record<string, boolean> }> {
    const checks: Record<string, boolean> = {
      supabase: false,
      agentTablesRepo: false,
      agentRowsRepo: false
    };

    try {
      const client = this.supabase.getClient();
      
      // Test Supabase connection
      const pingResult = await client
        .from('agent_tables_columns')
        .select('id')
        .limit(1) as SupabaseResponse<unknown[]>;
      
      checks.supabase = !pingResult.error;
      checks.agentTablesRepo = !!this.agentTablesRepo;
      checks.agentRowsRepo = !!this.agentRowsRepo;

      const healthy = Object.values(checks).every(v => v === true);
      return { healthy, details: checks };
    } catch (error) {
      logger.error('Repository health check failed', {
        error: isDatabaseError(error) ? error.message : String(error)
      });
      return { healthy: false, details: checks };
    }
  }
}