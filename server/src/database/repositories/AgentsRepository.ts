// database/repositories/AgentsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type Agent = Database['public']['Tables']['agents']['Row'];
type AgentInsert = Database['public']['Tables']['agents']['Insert'];
type AgentUpdate = Database['public']['Tables']['agents']['Update'];

export class AgentsRepository extends BaseRepository<Agent, AgentInsert, AgentUpdate> {
  constructor() {
    super('agents');
  }

  async getAgentsByTenant(tenantId: string): Promise<Agent[]> {
    try {
      const { data, error } = await this.client
        .from('agents')
        .select('*')
        .eq('tenant_id', tenantId);

      if (error) {
        logger.error('Failed to get agents by tenant', { error, tenantId });
        throw new Error(`Failed to get agents by tenant: ${error.message}`);
      }

      return data as Agent[];
    } catch (error) {
      logger.error('Error getting agents by tenant', { error, tenantId });
      throw error;
    }
  }

  async countByTenant(tenantId: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      if (error) {
        logger.error('Failed to count agents by tenant', { error, tenantId });
        throw new Error(`Failed to count agents by tenant: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error counting agents by tenant', { error, tenantId });
      throw error;
    }
  }

  async getAgentsByWorkspace(workspaceId: string): Promise<Agent[]> {
    try {
      const { data, error } = await this.client
        .from('agents')
        .select('*')
        .eq('workspace_id', workspaceId);

      if (error) {
        logger.error('Failed to get agents by workspace', { error, workspaceId });
        throw new Error(`Failed to get agents by workspace: ${error.message}`);
      }

      return data as Agent[];
    } catch (error) {
      logger.error('Error getting agents by workspace', { error, workspaceId });
      throw error;
    }
  }

  async getAgentsByStatus(tenantId: string, status: string): Promise<Agent[]> {
    try {
      const { data, error } = await this.client
        .from('agents')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', status);

      if (error) {
        logger.error('Failed to get agents by status', { error, tenantId, status });
        throw new Error(`Failed to get agents by status: ${error.message}`);
      }

      return data as Agent[];
    } catch (error) {
      logger.error('Error getting agents by status', { error, tenantId, status });
      throw error;
    }
  }
}

export default new AgentsRepository();

