// database/repositories/WorkspaceSettingsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type WorkspaceSettings = Database['public']['Tables']['workspace_settings']['Row'];
type WorkspaceSettingsInsert = Database['public']['Tables']['workspace_settings']['Insert'];
type WorkspaceSettingsUpdate = Database['public']['Tables']['workspace_settings']['Update'];

export class WorkspaceSettingsRepository extends BaseRepository<WorkspaceSettings, WorkspaceSettingsInsert, WorkspaceSettingsUpdate> {
  constructor() {
    super('workspace_settings');
  }

  async getByWorkspace(workspaceId: string): Promise<WorkspaceSettings | null> {
    try {
      const { data, error } = await this.client
        .from('workspace_settings')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error) {
        logger.error('Failed to get workspace settings', { error, workspaceId });
        throw new Error(`Failed to get workspace settings: ${error.message}`);
      }

      return (data as WorkspaceSettings) ?? null;
    } catch (error) {
      logger.error('Error getting workspace settings', { error, workspaceId });
      throw error;
    }
  }

  async upsertSettings(settings: WorkspaceSettingsInsert): Promise<WorkspaceSettings> {
    try {
      const { data, error } = await this.client
        .from('workspace_settings')
        .upsert(settings, { onConflict: 'workspace_id' })
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to upsert workspace settings', { error, settings });
        throw new Error(`Failed to upsert workspace settings: ${error.message}`);
      }

      return data as WorkspaceSettings;
    } catch (error) {
      logger.error('Error upserting workspace settings', { error, settings });
      throw error;
    }
  }
}

export default new WorkspaceSettingsRepository();


