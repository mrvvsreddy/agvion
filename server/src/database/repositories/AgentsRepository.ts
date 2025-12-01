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

  async getAgentsByWorkspaces(workspaceIds: string[]): Promise<Agent[]> {
    try {
      if (workspaceIds.length === 0) return [];

      const { data, error } = await this.client
        .from('agents')
        .select('*')
        .in('workspace_id', workspaceIds);

      if (error) {
        logger.error('Failed to get agents by workspaces', { error, workspaceIds });
        throw new Error(`Failed to get agents by workspaces: ${error.message}`);
      }

      return data as Agent[];
    } catch (error) {
      logger.error('Error getting agents by workspaces', { error, workspaceIds });
      throw error;
    }
  }

  async getAgentsByStatus(workspaceId: string, status: string): Promise<Agent[]> {
    try {
      const { data, error } = await this.client
        .from('agents')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('status', status);

      if (error) {
        logger.error('Failed to get agents by status', { error, workspaceId, status });
        throw new Error(`Failed to get agents by status: ${error.message}`);
      }

      return data as Agent[];
    } catch (error) {
      logger.error('Error getting agents by status', { error, workspaceId, status });
      throw error;
    }
  }
}

export default new AgentsRepository();

