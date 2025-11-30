    // agent/services/AgentHomeService.ts
import { AgentsRepository } from '../../database/repositories/AgentsRepository';
import { AgentFlowsRepository } from '../../database/repositories/AgentFlowsRepository';
import { redisClient } from '../../redis';
import logger from '../../utils/logger';

export class AgentHomeService {
  private static instance: AgentHomeService;
  private agentsRepository: AgentsRepository;
  private agentFlowsRepository: AgentFlowsRepository;

  constructor() {
    this.agentsRepository = new AgentsRepository();
    this.agentFlowsRepository = new AgentFlowsRepository();
  }

  public static getInstance(): AgentHomeService {
    if (!AgentHomeService.instance) {
      AgentHomeService.instance = new AgentHomeService();
    }
    return AgentHomeService.instance;
  }

  /**
   * Update agent prompt in both database and Redis cache
   * This updates the system prompt in the main workflow and refreshes all caches
   */
  async updateAgentPrompt(
    tenantId: string,
    agentId: string,
    newPrompt: string
  ): Promise<{
    success: boolean;
    message?: string;
    updatedPrompt?: string;
  }> {
    try {
      // Verify agent exists and belongs to tenant
      const agent = await this.agentsRepository.findById(agentId);
      if (!agent || agent.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Agent not found or access denied'
        };
      }

      // Get the main workflow (default workflow)
      const agentFlows = await this.agentFlowsRepository.getFlowsByAgent(agentId);
      const mainWorkflow = agentFlows.find(flow => flow.is_default === true);
      
      if (!mainWorkflow) {
        return {
          success: false,
          message: 'No main workflow found for this agent'
        };
      }

      // Update the system prompt in the workflow data
      const updatedWorkflowData = { ...mainWorkflow.workflow_data };
      
      // Check if WorkflowGraph format (nodes/edges)
      if (updatedWorkflowData.nodes && updatedWorkflowData.edges) {
        // WorkflowGraph format - update AI agent node's systemPrompt
        const agentNode = updatedWorkflowData.nodes?.find((node: any) => node.type === 'ai_agent');
        if (agentNode?.agentConfig) {
          agentNode.agentConfig.systemPrompt = newPrompt;
        }
      }
      // Legacy FlowDefinition format
      else if (updatedWorkflowData.prompt) {
        updatedWorkflowData.prompt.system_prompt = newPrompt;
        
        // Also update in workflow.integrations if it exists
        if (updatedWorkflowData.workflow && updatedWorkflowData.workflow.integrations) {
          const agentIntegration = updatedWorkflowData.workflow.integrations.find(
            (integration: any) => integration.type === 'ai_agent'
          );
          if (agentIntegration && agentIntegration.data) {
            agentIntegration.data.systemPrompt = newPrompt;
          }
        }
      }

      // Update the workflow in database
      await this.agentFlowsRepository.update(mainWorkflow.id, {
        workflow_data: updatedWorkflowData,
        updated_at: new Date().toISOString()
      });

      // Clear all related caches
      await this.clearAgentCaches(agentId);

      logger.info('Agent prompt updated successfully', { 
        agentId, 
        tenantId, 
        promptLength: newPrompt.length 
      });

      return {
        success: true,
        updatedPrompt: newPrompt,
        message: 'Agent prompt updated successfully'
      };
    } catch (error) {
      logger.error('Failed to update agent prompt', { error, tenantId, agentId });
      return {
        success: false,
        message: 'Failed to update agent prompt'
      };
    }
  }

  /**
   * Update workflow prompt (system prompt in specific workflow)
   */
  async updateWorkflowPrompt(
    tenantId: string,
    agentId: string,
    workflowId: string,
    newPrompt: string
  ): Promise<{
    success: boolean;
    message?: string;
    updatedPrompt?: string;
  }> {
    try {
      // Verify agent exists and belongs to tenant
      const agent = await this.agentsRepository.findById(agentId);
      if (!agent || agent.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Agent not found or access denied'
        };
      }

      // Get the workflow by ID
      const workflow = await this.agentFlowsRepository.getFlowById(workflowId);
      
      if (!workflow) {
        return {
          success: false,
          message: 'Workflow not found'
        };
      }

      // Verify workflow belongs to agent
      if (workflow.agent_id !== agentId) {
        return {
          success: false,
          message: 'Workflow does not belong to this agent'
        };
      }

      // Update the system prompt in the workflow data
      const updatedWorkflowData = { ...workflow.workflow_data };
      
      // Check if WorkflowGraph format (nodes/edges)
      if (updatedWorkflowData.nodes && updatedWorkflowData.edges) {
        // WorkflowGraph format - update AI agent node's systemPrompt
        const agentNode = updatedWorkflowData.nodes?.find((node: any) => node.type === 'ai_agent');
        if (agentNode?.agentConfig) {
          agentNode.agentConfig.systemPrompt = newPrompt;
        }
      }
      // Legacy FlowDefinition format
      else if (updatedWorkflowData.prompt) {
        updatedWorkflowData.prompt.system_prompt = newPrompt;
        
        // Also update in workflow.integrations if it exists
        if (updatedWorkflowData.workflow && updatedWorkflowData.workflow.integrations) {
          const agentIntegration = updatedWorkflowData.workflow.integrations.find(
            (integration: any) => integration.type === 'ai_agent'
          );
          if (agentIntegration && agentIntegration.data) {
            agentIntegration.data.systemPrompt = newPrompt;
          }
        }
      }

      // Update the workflow in database
      await this.agentFlowsRepository.update(workflow.id, {
        workflow_data: updatedWorkflowData,
        updated_at: new Date().toISOString()
      });

      // Clear all related caches
      await this.clearAgentCaches(agentId);

      logger.info('Workflow prompt updated successfully', { 
        agentId, 
        tenantId, 
        workflowId,
        promptLength: newPrompt.length 
      });

      return {
        success: true,
        updatedPrompt: newPrompt,
        message: 'Workflow prompt updated successfully'
      };
    } catch (error) {
      logger.error('Failed to update workflow prompt', { error, tenantId, agentId, workflowId });
      return {
        success: false,
        message: 'Failed to update workflow prompt'
      };
    }
  }

  /**
   * Get agent prompt from main workflow
   */
  async getAgentPrompt(
    tenantId: string,
    agentId: string
  ): Promise<{
    success: boolean;
    prompt?: string;
    message?: string;
  }> {
    try {
      // Verify agent exists and belongs to tenant
      const agent = await this.agentsRepository.findById(agentId);
      if (!agent || agent.tenant_id !== tenantId) {
        return {
          success: false,
          message: 'Agent not found or access denied'
        };
      }

      // Get the main workflow
      const agentFlows = await this.agentFlowsRepository.getFlowsByAgent(agentId);
      const mainWorkflow = agentFlows.find(flow => flow.is_default === true);
      
      if (!mainWorkflow || !mainWorkflow.workflow_data) {
        return {
          success: true,
          message: 'No main workflow found'
        };
      }

      // Extract system prompt
      let prompt: string | null = null;
      const workflowData = mainWorkflow.workflow_data;

      // Check if WorkflowGraph format (nodes/edges)
      if (workflowData.nodes && workflowData.edges) {
        // WorkflowGraph format - extract from AI agent node
        const agentNode = workflowData.nodes?.find((node: any) => node.type === 'ai_agent');
        if (agentNode?.agentConfig?.systemPrompt) {
          prompt = agentNode.agentConfig.systemPrompt;
        }
      }
      // Legacy FlowDefinition format
      else if (workflowData.prompt && workflowData.prompt.system_prompt) {
        prompt = workflowData.prompt.system_prompt;
      }
      // Alternative: check workflow.integrations (legacy)
      else if (workflowData.workflow && workflowData.workflow.integrations) {
        const agentIntegration = workflowData.workflow.integrations.find(
          (integration: any) => integration.type === 'ai_agent'
        );
        if (agentIntegration && agentIntegration.data && agentIntegration.data.systemPrompt) {
          prompt = agentIntegration.data.systemPrompt;
        }
      }

      return {
        success: true,
        ...(prompt && { prompt })
      };
    } catch (error) {
      logger.error('Failed to get agent prompt', { error, tenantId, agentId });
      return {
        success: false,
        message: 'Failed to get agent prompt'
      };
    }
  }

  /**
   * Clear all agent-related caches
   */
  private async clearAgentCaches(agentId: string): Promise<void> {
    try {
      const cacheKeys = [
        `agent:studio:${agentId}`,
        `agent:studio:home:${agentId}`,
        `agent:workflows:${agentId}`,
        `agent:tables:${agentId}`,
        `agent:integrations:${agentId}`
      ];

      // Clear all cache keys
      await Promise.all(
        cacheKeys.map(key => redisClient.deleteKey(key))
      );

      logger.info('Agent caches cleared', { agentId, cacheKeys });
    } catch (error) {
      logger.warn('Failed to clear agent caches', { error, agentId });
      // Don't throw - cache clearing failure shouldn't break the operation
    }
  }

  /**
   * Refresh agent home data cache
   */
  async refreshAgentHomeCache(
    tenantId: string,
    agentId: string
  ): Promise<{
    success: boolean;
    message?: string;
  }> {
    try {
      // Clear existing cache
      await this.clearAgentCaches(agentId);

      // The cache will be rebuilt on next request
      logger.info('Agent home cache refresh initiated', { agentId, tenantId });

      return {
        success: true,
        message: 'Cache refresh initiated'
      };
    } catch (error) {
      logger.error('Failed to refresh agent home cache', { error, tenantId, agentId });
      return {
        success: false,
        message: 'Failed to refresh cache'
      };
    }
  }
}

export default AgentHomeService.getInstance();
