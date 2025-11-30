// database/repositories/AgentFlowsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type AgentFlow = Database['public']['Tables']['agent_flows']['Row'];
type AgentFlowInsert = Database['public']['Tables']['agent_flows']['Insert'];
type AgentFlowUpdate = Database['public']['Tables']['agent_flows']['Update'];

export class AgentFlowsRepository extends BaseRepository<AgentFlow, AgentFlowInsert, AgentFlowUpdate> {
  constructor() {
    super('agent_flows');
  }

  async getFlowsByAgent(agentId: string): Promise<AgentFlow[]> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get flows by agent', { error, agentId });
        throw new Error(`Failed to get flows by agent: ${error.message}`);
      }

      return data as AgentFlow[];
    } catch (error) {
      logger.error('Error getting flows by agent', { error, agentId });
      throw error;
    }
  }

  async getDefaultFlow(agentId: string): Promise<AgentFlow | null> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .select('*')
        .eq('agent_id', agentId)
        .eq('is_default', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No default flow found
        }
        logger.error('Failed to get default flow', { error, agentId });
        throw new Error(`Failed to get default flow: ${error.message}`);
      }

      return data as AgentFlow;
    } catch (error) {
      logger.error('Error getting default flow', { error, agentId });
      throw error;
    }
  }

  async getDefaultActiveFlow(agentId: string): Promise<AgentFlow | null> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .select('*')
        .eq('agent_id', agentId)
        .eq('status', 'active')
        .eq('is_default', true)
        .maybeSingle();

      if (error) {
        logger.error('Failed to get default active flow', { error, agentId });
        throw new Error(`Failed to get default active flow: ${error.message}`);
      }

      return data as AgentFlow | null;
    } catch (error) {
      logger.error('Error getting default active flow', { error, agentId });
      throw error;
    }
  }

  async getFlowById(flowId: string): Promise<AgentFlow | null> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .select('*')
        .eq('id', flowId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No flow found
        }
        logger.error('Failed to get flow by ID', { error, flowId });
        throw new Error(`Failed to get flow by ID: ${error.message}`);
      }

      return data as AgentFlow;
    } catch (error) {
      logger.error('Error getting flow by ID', { error, flowId });
      throw error;
    }
  }

  async getFlowsByTenant(tenantId: string): Promise<AgentFlow[]> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get flows by tenant', { error, tenantId });
        throw new Error(`Failed to get flows by tenant: ${error.message}`);
      }

      return data as AgentFlow[];
    } catch (error) {
      logger.error('Error getting flows by tenant', { error, tenantId });
      throw error;
    }
  }

  async updateFlowDefinition(flowId: string, workflow_data: any): Promise<AgentFlow> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .update({ 
          workflow_data: workflow_data,
          updated_at: new Date().toISOString()
        })
        .eq('id', flowId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update flow definition', { error, flowId });
        throw new Error(`Failed to update flow definition: ${error.message}`);
      }

      return data as AgentFlow;
    } catch (error) {
      logger.error('Error updating flow definition', { error, flowId });
      throw error;
    }
  }

  async updateFlowStatus(flowId: string, status: string): Promise<AgentFlow> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .update({ 
          status: status,
          updated_at: new Date().toISOString()
        })
        .eq('id', flowId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update flow status', { error, flowId, status });
        throw new Error(`Failed to update flow status: ${error.message}`);
      }

      return data as AgentFlow;
    } catch (error) {
      logger.error('Error updating flow status', { error, flowId, status });
      throw error;
    }
  }

  async setDefaultFlow(agentId: string, flowId: string): Promise<void> {
    try {
      // First, unset all default flows for this agent
      await this.client
        .from('agent_flows')
        .update({ is_default: false })
        .eq('agent_id', agentId);

      // Then set the specified flow as default
      const { error } = await this.client
        .from('agent_flows')
        .update({ 
          is_default: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', flowId)
        .eq('agent_id', agentId);

      if (error) {
        logger.error('Failed to set default flow', { error, agentId, flowId });
        throw new Error(`Failed to set default flow: ${error.message}`);
      }
    } catch (error) {
      logger.error('Error setting default flow', { error, agentId, flowId });
      throw error;
    }
  }

  async getActiveFlows(agentId: string): Promise<AgentFlow[]> {
    try {
      const { data, error } = await this.client
        .from('agent_flows')
        .select('*')
        .eq('agent_id', agentId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to get active flows', { error, agentId });
        throw new Error(`Failed to get active flows: ${error.message}`);
      }

      return data as AgentFlow[];
    } catch (error) {
      logger.error('Error getting active flows', { error, agentId });
      throw error;
    }
  }

  async countByAgent(agentId: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from('agent_flows')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId);

      if (error) {
        logger.error('Failed to count flows by agent', { error, agentId });
        throw new Error(`Failed to count flows by agent: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error counting flows by agent', { error, agentId });
      throw error;
    }
  }

  async deleteFlow(flowId: string): Promise<void> {
    try {
      const { error } = await this.client
        .from('agent_flows')
        .delete()
        .eq('id', flowId);

      if (error) {
        logger.error('Failed to delete flow', { error, flowId });
        throw new Error(`Failed to delete flow: ${error.message}`);
      }
    } catch (error) {
      logger.error('Error deleting flow', { error, flowId });
      throw error;
    }
  }

  async getFlowsByTrigger(agentId: string, triggerType: string): Promise<AgentFlow[]> {
    try {
      // Get all active flows for the agent
      const { data, error } = await this.client
        .from('agent_flows')
        .select('*')
        .eq('agent_id', agentId)
        .eq('status', 'active');

      if (error) {
        logger.error('Failed to get flows by agent', { error, agentId });
        throw new Error(`Failed to get flows by agent: ${error.message}`);
      }

      if (!data) {
        return [];
      }

      // Filter flows by trigger type (support both FlowDefinition and WorkflowGraph formats)
      const filteredFlows = data.filter((flow: AgentFlow) => {
        const workflowData = flow.workflow_data as any;
        
        if (!workflowData) {
          return false;
        }

        // Check for WorkflowGraph format (metadata.triggerType)
        if (workflowData.metadata?.triggerType === triggerType) {
          return true;
        }

        // Check for FlowDefinition format (trigger.type)
        if (workflowData.trigger?.type === triggerType) {
          return true;
        }

        return false;
      });

      return filteredFlows;
    } catch (error) {
      logger.error('Error getting flows by trigger', { error, agentId, triggerType });
      throw error;
    }
  }
}

export default new AgentFlowsRepository();
