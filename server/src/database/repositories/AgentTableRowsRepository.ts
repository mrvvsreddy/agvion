// path: database/repositories/AgentTableRowsRepository.ts

import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type AgentTableRow = Database['public']['Tables']['agent_table_rows']['Row'];
type AgentTableRowInsert = Database['public']['Tables']['agent_table_rows']['Insert'];
type AgentTableRowUpdate = Database['public']['Tables']['agent_table_rows']['Update'];

export class AgentTableRowsRepository extends BaseRepository<AgentTableRow, AgentTableRowInsert, AgentTableRowUpdate> {
  constructor() {
    super('agent_table_rows');
  }

  /**
   * Find rows by table ID with proper JSONB handling
   */
  async findByTable(
    tableId: string,
    options: PaginationOptions = {},
    tenantId?: string
  ): Promise<PaginatedResult<AgentTableRow>> {
    try {
      logger.info('AgentTableRowsRepository.findByTable: starting operation', {
        tableId,
        options
      });

      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let countQuery = this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId);

      if (tenantId) {
        countQuery = countQuery.eq('tenant_id', tenantId);
      }

      const { count } = await countQuery;

      let baseQuery = this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableId);

      if (tenantId) {
        baseQuery = baseQuery.eq('tenant_id', tenantId);
      }

      const { data, error } = await baseQuery
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('AgentTableRowsRepository.findByTable: database error', { 
          error: error.message, 
          tableId, 
          options,
          errorCode: error.code
        });
        throw new Error(`Failed to get rows by table: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      logger.info('AgentTableRowsRepository.findByTable: operation completed', {
        tableId,
        rowCount: data?.length || 0,
        totalCount,
        page,
        totalPages
      });

      return {
        data: data as AgentTableRow[] || [],
        totalCount,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error('AgentTableRowsRepository.findByTable: operation failed', { 
        error: error instanceof Error ? error.message : String(error), 
        tableId, 
        options 
      });
      throw error;
    }
  }

  /**
   * Find rows by JSONB field values with correct syntax
   */
  async findByJsonField(
    tableId: string,
    fieldName: string,
    fieldValue: any,
    options: PaginationOptions = {},
    tenantId?: string
  ): Promise<PaginatedResult<AgentTableRow>> {
    try {
      logger.info('AgentTableRowsRepository.findByJsonField: starting operation', {
        tableId,
        fieldName,
        fieldValue,
        options
      });

      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // FIXED: Use correct JSONB text extraction operator
      let countQuery = this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId)
        .eq(`row_data->>'${fieldName}'`, fieldValue);

      if (tenantId) {
        countQuery = countQuery.eq('tenant_id', tenantId);
      }

      const { count } = await countQuery;

      let baseQuery = this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableId)
        .eq(`row_data->>'${fieldName}'`, fieldValue);

      if (tenantId) {
        baseQuery = baseQuery.eq('tenant_id', tenantId);
      }

      const { data, error } = await baseQuery
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('AgentTableRowsRepository.findByJsonField: database error', {
          error: error.message,
          tableId,
          fieldName,
          fieldValue,
          errorCode: error.code
        });
        throw new Error(`Failed to find rows by JSON field: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      logger.info('AgentTableRowsRepository.findByJsonField: operation completed', {
        tableId,
        fieldName,
        fieldValue,
        rowCount: data?.length || 0,
        totalCount
      });

      return {
        data: data as AgentTableRow[] || [],
        totalCount,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error('AgentTableRowsRepository.findByJsonField: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        tableId,
        fieldName,
        fieldValue
      });
      throw error;
    }
  }

  /**
   * Count rows by JSONB field with correct syntax
   */
  async countByJsonField(tableId: string, fieldName: string, fieldValue: any, tenantId?: string): Promise<number> {
    try {
      logger.info('AgentTableRowsRepository.countByJsonField: starting operation', {
        tableId,
        fieldName,
        fieldValue
      });

      // FIXED: Use correct JSONB text extraction operator
      let countQuery = this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId)
        .eq(`row_data->>'${fieldName}'`, fieldValue);

      if (tenantId) {
        countQuery = countQuery.eq('tenant_id', tenantId);
      }

      const { count, error } = await countQuery;

      if (error) {
        logger.error('AgentTableRowsRepository.countByJsonField: database error', {
          error: error.message,
          tableId,
          fieldName,
          fieldValue,
          errorCode: error.code
        });
        throw new Error(`Failed to count rows by JSON field: ${error.message}`);
      }

      const result = count || 0;

      logger.info('AgentTableRowsRepository.countByJsonField: operation completed', {
        tableId,
        fieldName,
        fieldValue,
        count: result
      });

      return result;
    } catch (error) {
      logger.error('AgentTableRowsRepository.countByJsonField: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        tableId,
        fieldName,
        fieldValue
      });
      return 0; // Return 0 on error for graceful degradation
    }
  }

  /**
   * Bulk insert rows with validation
   */
  async createMany(rows: readonly AgentTableRowInsert[]): Promise<AgentTableRow[]> {
    try {
      logger.info('AgentTableRowsRepository.createMany: starting operation', { 
        rowCount: rows.length 
      });

      if (rows.length === 0) {
        logger.info('AgentTableRowsRepository.createMany: no rows to insert');
        return [];
      }

      // Validate that all rows have required fields
      const invalidRows = rows.filter(row => !row.table_id || !row.agent_id);
      if (invalidRows.length > 0) {
        logger.error('AgentTableRowsRepository.createMany: invalid rows detected', {
          invalidCount: invalidRows.length,
          totalCount: rows.length
        });
        throw new Error(`${invalidRows.length} rows missing required table_id or agent_id`);
      }

      const { data, error } = await this.client
        .from('agent_table_rows')
        .insert(rows as any)
        .select();

      if (error) {
        logger.error('AgentTableRowsRepository.createMany: database error', { 
          error: error.message, 
          rowCount: rows.length,
          errorCode: error.code
        });
        throw new Error(`Bulk insert failed: ${error.message}`);
      }

      const result = (data as AgentTableRow[]) ?? [];

      logger.info('AgentTableRowsRepository.createMany: operation completed', {
        requestedCount: rows.length,
        insertedCount: result.length
      });

      return result;
    } catch (error) {
      logger.error('AgentTableRowsRepository.createMany: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        rowCount: rows.length
      });
      throw error;
    }
  }

  /**
   * Create a document row with original content, returning its id
   */
  async createDocumentRow(input: {
    tableId: string;
    agentId: string;
    tenantId: string;
    rowData: AgentTableRowInsert['row_data'];
  }): Promise<{ id: string }> {
    const { tableId, agentId, tenantId, rowData } = input;
    const { data, error } = await this.client
      .from('agent_table_rows')
      .insert({
        table_id: tableId,
        agent_id: agentId,
        tenant_id: tenantId,
        row_data: rowData as any
      } as AgentTableRowInsert)
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`Failed to create document row: ${error?.message}`);
    }
    return { id: (data as any).id };
  }

  /**
   * Update chunk_count in row_data (caller must pass current row_data)
   */
  async updateChunkCount(fileId: string, newChunkCount: number, currentRowData: any): Promise<void> {
    const { error } = await this.client
      .from('agent_table_rows')
      .update({ row_data: { ...currentRowData, chunk_count: newChunkCount } })
      .eq('id', fileId);
    if (error) {
      throw new Error(`Failed to update chunk_count: ${error.message}`);
    }
  }

  /**
   * Fetch a document by id ensuring ownership by agent
   */
  async getByIdOwned(fileId: string, agentId: string): Promise<AgentTableRow | null> {
    const { data, error } = await this.client
      .from('agent_table_rows')
      .select('*')
      .eq('id', fileId)
      .eq('agent_id', agentId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch document: ${error.message}`);
    }
    return (data as AgentTableRow) ?? null;
  }

  /**
   * Bulk delete rows with validation
   */
  async deleteMany(tableId: string, rowIds: readonly string[]): Promise<number> {
    try {
      logger.info('AgentTableRowsRepository.deleteMany: starting operation', { 
        tableId, 
        rowCount: rowIds.length 
      });

      if (rowIds.length === 0) {
        logger.info('AgentTableRowsRepository.deleteMany: no rows to delete');
        return 0;
      }

      if (!tableId?.trim()) {
        throw new Error('tableId is required for bulk delete operation');
      }

      const { error, count } = await this.client
        .from('agent_table_rows')
        .delete({ count: 'exact' })
        .eq('table_id', tableId)
        .in('id', rowIds);

      if (error) {
        logger.error('AgentTableRowsRepository.deleteMany: database error', { 
          error: error.message, 
          tableId, 
          rowIds,
          errorCode: error.code
        });
        throw new Error(`Bulk delete failed: ${error.message}`);
      }

      const deletedCount = count ?? 0;

      logger.info('AgentTableRowsRepository.deleteMany: operation completed', { 
        tableId,
        requestedCount: rowIds.length,
        deletedCount
      });

      return deletedCount;
    } catch (error) {
      logger.error('AgentTableRowsRepository.deleteMany: operation failed', { 
        error: error instanceof Error ? error.message : String(error),
        tableId,
        rowIds
      });
      throw error;
    }
  }

  /**
   * Get most recent rows from a table
   */
  async getRecentRows(
    tableId: string,
    limit: number = 10,
    orderBy: string = 'created_at'
  ): Promise<AgentTableRow[]> {
    try {
      logger.info('AgentTableRowsRepository.getRecentRows: starting operation', {
        tableId,
        limit,
        orderBy
      });

      if (limit <= 0 || limit > 1000) {
        throw new Error('limit must be between 1 and 1000');
      }

      const { data, error } = await this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableId)
        .order(orderBy, { ascending: false })
        .limit(limit);

      if (error) {
        logger.error('AgentTableRowsRepository.getRecentRows: database error', {
          error: error.message,
          tableId,
          limit,
          orderBy,
          errorCode: error.code
        });
        throw new Error(`Failed to get recent rows: ${error.message}`);
      }

      const result = (data as AgentTableRow[]) ?? [];

      logger.info('AgentTableRowsRepository.getRecentRows: operation completed', {
        tableId,
        requestedLimit: limit,
        returnedCount: result.length
      });

      return result;
    } catch (error) {
      logger.error('AgentTableRowsRepository.getRecentRows: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        tableId,
        limit
      });
      throw error;
    }
  }

  /**
   * Search rows by text in JSONB fields
   */
  async searchInJsonFields(
    tableId: string,
    searchText: string,
    searchFields: string[] = [],
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<AgentTableRow>> {
    try {
      logger.info('AgentTableRowsRepository.searchInJsonFields: starting operation', {
        tableId,
        searchText,
        searchFields,
        options
      });

      if (!searchText?.trim()) {
        throw new Error('searchText is required');
      }

      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let baseQuery = this.client
        .from('agent_table_rows')
        .select('*')
        .eq('table_id', tableId);

      let countQuery = this.client
        .from('agent_table_rows')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId);

      if (searchFields.length > 0) {
        // Search in specific JSONB fields
        const searchConditions = searchFields.map(field => 
          `row_data->>'${field}'.ilike.%${searchText}%`
        ).join(',');

        baseQuery = baseQuery.or(searchConditions);
        countQuery = countQuery.or(searchConditions);
      } else {
        // Search in entire JSONB as text
        baseQuery = baseQuery.ilike('row_data::text', `%${searchText}%`);
        countQuery = countQuery.ilike('row_data::text', `%${searchText}%`);
      }

      const { count } = await countQuery;

      const { data, error } = await baseQuery
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('AgentTableRowsRepository.searchInJsonFields: database error', {
          error: error.message,
          tableId,
          searchText,
          searchFields,
          errorCode: error.code
        });
        throw new Error(`Search in JSON fields failed: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      logger.info('AgentTableRowsRepository.searchInJsonFields: operation completed', {
        tableId,
        searchText,
        searchFields,
        foundRows: data?.length || 0,
        totalCount
      });

      return {
        data: data as AgentTableRow[] || [],
        totalCount,
        page,
        limit,
        totalPages,
      };
    } catch (error) {
      logger.error('AgentTableRowsRepository.searchInJsonFields: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        tableId,
        searchText,
        searchFields
      });
      throw error;
    }
  }
}

export default new AgentTableRowsRepository();