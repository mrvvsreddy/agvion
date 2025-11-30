// database/repositories/AgentTablesColumnsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type AgentTable = Database['public']['Tables']['agent_tables']['Row'];
type AgentTableInsert = Database['public']['Tables']['agent_tables']['Insert'];
type AgentTableUpdate = Database['public']['Tables']['agent_tables']['Update'];

// Valid table types
export type TableType = 'system' | 'knowledge' | 'custom';

export class AgentTablesRepository extends BaseRepository<AgentTable, AgentTableInsert, AgentTableUpdate> {
  constructor() {
    super('agent_tables');
  }

  /**
   * Validate table type is one of the allowed values
   */
  private validateTableType(type: string | null | undefined): type is TableType {
    return type === 'system' || type === 'knowledge' || type === 'custom';
  }

  /**
   * Ensure tenant and agent context are set for RLS (Row Level Security)
   * This must be called before database operations to ensure proper tenant isolation
   */
  private async ensureTenantContext(tenantId?: string, agentId?: string): Promise<void> {
    try {
      if (!tenantId) return;

      await this.client.rpc('set_config', { key: 'app.current_tenant', value: tenantId });

      if (agentId) {
        await this.client.rpc('set_config', { key: 'app.current_agent', value: agentId });
      }

      logger.info('Tenant context set successfully', { tenantId, agentId });
    } catch (err) {
      logger.warn('Failed to set tenant/agent context (non-fatal)', { err, tenantId, agentId });
    }
  }

  async findByAgent(agentId: string, allowedTypes?: TableType[], tenantId?: string): Promise<AgentTable[]> {
    try {
      // Pre-operation audit log
      logger.info('AgentTablesRepository.findByAgent: preflight', {
        agentId,
        allowedTypes,
        tenantId
      });

      // Ensure tenant and agent context are set for RLS
      await this.ensureTenantContext(tenantId, agentId);
      
      let query = this.client
        .from('agent_tables')
        .select('*')
        .eq('agent_id', agentId);

      // Filter by allowed types if provided (default: knowledge and custom, exclude system)
      if (allowedTypes && allowedTypes.length > 0) {
        query = query.in('type', allowedTypes);
      } else {
        // Default: only return knowledge and custom tables, exclude system
        query = query.in('type', ['knowledge', 'custom']);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get tables by agent', { error, agentId });
        throw new Error(`Failed to get tables by agent: ${error.message}`);
      }

      // Additional client-side validation to ensure type safety
      const validTables = (data as AgentTable[]).filter(table => 
        this.validateTableType(table.type)
      );

      if (validTables.length !== (data?.length || 0)) {
        logger.warn('Some tables had invalid types and were filtered out', {
          agentId,
          total: data?.length || 0,
          valid: validTables.length
        });
      }

      return validTables;
    } catch (error) {
      logger.error('Error getting tables by agent', { error, agentId });
      throw error;
    }
  }

  // findByTenant intentionally not implemented to match base signature

  async findByAgentAndName(agentId: string, tableName: string): Promise<AgentTable | null> {
    try {
      logger.info('AgentTablesRepository.findByAgentAndName: preflight', { agentId, tableName });
      const { data, error } = await this.client
        .from('agent_tables')
        .select('*')
        .eq('agent_id', agentId)
        .eq('table_name', tableName)
        .maybeSingle();
      if (error) {
        logger.error('Failed to find table by agent and name', { error, agentId, tableName });
        throw new Error(`Failed to find table by agent and name: ${error.message}`);
      }
      return (data as AgentTable | null) ?? null;
    } catch (error) {
      logger.error('Error finding table by agent and name', { error, agentId, tableName });
      throw error;
    }
  }

  async findByAgentTenantAndName(agentId: string, tenantId: string, tableName: string): Promise<AgentTable | null> {
    try {
      logger.info('AgentTablesRepository.findByAgentTenantAndName: preflight', { agentId, tenantId, tableName });
      
      // Ensure tenant and agent context are set for RLS
      await this.ensureTenantContext(tenantId, agentId);
      
      const { data, error } = await this.client
        .from('agent_tables')
        .select('*')
        .eq('agent_id', agentId)
        .eq('tenant_id', tenantId)
        .eq('table_name', tableName)
        .maybeSingle();
      if (error) {
        logger.error('Failed to find table by agent, tenant and name', { error, agentId, tenantId, tableName });
        throw new Error(`Failed to find table by agent, tenant and name: ${error.message}`);
      }
      return (data as AgentTable | null) ?? null;
    } catch (error) {
      logger.error('Error finding table by agent, tenant and name', { error, agentId, tenantId, tableName });
      throw error;
    }
  }

  async upsertTable(table: AgentTableInsert): Promise<AgentTable> {
    try {
      // Validate table type if provided
      if (table.type && !this.validateTableType(table.type)) {
        logger.error('Invalid table type provided', { 
          type: table.type, 
          agentId: table.agent_id, 
          tableName: table.table_name 
        });
        throw new Error(`Invalid table type: ${table.type}. Must be one of: system, knowledge, custom`);
      }

      logger.info('AgentTablesRepository.upsertTable: preflight', { 
        agentId: table.agent_id, 
        tableName: table.table_name,
        type: table.type
      });

      // 🧩 Ensure tenant and agent context are set for RLS
      await this.ensureTenantContext(table.tenant_id, table.agent_id);
      
      const { data, error } = await this.client
        .from('agent_tables')
        .upsert(table, { onConflict: 'agent_id,table_name' })
        .select()
        .maybeSingle();
      if (error) {
        logger.error('Failed to upsert agent table', { error, table });
        throw new Error(`Upsert table failed: ${error.message}`);
      }
      return data as AgentTable;
    } catch (error) {
      logger.error('Error upserting agent table', { error, table });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const { error } = await this.client
        .from('agent_tables')
        .delete()
        .eq('id', id);
      if (error) {
        logger.error('Failed to delete agent table', { error, id });
        throw new Error(`Delete table failed: ${error.message}`);
      }
      return true;
    } catch (error) {
      logger.error('Error deleting agent table', { error, id });
      return false;
    }
  }
}

export default new AgentTablesRepository();

