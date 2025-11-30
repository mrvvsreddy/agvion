// database/repositories/AgentIntegrationsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type AgentIntegration = Database['public']['Tables']['agent_integrations']['Row'];
type AgentIntegrationInsert = Database['public']['Tables']['agent_integrations']['Insert'];
type AgentIntegrationUpdate = Database['public']['Tables']['agent_integrations']['Update'];

export class AgentIntegrationsRepository extends BaseRepository<AgentIntegration, AgentIntegrationInsert, AgentIntegrationUpdate> {
  constructor() {
    super('agent_integrations');
  }

  async checkTenantIntegrationAccess(tenantId: string, agentId: string, integrationId: string): Promise<boolean> {
    try {
      // First check if the agent belongs to the tenant
      const { data: agentData, error: agentError } = await this.client
        .from('agents')
        .select('tenant_id')
        .eq('id', agentId)
        .eq('tenant_id', tenantId)
        .single();

      if (agentError || !agentData) {
        logger.error('Failed to verify agent ownership', { error: agentError, tenantId, agentId });
        return false;
      }

      // Then check if the integration belongs to the agent
      const { data: integrationData, error: integrationError } = await this.client
        .from('agent_integrations')
        .select('id')
        .eq('id', integrationId)
        .eq('agent_id', agentId)
        .single();

      if (integrationError || !integrationData) {
        logger.error('Failed to verify integration ownership', { error: integrationError, agentId, integrationId });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking tenant integration access', { error, tenantId, agentId, integrationId });
      return false;
    }
  }

  async getIntegrationsByAgent(agentId: string): Promise<AgentIntegration[]> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('agent_id', agentId);

      if (error) {
        logger.error('Failed to get integrations by agent', { error, agentId });
        throw new Error(`Failed to get integrations by agent: ${error.message}`);
      }

      return data as AgentIntegration[];
    } catch (error) {
      logger.error('Error getting integrations by agent', { error, agentId });
      throw error;
    }
  }

  async getIntegrationsByChannel(agentId: string, channel: string): Promise<AgentIntegration[]> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('agent_id', agentId)
        .eq('channel', channel);

      if (error) {
        logger.error('Failed to get integrations by channel', { error, agentId, channel });
        throw new Error(`Failed to get integrations by channel: ${error.message}`);
      }

      return data as AgentIntegration[];
    } catch (error) {
      logger.error('Error getting integrations by channel', { error, agentId, channel });
      throw error;
    }
  }

  async getIntegrationByChannel(agentId: string, channel: string): Promise<AgentIntegration | null> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('agent_id', agentId)
        .eq('channel', channel)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No rows found
        }
        logger.error('Failed to get integration by channel', { error, agentId, channel });
        throw new Error(`Failed to get integration by channel: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error getting integration by channel', { error, agentId, channel });
      throw error;
    }
  }

  async getIntegrationByUrl(webhookUrl: string): Promise<AgentIntegration | null> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('webhook_url', webhookUrl)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No rows found
        }
        logger.error('Failed to get integration by URL', { error, webhookUrl });
        throw new Error(`Failed to get integration by URL: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error getting integration by URL', { error, webhookUrl });
      throw error;
    }
  }

  async updateEnabledStatus(integrationId: string, isEnabled: boolean): Promise<AgentIntegration> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .update({ 
          is_enabled: isEnabled,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration enabled status', { error, integrationId, isEnabled });
        throw new Error(`Failed to update integration enabled status: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error updating integration enabled status', { error, integrationId, isEnabled });
      throw error;
    }
  }

  async updateConfig(integrationId: string, config: any): Promise<AgentIntegration> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .update({ 
          config: config,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration config', { error, integrationId });
        throw new Error(`Failed to update integration config: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error updating integration config', { error, integrationId });
      throw error;
    }
  }

  async getEnabledIntegrations(agentId: string): Promise<AgentIntegration[]> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('agent_id', agentId)
        .eq('is_enabled', true);

      if (error) {
        logger.error('Failed to get enabled integrations', { error, agentId });
        throw new Error(`Failed to get enabled integrations: ${error.message}`);
      }

      return data as AgentIntegration[];
    } catch (error) {
      logger.error('Error getting enabled integrations', { error, agentId });
      throw error;
    }
  }

  async countByAgent(agentId: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('agent_integrations')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId);

      if (error) {
        logger.error('Failed to count integrations by agent', { error, agentId });
        throw new Error(`Failed to count integrations by agent: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error counting integrations by agent', { error, agentId });
      throw error;
    }
  }

  async countByChannel(agentId: string, channel: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('agent_integrations')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .eq('channel', channel);

      if (error) {
        logger.error('Failed to count integrations by channel', { error, agentId, channel });
        throw new Error(`Failed to count integrations by channel: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error counting integrations by channel', { error, agentId, channel });
      throw error;
    }
  }

  async getIntegrationById(integrationId: string): Promise<AgentIntegration | null> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
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

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error getting integration by ID', { error, integrationId });
      throw error;
    }
  }

  async getIntegrationsByWorkflow(workflowId: string): Promise<AgentIntegration[]> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('workflow_id', workflowId);

      if (error) {
        logger.error('Failed to get integrations by workflow', { error, workflowId });
        throw new Error(`Failed to get integrations by workflow: ${error.message}`);
      }

      return data as AgentIntegration[];
    } catch (error) {
      logger.error('Error getting integrations by workflow', { error, workflowId });
      throw error;
    }
  }

  async getIntegrationByWorkflowAndChannel(workflowId: string, channel: string): Promise<AgentIntegration | null> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('workflow_id', workflowId)
        .eq('channel', channel)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No rows found
        }
        logger.error('Failed to get integration by workflow and channel', { error, workflowId, channel });
        throw new Error(`Failed to get integration by workflow and channel: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error getting integration by workflow and channel', { error, workflowId, channel });
      throw error;
    }
  }

  async getIntegrationsByIntegrationId(integrationId: string): Promise<AgentIntegration[]> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('integration_id', integrationId);

      if (error) {
        logger.error('Failed to get integrations by integration_id', { error, integrationId });
        throw new Error(`Failed to get integrations by integration_id: ${error.message}`);
      }

      return data as AgentIntegration[];
    } catch (error) {
      logger.error('Error getting integrations by integration_id', { error, integrationId });
      throw error;
    }
  }

  async updateIntegrationVersion(
    integrationId: string, 
    installedVersion: string, 
    latestVersion: string, 
    updateAvailable: boolean
  ): Promise<AgentIntegration> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .update({ 
          installed_version: installedVersion,
          latest_version: latestVersion,
          update_available: updateAvailable,
          updated_at: new Date().toISOString()
        })
        .eq('id', integrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration version', { error, integrationId, installedVersion, latestVersion, updateAvailable });
        throw new Error(`Failed to update integration version: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error updating integration version', { error, integrationId });
      throw error;
    }
  }

  async getIntegrationsWithUpdatesAvailable(agentId: string): Promise<AgentIntegration[]> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
        .select('*')
        .eq('agent_id', agentId)
        .eq('update_available', true);

      if (error) {
        logger.error('Failed to get integrations with updates available', { error, agentId });
        throw new Error(`Failed to get integrations with updates available: ${error.message}`);
      }

      return data as AgentIntegration[];
    } catch (error) {
      logger.error('Error getting integrations with updates available', { error, agentId });
      throw error;
    }
  }

  async markUpdateAvailable(integrationId: string, latestVersion: string): Promise<AgentIntegration> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
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

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error marking update as available', { error, integrationId });
      throw error;
    }
  }

  async clearUpdateAvailable(integrationId: string): Promise<AgentIntegration> {
    try {
      const { data, error } = await this.client
        .from('agent_integrations')
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

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error clearing update available flag', { error, integrationId });
      throw error;
    }
  }

  /**
   * Install an integration for an agent (link to base integration in catalog)
   * This creates an agent_integrations entry that references an integration from the catalog
   */
  async installIntegrationForAgent(
    agentId: string,
    workflowId: string,
    channel: string,
    integrationId: string | null,
    config: any,
    webhookUrl: string,
    agentIntegrationId?: string
  ): Promise<AgentIntegration> {
    try {
      // Resolve base integration using integrationId (preferred) or channel (fallback)
      let baseIntegration: { id: string; version: string | null; latest_version: string | null; metadata: any | null } | null = null;
      if (integrationId) {
        const { data, error } = await this.client
          .from('integrations')
          .select('id, version, latest_version, metadata')
          .eq('id', integrationId)
          .single();
        if (error) {
          logger.warn('Failed to fetch base integration by id, will try by channel', { error, integrationId });
        } else {
          baseIntegration = data as any;
        }
      }

      if (!baseIntegration) {
        const { data, error } = await this.client
          .from('integrations')
          .select('id, version, latest_version, metadata')
          .eq('channel', channel)
          .in('status', ['active', 'published'])
          .single();
        if (error || !data) {
          logger.error('Failed to resolve base integration by channel', { error, channel });
          throw new Error(`Base integration not found for channel: ${channel}`);
        }
        baseIntegration = data as any;
        if (!baseIntegration) {
          throw new Error(`Base integration not found for channel: ${channel}`);
        }
        integrationId = baseIntegration.id; // ensure we persist the catalog reference
      }

      // Create the agent integration with version info from catalog
      const { data, error } = await this.client
        .from('agent_integrations')
        .insert({
          id: agentIntegrationId,
          agent_id: agentId,
          workflow_id: workflowId,
          channel: channel,
          config: config,
          webhook_url: webhookUrl,
          is_enabled: true,
          integration_id: integrationId,
          installed_version: baseIntegration?.version || baseIntegration?.latest_version || null,
          latest_version: baseIntegration?.latest_version || baseIntegration?.version || null,
          update_available: false,
          metadata: baseIntegration?.metadata || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        logger.error('Failed to install integration for agent', { error, agentId, integrationId });
        throw new Error(`Failed to install integration for agent: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error installing integration for agent', { error, agentId, integrationId });
      throw error;
    }
  }

  /**
   * Update agent integration to latest version from catalog
   * This syncs the version from the integrations table
   */
  async updateToLatestVersion(agentIntegrationId: string, baseIntegrationId: string): Promise<AgentIntegration> {
    try {
      // Get latest version from base integration catalog
      const { data: baseIntegration, error: fetchError } = await this.client
        .from('integrations')
        .select('version, latest_version, metadata')
        .eq('id', baseIntegrationId)
        .single();

      if (fetchError || !baseIntegration) {
        logger.error('Failed to fetch base integration for update', { error: fetchError, baseIntegrationId });
        throw new Error(`Base integration not found: ${baseIntegrationId}`);
      }

      const latestVersion = baseIntegration.latest_version || baseIntegration.version;

      // Update the agent integration with latest version
      const { data, error } = await this.client
        .from('agent_integrations')
        .update({
          installed_version: latestVersion,
          latest_version: latestVersion,
          update_available: false,
          metadata: baseIntegration.metadata || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', agentIntegrationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update integration to latest version', { error, agentIntegrationId, baseIntegrationId });
        throw new Error(`Failed to update integration to latest version: ${error.message}`);
      }

      return data as AgentIntegration;
    } catch (error) {
      logger.error('Error updating integration to latest version', { error, agentIntegrationId });
      throw error;
    }
  }

  /**
   * Check and update available status for all agent integrations
   * This compares installed_version with latest_version from the catalog
   */
  async checkForUpdates(agentId: string): Promise<{ updated: number; available: AgentIntegration[] }> {
    try {
      const agentIntegrations = await this.getIntegrationsByAgent(agentId);
      let updatedCount = 0;
      const updateAvailableIntegrations: AgentIntegration[] = [];

      for (const agentIntegration of agentIntegrations) {
        if (!agentIntegration.integration_id) continue;

        // Get latest version from catalog
        const { data: baseIntegration, error: fetchError } = await this.client
          .from('integrations')
          .select('latest_version, metadata')
          .eq('id', agentIntegration.integration_id)
          .single();

        if (fetchError || !baseIntegration) continue;

        const latestVersion = baseIntegration.latest_version;
        const installedVersion = agentIntegration.installed_version;

        // Check if update is available
        const needsUpdate = latestVersion && 
                           installedVersion && 
                           latestVersion !== installedVersion &&
                           !agentIntegration.update_available;

        if (needsUpdate) {
          // Mark as update available
          await this.client
            .from('agent_integrations')
            .update({
              latest_version: latestVersion,
              update_available: true,
              metadata: baseIntegration.metadata || null,
              updated_at: new Date().toISOString()
            })
            .eq('id', agentIntegration.id);

          updatedCount++;
          
          // Add to available list with updated info
          updateAvailableIntegrations.push({
            ...agentIntegration,
            latest_version: latestVersion,
            update_available: true
          });
        }
      }

      logger.info('Checked for updates', { agentId, updated: updatedCount });
      
      return {
        updated: updatedCount,
        available: updateAvailableIntegrations
      };
    } catch (error) {
      logger.error('Error checking for updates', { error, agentId });
      return { updated: 0, available: [] };
    }
  }
}

export default new AgentIntegrationsRepository();
