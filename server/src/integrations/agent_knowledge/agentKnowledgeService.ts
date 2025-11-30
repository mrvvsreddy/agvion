// path: src/integrations/agent_knowledge/agentKnowledgeService.ts
// Agent Knowledge Service - Manages knowledge bases as virtual tables
// Uses agent_tables for metadata and agent_vector_data for vector storage
// Caches table metadata in Redis for fast access

import AgentTokenService from '../../agent/services/AgentTokenService';
import AgentTablesRepository from '../../database/repositories/AgentTablesColumnsRepository';
import AgentVectorDataRepository from '../../database/repositories/AgentVectorDataRepository';
import { RedisService } from '../../auth/services/RedisService';
import logger from '../../utils/logger';
import SupabaseService from '../../database/config/supabase';

// Knowledge tables no longer use dedicated Redis cache; rely on agent:studio:home cache

// Interface for cached table metadata (only essential fields)
export interface CachedKnowledgeTable {
  id: string;
  table_name: string;
  description: string | null;
  agent_id: string;
}

// Interface for public-facing knowledge base (what users see)
export interface PublicKnowledgeBase {
  id: string;
  name: string; // Derived from table_name
  type: 'knowledge';
  agentId: string;
  tenantId: string;
  tableName: string;
  description?: string;
  hasData: boolean;
  size: string;
  createdAt: string;
  updatedAt: string;
}

// Interface for vector data response (filtered for users)
export interface PublicVectorData {
  content: string;
  chunk_index: number;
}

export interface CreateKnowledgeBaseRequest {
  name: string;
  type: 'knowledge';
  agentToken: string;
  tenantId: string;
}

export interface GetKnowledgeBasesRequest {
  agentId: string;
  tenantId: string;
}

export interface GetKnowledgeBaseRequest {
  knowledgeBaseId: string;
  agentId: string;
  tenantId: string;
}

export interface UpdateKnowledgeBaseRequest {
  knowledgeBaseId: string;
  name?: string | undefined;
  agentId: string;
  tenantId: string;
}

export interface DeleteKnowledgeBaseRequest {
  knowledgeBaseId: string;
  agentId: string;
  tenantId: string;
}

export interface GetVectorDataRequest {
  tableId: string;
  agentId: string;
  tenantId: string;
  page?: number;
  limit?: number;
}

class AgentKnowledgeService {
  private static instance: AgentKnowledgeService;
  private agentTokenService: typeof AgentTokenService;
  private agentTablesRepository: typeof AgentTablesRepository;
  private vectorDataRepository: typeof AgentVectorDataRepository;
  private redisService: RedisService;

  constructor() {
    this.agentTokenService = AgentTokenService;
    this.agentTablesRepository = AgentTablesRepository;
    this.vectorDataRepository = AgentVectorDataRepository;
    this.redisService = RedisService.getInstance();
  }

  public static getInstance(): AgentKnowledgeService {
    if (!AgentKnowledgeService.instance) {
      AgentKnowledgeService.instance = new AgentKnowledgeService();
    }
    return AgentKnowledgeService.instance;
  }

  /**
   * Generate a unique table name from knowledge base name
   */
  private generateTableName(name: string): string {
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
    
    // Ensure uniqueness by adding timestamp
    const timestamp = Date.now().toString().slice(-8);
    return `${sanitizedName}_${timestamp}`;
  }

  /**
   * Cache table metadata in Redis (only essential fields)
   */
  private async cacheTableMetadata(table: any): Promise<void> {
    // No-op: dedicated knowledge cache removed
    return;
  }

  /**
   * Get table metadata from cache or database
   */
  private async getTableMetadata(tableId: string): Promise<CachedKnowledgeTable | null> {
    try {
      const table = await this.agentTablesRepository.findById(tableId);
      if (!table) {
        return null;
      }
      return {
        id: table.id,
        table_name: table.table_name,
        description: table.description,
        agent_id: table.agent_id
      };
    } catch (error) {
      logger.error('Failed to get table metadata', { error, tableId });
      return null;
    }
  }

  /**
   * Check if table has vector data
   */
  private async tableHasData(tableId: string): Promise<boolean> {
    try {
      const client = SupabaseService.getInstance().getClient();
      const { count } = await client
        .from('agent_vector_data')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId)
        .limit(1);
      
      return (count || 0) > 0;
    } catch (error) {
      logger.error('Failed to check if table has data', { error, tableId });
      return false;
    }
  }

  /**
   * Calculate table size (approximate)
   */
  private async calculateTableSize(tableId: string): Promise<string> {
    try {
      const client = SupabaseService.getInstance().getClient();
      const { count } = await client
        .from('agent_vector_data')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId);
      
      const vectorCount = count || 0;
      // Rough estimate: ~1KB per vector chunk
      const sizeInKB = vectorCount;
      if (sizeInKB < 1024) {
        return `${sizeInKB} KB`;
      }
      const sizeInMB = (sizeInKB / 1024).toFixed(2);
      return `${sizeInMB} MB`;
    } catch (error) {
      logger.error('Failed to calculate table size', { error, tableId });
      return '0 KB';
    }
  }

  /**
   * Convert table to public knowledge base format
   */
  private async tableToKnowledgeBase(table: any, tenantId: string): Promise<PublicKnowledgeBase> {
    const hasData = await this.tableHasData(table.id);
    const size = hasData ? await this.calculateTableSize(table.id) : '0 KB';
    
    // Extract name from description or use table_name
    let name = table.table_name;
    if (table.description) {
      const match = table.description.match(/Knowledge base:\s*(.+)/);
      if (match && match[1]) {
        name = match[1];
      }
    }

    return {
      id: table.id,
      name,
      type: 'knowledge',
      agentId: table.agent_id,
      tenantId,
      tableName: table.table_name,
      description: table.description || undefined,
      hasData,
      size,
      createdAt: table.created_at,
      updatedAt: table.updated_at
    };
  }

  /**
   * Create a new knowledge base (virtual table)
   */
  async createKnowledgeBase(request: CreateKnowledgeBaseRequest): Promise<{
    success: boolean;
    data?: PublicKnowledgeBase;
    message?: string;
  }> {
    try {
      const { name, type, agentToken, tenantId } = request;

      logger.info('AgentKnowledgeService.createKnowledgeBase: starting', {
        name: name.substring(0, 20) + '...',
        type,
        hasTenantId: !!tenantId
      });

      // Try to validate agent token first
      let agentTokenData = await this.agentTokenService.validateAgentToken(agentToken);
      let agentId: string;
      
      // If token validation fails, check if agentToken is actually an agentId
      // This allows frontend to pass agentId directly for convenience
      if (!agentTokenData) {
        // If it looks like an agentId (16 chars alphanumeric), try to validate it directly
        if (agentToken && /^[A-Za-z0-9]{16}$/.test(agentToken)) {
          // Import AgentService to validate agentId directly
          const AgentService = (await import('../../agent/services/AgentService')).default;
          const agentValidation = await AgentService.getAgentById(tenantId, agentToken);
          
          if (agentValidation.success && agentValidation.agent) {
            agentId = agentToken;
            // Create a pseudo token data for validation
            agentTokenData = {
              agentId: agentToken,
              tenantId: tenantId,
              workspaceId: agentValidation.agent.workspace_id || '',
              userId: '', // Not needed for this operation
              createdAt: new Date().toISOString()
            };
          } else {
            logger.warn('AgentKnowledgeService.createKnowledgeBase: invalid agent token/id', { 
              agentToken: agentToken.substring(0, 8) + '...' 
            });
            return {
              success: false,
              message: 'Invalid or expired agent token'
            };
          }
        } else {
          logger.warn('AgentKnowledgeService.createKnowledgeBase: invalid agent token', { 
            agentToken: agentToken ? agentToken.substring(0, 8) + '...' : 'missing' 
          });
          return {
            success: false,
            message: 'Invalid or expired agent token'
          };
        }
      } else {
        agentId = agentTokenData.agentId;
        
        // Verify tenant match
        if (agentTokenData.tenantId !== tenantId) {
          logger.warn('AgentKnowledgeService.createKnowledgeBase: tenant mismatch');
          return {
            success: false,
            message: 'Agent access denied'
          };
        }
      }

      // Generate unique table name
      const tableName = this.generateTableName(name);
      
      // Check if table already exists
      const existingTable = await this.agentTablesRepository.findByAgentTenantAndName(
        agentId,
        tenantId,
        tableName
      );

      if (existingTable) {
        logger.warn('AgentKnowledgeService.createKnowledgeBase: table already exists', {
          tableName: tableName.substring(0, 20) + '...',
          agentId: agentId.substring(0, 8) + '...'
        });
        return {
          success: false,
          message: 'Knowledge base with this name already exists'
        };
      }

      // Create the knowledge base table
      const tableData = {
        agent_id: agentId,
        tenant_id: tenantId,
        table_name: tableName,
        description: `Knowledge base: ${name}`,
        columns: this.getDefaultColumnsForType(type)
      };

      const createdTable = await this.agentTablesRepository.upsertTable(tableData);

      logger.info('AgentKnowledgeService.createKnowledgeBase: table created successfully', {
        tableId: createdTable.id.substring(0, 8) + '...',
        tableName: createdTable.table_name.substring(0, 20) + '...',
        agentId: agentId.substring(0, 8) + '...'
      });

      // No dedicated cache write

      // Convert to public format
      const knowledgeBase = await this.tableToKnowledgeBase(createdTable, tenantId);

      return {
        success: true,
        data: knowledgeBase
      };

    } catch (error) {
      logger.error('AgentKnowledgeService.createKnowledgeBase: error', { error, request });
      return {
        success: false,
        message: 'Failed to create knowledge base'
      };
    }
  }

  /**
   * Get all knowledge bases for an agent
   */
  async getKnowledgeBases(request: GetKnowledgeBasesRequest): Promise<{
    success: boolean;
    data?: PublicKnowledgeBase[];
    message?: string;
  }> {
    try {
      const { agentId, tenantId } = request;

      logger.info('AgentKnowledgeService.getKnowledgeBases: starting', { 
        agentId: agentId.substring(0, 8) + '...',
        tenantId: tenantId.substring(0, 8) + '...'
      });

      // Always load from database now (no dedicated knowledge cache)
      const tables = await this.agentTablesRepository.findByAgent(agentId);

      // Filter by tenant and convert to knowledge bases
      const knowledgeBases = await Promise.all(
        tables
          .filter(table => table.tenant_id === tenantId)
          .map(table => this.tableToKnowledgeBase(table, tenantId))
      );

      return {
        success: true,
        data: knowledgeBases
      };

    } catch (error) {
      logger.error('AgentKnowledgeService.getKnowledgeBases: error', { error, request });
      return {
        success: false,
        message: 'Failed to fetch knowledge bases'
      };
    }
  }

  /**
   * Get a specific knowledge base by ID
   */
  async getKnowledgeBase(request: GetKnowledgeBaseRequest): Promise<{
    success: boolean;
    data?: PublicKnowledgeBase;
    message?: string;
  }> {
    try {
      const { knowledgeBaseId, agentId, tenantId } = request;

      // Get table metadata (from cache or database)
      const tableMetadata = await this.getTableMetadata(knowledgeBaseId);
      if (!tableMetadata) {
        return {
          success: false,
          message: 'Knowledge base not found'
        };
      }

      // Verify agent and tenant match
      if (tableMetadata.agent_id !== agentId) {
        return {
          success: false,
          message: 'Knowledge base not found'
        };
      }

      // Get full table record
      const table = await this.agentTablesRepository.findById(knowledgeBaseId);
      if (!table || table.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Knowledge base not found'
        };
      }

      const knowledgeBase = await this.tableToKnowledgeBase(table, tenantId);

      return {
        success: true,
        data: knowledgeBase
      };

    } catch (error) {
      logger.error('AgentKnowledgeService.getKnowledgeBase: error', { error, request });
      return {
        success: false,
        message: 'Failed to fetch knowledge base'
      };
    }
  }

  /**
   * Update a knowledge base
   */
  async updateKnowledgeBase(request: UpdateKnowledgeBaseRequest): Promise<{
    success: boolean;
    data?: PublicKnowledgeBase;
    message?: string;
  }> {
    try {
      const { knowledgeBaseId, name, agentId, tenantId } = request;

      // Get the existing table
      const existingTable = await this.agentTablesRepository.findById(knowledgeBaseId);
      if (!existingTable || existingTable.agent_id !== agentId || existingTable.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Knowledge base not found'
        };
      }

      // Update the table
      const updateData: any = {};
      if (name) {
        updateData.description = `Knowledge base: ${name}`;
      }

      const updatedTable = await this.agentTablesRepository.update(knowledgeBaseId, updateData);

      // No dedicated cache write

      const knowledgeBase = await this.tableToKnowledgeBase(updatedTable, tenantId);

      return {
        success: true,
        data: knowledgeBase
      };

    } catch (error) {
      logger.error('AgentKnowledgeService.updateKnowledgeBase: error', { error, request });
      return {
        success: false,
        message: 'Failed to update knowledge base'
      };
    }
  }

  /**
   * Delete a knowledge base
   */
  async deleteKnowledgeBase(request: DeleteKnowledgeBaseRequest): Promise<{
    success: boolean;
    message?: string;
  }> {
    try {
      const { knowledgeBaseId, agentId, tenantId } = request;

      // Get the existing table
      const existingTable = await this.agentTablesRepository.findById(knowledgeBaseId);
      if (!existingTable || existingTable.agent_id !== agentId || existingTable.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Knowledge base not found'
        };
      }

      // Delete vector data first (cascade)
      const client = SupabaseService.getInstance().getClient();
      await client
        .from('agent_vector_data')
        .delete()
        .eq('table_id', knowledgeBaseId);

      // Delete the table
      await this.agentTablesRepository.delete(knowledgeBaseId);

      // No dedicated cache cleanup

      return {
        success: true,
        message: 'Knowledge base deleted successfully'
      };

    } catch (error) {
      logger.error('AgentKnowledgeService.deleteKnowledgeBase: error', { error, request });
      return {
        success: false,
        message: 'Failed to delete knowledge base'
      };
    }
  }

  /**
   * Get vector data for a knowledge base (filtered - only content and chunk_index)
   */
  async getVectorData(request: GetVectorDataRequest): Promise<{
    success: boolean;
    data?: PublicVectorData[];
    totalCount?: number;
    page?: number;
    limit?: number;
    message?: string;
  }> {
    try {
      const { tableId, agentId, tenantId, page = 1, limit = 50 } = request;

      // Verify table exists and belongs to agent/tenant
      const table = await this.agentTablesRepository.findById(tableId);
      if (!table || table.agent_id !== agentId || table.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Knowledge base not found'
        };
      }

      // Get vector data with pagination
      const result = await this.vectorDataRepository.findByTable(tableId, {
        page,
        limit,
        orderBy: 'chunk_index',
        orderDirection: 'asc'
      });

      // Filter to only show content and chunk_index (hide internal fields)
      const publicData: PublicVectorData[] = result.data.map((vector: any) => ({
        content: vector.content,
        chunk_index: vector.chunk_index
      }));

      return {
        success: true,
        data: publicData,
        totalCount: result.totalCount,
        page: result.page,
        limit: result.limit
      };

    } catch (error) {
      logger.error('AgentKnowledgeService.getVectorData: error', { error, request });
      return {
        success: false,
        message: 'Failed to fetch vector data'
      };
    }
  }

  /**
   * Get default columns for knowledge base type
   */
  private getDefaultColumnsForType(type: string): any {
    return [
      {
        name: 'id',
        type: 'uuid',
        required: true,
        primaryKey: true
      },
      {
        name: 'content',
        type: 'text',
        required: true
      },
      {
        name: 'chunk_index',
        type: 'integer',
        required: true
      },
      {
        name: 'embedding',
        type: 'vector',
        required: false,
        dimensions: 1024 // AWS Bedrock Titan embedding dimensions
      },
      {
        name: 'metadata',
        type: 'jsonb',
        required: false
      },
      {
        name: 'created_at',
        type: 'timestamptz',
        required: true
      },
      {
        name: 'updated_at',
        type: 'timestamptz',
        required: true
      }
    ];
  }
}

export default AgentKnowledgeService.getInstance();
