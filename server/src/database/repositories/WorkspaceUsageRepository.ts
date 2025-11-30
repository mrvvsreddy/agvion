// database/repositories/WorkspaceUsageRepository.ts
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type WorkspaceUsage = Database['public']['Tables']['workspace_usage']['Row'];
type WorkspaceUsageInsert = Database['public']['Tables']['workspace_usage']['Insert'];
type WorkspaceUsageUpdate = Database['public']['Tables']['workspace_usage']['Update'];

export class WorkspaceUsageRepository extends BaseRepository<WorkspaceUsage, WorkspaceUsageInsert, WorkspaceUsageUpdate> {
  constructor() {
    super('workspace_usage');
  }

  async findByWorkspace(workspaceId: string, options: PaginationOptions = {}): Promise<PaginatedResult<WorkspaceUsage>> {
    try {
      const { page = 1, limit = 50, orderBy = 'period_start', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { count } = await this.client
        .from('workspace_usage')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);

      const { data, error } = await this.client
        .from('workspace_usage')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find workspace usage', { error, workspaceId, options });
        throw new Error(`Failed to find workspace usage: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);
      return { data: data as WorkspaceUsage[], totalCount, page, limit, totalPages };
    } catch (error) {
      logger.error('Error finding workspace usage', { error, workspaceId, options });
      throw error;
    }
  }

  async getCurrentPeriod(workspaceId: string): Promise<WorkspaceUsage | null> {
    try {
      const { data, error } = await this.client
        .from('workspace_usage')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('Failed to get current workspace usage', { error, workspaceId });
        throw new Error(`Failed to get current workspace usage: ${error.message}`);
      }

      return (data as WorkspaceUsage) ?? null;
    } catch (error) {
      logger.error('Error getting current workspace usage', { error, workspaceId });
      throw error;
    }
  }
}

export default new WorkspaceUsageRepository();


