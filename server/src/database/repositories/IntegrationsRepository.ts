// database/repositories/IntegrationsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type Integration = Database['public']['Tables']['integrations']['Row'];
type IntegrationInsert = Database['public']['Tables']['integrations']['Insert'];
type IntegrationUpdate = Database['public']['Tables']['integrations']['Update'];

export class IntegrationsRepository extends BaseRepository<Integration, IntegrationInsert, IntegrationUpdate> {
  constructor() {
    super('integrations');
  }

  async getAllIntegrations(): Promise<Integration[]> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get all integrations', { error });
        throw new Error(`Failed to get all integrations: ${error.message}`);
      }

      return data as Integration[];
    } catch (error) {
      logger.error('Error getting all integrations', { error });
      throw error;
    }
  }

  async getIntegrationsByChannel(channel: string): Promise<Integration[]> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .select('*')
        .eq('channel', channel);

      if (error) {
        logger.error('Failed to get integrations by channel', { error, channel });
        throw new Error(`Failed to get integrations by channel: ${error.message}`);
      }

      return data as Integration[];
    } catch (error) {
      logger.error('Error getting integrations by channel', { error, channel });
      throw error;
    }
  }

  async getIntegrationById(integrationId: string): Promise<Integration | null> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .select('*')
        .eq('id', integrationId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No rows found
        }
        logger.error('Failed to get integration by ID', { error, integrationId });
        throw new Error(`Failed to get integration by ID: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error getting integration by ID', { error, integrationId });
      throw error;
    }
  }

  async getIntegrationsByStatus(status: string): Promise<Integration[]> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .select('*')
        .eq('status', status);

      if (error) {
        logger.error('Failed to get integrations by status', { error, status });
        throw new Error(`Failed to get integrations by status: ${error.message}`);
      }

      return data as Integration[];
    } catch (error) {
      logger.error('Error getting integrations by status', { error, status });
      throw error;
    }
  }

  async updateStatus(integrationId: string, status: string): Promise<Integration> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .update({ 
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration status', { error, integrationId, status });
        throw new Error(`Failed to update integration status: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error updating integration status', { error, integrationId, status });
      throw error;
    }
  }

  async updateConfig(integrationId: string, config: any): Promise<Integration> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .update({ 
          config,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration config', { error, integrationId });
        throw new Error(`Failed to update integration config: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error updating integration config', { error, integrationId });
      throw error;
    }
  }

  async updateMetadata(integrationId: string, metadata: any): Promise<Integration> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .update({ 
          metadata,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration metadata', { error, integrationId });
        throw new Error(`Failed to update integration metadata: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error updating integration metadata', { error, integrationId });
      throw error;
    }
  }

  async updateVersion(
    integrationId: string, 
    version: string, 
    latestVersion: string, 
    updateAvailable: boolean
  ): Promise<Integration> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .update({ 
          version: version,
          latest_version: latestVersion,
          update_available: updateAvailable,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration version', { error, integrationId, version, latestVersion, updateAvailable });
        throw new Error(`Failed to update integration version: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error updating integration version', { error, integrationId });
      throw error;
    }
  }

  async getIntegrationsWithUpdatesAvailable(): Promise<Integration[]> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .select('*')
        .eq('update_available', true);

      if (error) {
        logger.error('Failed to get integrations with updates available', { error });
        throw new Error(`Failed to get integrations with updates available: ${error.message}`);
      }

      return data as Integration[];
    } catch (error) {
      logger.error('Error getting integrations with updates available', { error });
      throw error;
    }
  }

  async markUpdateAvailable(integrationId: string, latestVersion: string): Promise<Integration> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .update({ 
          latest_version: latestVersion,
          update_available: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to mark update as available', { error, integrationId, latestVersion });
        throw new Error(`Failed to mark update as available: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error marking update as available', { error, integrationId });
      throw error;
    }
  }

  async clearUpdateAvailable(integrationId: string): Promise<Integration> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .update({ 
          update_available: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to clear update available flag', { error, integrationId });
        throw new Error(`Failed to clear update available flag: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error clearing update available flag', { error, integrationId });
      throw error;
    }
  }

  async getActiveIntegrations(): Promise<Integration[]> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get active integrations', { error });
        throw new Error(`Failed to get active integrations: ${error.message}`);
      }

      return data as Integration[];
    } catch (error) {
      logger.error('Error getting active integrations', { error });
      throw error;
    }
  }

  async countAll(): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('integrations')
        .select('*', { count: 'exact', head: true });

      if (error) {
        logger.error('Failed to count all integrations', { error });
        throw new Error(`Failed to count all integrations: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error counting all integrations', { error });
      throw error;
    }
  }

  async countByChannel(channel: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('integrations')
        .select('*', { count: 'exact', head: true })
        .eq('channel', channel);

      if (error) {
        logger.error('Failed to count integrations by channel', { error, channel });
        throw new Error(`Failed to count integrations by channel: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error counting integrations by channel', { error, channel });
      throw error;
    }
  }

  async countByStatus(status: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('integrations')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

      if (error) {
        logger.error('Failed to count integrations by status', { error, status });
        throw new Error(`Failed to count integrations by status: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error counting integrations by status', { error, status });
      throw error;
    }
  }

  /**
   * Get integration by channel (helper for finding available integrations)
   * Used when an agent wants to install a specific channel integration
   */
  async getIntegrationByChannel(channel: string): Promise<Integration | null> {
    try {
      const { data, error } = await this.client
        .from('integrations')
        .select('*')
        .eq('channel', channel)
        .eq('status', 'active')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No rows found
        }
        logger.error('Failed to get integration by channel', { error, channel });
        throw new Error(`Failed to get integration by channel: ${error.message}`);
      }

      return data as Integration;
    } catch (error) {
      logger.error('Error getting integration by channel', { error, channel });
      throw error;
    }
  }

  /**
   * Get latest version information for an integration
   * Used when checking if updates are available
   */
  async getLatestVersionInfo(integrationId: string): Promise<{ latest_version: string; update_available: boolean } | null> {
    try {
      const integration = await this.getIntegrationById(integrationId);
      if (!integration) {
        return null;
      }

      return {
        latest_version: integration.latest_version || integration.version || '',
        update_available: integration.update_available || false
      };
    } catch (error) {
      logger.error('Error getting latest version info', { error, integrationId });
      return null;
    }
  }
}

export default new IntegrationsRepository();
