// database/repositories/AgentVectorDataRepository.ts

import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type AgentVectorData = Database['public']['Tables']['agent_vector_data']['Row'];
type AgentVectorDataInsert = Database['public']['Tables']['agent_vector_data']['Insert'];
type AgentVectorDataUpdate = Database['public']['Tables']['agent_vector_data']['Update'];

export class AgentVectorDataRepository extends BaseRepository<AgentVectorData, AgentVectorDataInsert, AgentVectorDataUpdate> {
  constructor() {
    super('agent_vector_data');
  }

  /**
   * Get vector rows by `agent_id` with pagination
   */
  async findByAgent(
    agentId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<AgentVectorData>> {
    const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    try {
      const { count } = await this.client
        .from('agent_vector_data')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId);

      const { data, error } = await this.client
        .from('agent_vector_data')
        .select('*')
        .eq('agent_id', agentId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('AgentVectorDataRepository.findByAgent: database error', { error: error.message, agentId, errorCode: error.code });
        throw new Error(`Failed to find vectors by agent: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: (data as AgentVectorData[]) || [],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('AgentVectorDataRepository.findByAgent: operation failed', { error: error instanceof Error ? error.message : String(error), agentId });
      throw error;
    }
  }

  /**
   * Get vector rows by `table_id` with validation that the agent table exists.
   */
  async findByTable(
    tableId: string,
    options: PaginationOptions = {},
    onlyActive: boolean = true
  ): Promise<PaginatedResult<AgentVectorData>> {
    const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    try {
      // Validate linkage to agent_tables
      const { data: tableRecord, error: tableError } = await this.client
        .from('agent_tables')
        .select('id')
        .eq('id', tableId)
        .single();

      if (tableError) {
        if (tableError.code === 'PGRST116') {
          throw new Error('Referenced agent table not found');
        }
        logger.error('AgentVectorDataRepository.findByTable: validation error', { error: tableError.message, tableId, errorCode: tableError.code });
        throw new Error(`Failed to validate table: ${tableError.message}`);
      }

      if (!tableRecord?.id) {
        throw new Error('Referenced agent table not found');
      }

      let countQuery = this.client
        .from('agent_vector_data')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId);
      if (onlyActive) countQuery = countQuery.eq('is_active', true);
      const { count } = await countQuery;

      let baseQuery = this.client
        .from('agent_vector_data')
        .select('*')
        .eq('table_id', tableId);
      if (onlyActive) baseQuery = baseQuery.eq('is_active', true);
      const { data, error } = await baseQuery
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('AgentVectorDataRepository.findByTable: database error', { error: error.message, tableId, errorCode: error.code });
        throw new Error(`Failed to find vectors by table: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: (data as AgentVectorData[]) || [],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('AgentVectorDataRepository.findByTable: operation failed', { error: error instanceof Error ? error.message : String(error), tableId });
      throw error;
    }
  }

  /**
   * Retrieve a single vector by its id with optional sanity validation
   */
  async getById(id: string): Promise<AgentVectorData | null> {
    try {
      const { data, error } = await this.client
        .from('agent_vector_data')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        logger.error('AgentVectorDataRepository.getById: database error', { error: error.message, id, errorCode: error.code });
        throw new Error(`Failed to retrieve vector: ${error.message}`);
      }

      return (data as AgentVectorData) ?? null;
    } catch (error) {
      logger.error('AgentVectorDataRepository.getById: operation failed', { error: error instanceof Error ? error.message : String(error), id });
      throw error;
    }
  }

  /**
   * Search by metadata JSONB key/value
   */
  async findByMetadata(
    key: string,
    value: string | number | boolean,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<AgentVectorData>> {
    const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    try {
      const { count } = await this.client
        .from('agent_vector_data')
        .select('*', { count: 'exact', head: true })
        .eq(`metadata->>'${key}'`, String(value));

      const { data, error } = await this.client
        .from('agent_vector_data')
        .select('*')
        .eq(`metadata->>'${key}'`, String(value))
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('AgentVectorDataRepository.findByMetadata: database error', { error: error.message, key, value, errorCode: error.code });
        throw new Error(`Failed to query by metadata: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: (data as AgentVectorData[]) || [],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('AgentVectorDataRepository.findByMetadata: operation failed', { error: error instanceof Error ? error.message : String(error), key, value });
      throw error;
    }
  }

  /**
   * Deactivate (soft-delete) all chunks for a document
   */
  async deactivateByParentFile(parentFileId: string): Promise<number> {
    const { data, error } = await this.client
      .from('agent_vector_data')
      .update({ is_active: false })
      .eq('parent_file_id', parentFileId)
      .eq('is_active', true)
      .select('id');
    if (error) {
      logger.error('AgentVectorDataRepository.deactivateByParentFile: database error', { error: error.message, parentFileId, errorCode: error.code });
      throw new Error(`Failed to deactivate chunks: ${error.message}`);
    }
    return (data as any[])?.length || 0;
  }

  /**
   * Insert chunk records in batch
   */
  async insertChunks(chunks: readonly AgentVectorDataInsert[]): Promise<number> {
    if (!chunks.length) return 0;
    const { error, count } = await this.client
      .from('agent_vector_data')
      .insert(chunks as any, { count: 'exact' });
    if (error) {
      logger.error('AgentVectorDataRepository.insertChunks: database error', { error: error.message, count: chunks.length, errorCode: error.code });
      throw new Error(`Failed to insert chunks: ${error.message}`);
    }
    return count ?? chunks.length;
  }

  /**
   * Find active chunks for a document
   */
  async findActiveByParentFile(parentFileId: string, options: PaginationOptions = {}): Promise<PaginatedResult<AgentVectorData>> {
    const { page = 1, limit = 50, orderBy = 'chunk_index', orderDirection = 'asc' } = options;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { count } = await this.client
      .from('agent_vector_data')
      .select('*', { count: 'exact', head: true })
      .eq('parent_file_id', parentFileId)
      .eq('is_active', true);

    const { data, error } = await this.client
      .from('agent_vector_data')
      .select('*')
      .eq('parent_file_id', parentFileId)
      .eq('is_active', true)
      .order(orderBy, { ascending: orderDirection === 'asc' })
      .range(from, to);

    if (error) {
      logger.error('AgentVectorDataRepository.findActiveByParentFile: database error', { error: error.message, parentFileId, errorCode: error.code });
      throw new Error(`Failed to find active chunks: ${error.message}`);
    }

    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    return {
      data: (data as AgentVectorData[]) || [],
      totalCount,
      page,
      limit,
      totalPages
    };
  }
}

export default new AgentVectorDataRepository();


