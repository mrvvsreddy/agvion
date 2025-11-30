// path: agent/services/AgentFlowService.ts

import { v4 as uuidv4 } from 'uuid';
import { AgentFlowsRepository } from '../../database/repositories/AgentFlowsRepository';
import { AgentIntegrationsRepository } from '../../database/repositories/AgentIntegrationsRepository';
import logger from '../../utils/logger';
import { AgentsRepository } from '../../database/repositories/AgentsRepository';
import { executeWorkflowByDefinition } from './workflow-executor';
import { executeWorkflowFromChannel } from '../../core/agentrunner/execution/executer';
import { ChannelExecutionRequest } from '../../core/agentrunner/execution/channel-adapter';
import { WorkflowGraph, GraphNode, GraphEdge, TriggerDataInjection } from '../../core/agentrunner/execution/types';
import channelAdapterService from './channel-adapter';
import {
  FlowDefinition,
  WorkflowNode,
  WorkflowEdge,
  CreateFlowRequest,
  CreateFlowResponse,
  GetFlowsResponse,
  ProcessWebhookResponse,
  ChannelMessage,
  ChannelResponse,
  AgentNodeConfig
} from './types';

/**
 * Agent Flow Service - Rewritten to follow executer.ts pattern
 * 
 * This service has been completely rewritten to:
 * 1. Follow the simple sequential execution pattern from executer.ts
 * 2. Remove all direct LLM SDK calls (now uses OpenRouter integration)
 * 3. Use channel adapters for input/output communication
 * 4. Maintain clean separation of concerns
 * 
 * Architecture:
 * Input Channel → AgentFlowService → Workflow Executor → LLM Adapter → Output Channel
 */
export class AgentFlowService {
  private static instance: AgentFlowService;
  private flowsRepository: AgentFlowsRepository;
  private integrationsRepository: AgentIntegrationsRepository;
  private channelAdapter: typeof channelAdapterService;

  constructor() {
    this.flowsRepository = new AgentFlowsRepository();
    this.integrationsRepository = new AgentIntegrationsRepository();
    this.channelAdapter = channelAdapterService;
  }

  public static getInstance(): AgentFlowService {
    if (!AgentFlowService.instance) {
      AgentFlowService.instance = new AgentFlowService();
    }
    return AgentFlowService.instance;
  }

  /**
   * Create a new agent flow
   */
  async createFlow(request: CreateFlowRequest, internal = false): Promise<CreateFlowResponse> {
    try {
      const { agentId, tenantId, name, description, workflow_data, isDefault = false } = request;

      // Check for reserved workflow names — allow only internal calls to bypass this
      if (!internal) {
        const reservedNames = ['main', 'error', 'fail', 'system', 'user'];
        const normalizedName = name?.toLowerCase().trim();
        if (normalizedName && reservedNames.includes(normalizedName)) {
          return {
            success: false,
            message: `Workflow name "${name}" is reserved and cannot be used. Reserved names: main, error, fail, system, user (case-insensitive)`
          };
        }
      }

      // Validate definition structure
      if (!this.validateFlowDefinition(workflow_data as any)) {
        return {
          success: false,
          message: 'Invalid flow definition structure'
        };
      }

      // If this is the default flow, unset any existing default flows
      if (isDefault) {
        await this.flowsRepository.setDefaultFlow(agentId, '');
      }

      const now = new Date().toISOString();
      const flowId = uuidv4();

      const newFlow = await this.flowsRepository.create({
        id: flowId,
        agent_id: agentId,
        tenant_id: tenantId,
        name,
        description: description || null,
        is_default: isDefault,
        workflow_data: workflow_data,
        version: 1,
        status: 'active',
        created_at: now,
        updated_at: now
      });

      // Create integration for flow
      let triggerType = 'webchat';
      let channel = 'webchat';
      
      if ('trigger' in workflow_data) {
        triggerType = (workflow_data as FlowDefinition).trigger.type;
        channel = (workflow_data as FlowDefinition).trigger.channel;
      } else if ('metadata' in workflow_data) {
        const metadata = (workflow_data as any).metadata;
        triggerType = (metadata?.triggerType as string) || 'webchat';
        channel = (metadata?.channel as string) || 'webchat';
      }
      
      const integrationMeta = await this.createIntegrationForFlow(agentId, triggerType, channel, workflow_data as any, flowId);
      
      // Note: No credentials are stored in the workflow definition
      // API keys are handled via environment variables in the executor

      logger.info('Agent flow created successfully', { 
        flowId, 
        agentId, 
        tenantId, 
        flowName: name,
        triggerType: triggerType
      });

      return {
        success: true,
        flow: newFlow
      };
    } catch (error) {
      logger.error('Failed to create agent flow', { error, request });
      return {
        success: false,
        message: 'Failed to create agent flow'
      };
    }
  }

  /**
   * Create default webchat flow for new agent - RAG Assistant with proper schema
   * Uses the new workflow executor pattern with WorkflowGraph format
   */
  async createDefaultWebchatFlow(agentId: string, tenantId: string): Promise<CreateFlowResponse> {
    const defaultWorkflowGraph: WorkflowGraph = {
      id: 'webchat-rag-workflow-v2',
      name: 'main',
      agentId,
      nodes: [
        {
          triggerName: 'webchat_trigger',
          id: 'webchat001',
          name: 'Webchat Trigger',
          type: 'trigger',
          position: { x: 100, y: 100 },
          disabled: false,
          config: {
            triggerType: 'webchat',
            channel: 'webchat',
            event: 'message.received',
            filters: {
              messageType: ['text'],
              excludeBots: true
            }
          },
          metadata: {}
        },
        {
          triggerName: 'ai_agent',
          id: 'agent001',
          name: 'AI Agent',
          type: 'ai_agent',
          nodeType: 'agent',
          integration: 'openrouter',
          function: 'generateWithTools',
          position: { x: 300, y: 100 },
          disabled: false,
          config: {},
          agentConfig: {
            systemPrompt: "You're Amus, an AI assistant. Keep answers under 200 chars.",
            userPrompt: "{{$json.webchat001.message}}",
            llm: {
              model: 'deepseek/deepseek-chat-v3.1:free',
              provider: 'openrouter',
              integration: 'openrouter',
              temperature: 0.6,
              maxTokens: 1500,
              credentials: {}
            },
            // Enable tools so the agent can decide when and how to use knowledge retrieval
            tools: ({ 
              enabled: true,
              definitions: [
                {
                  name: 'knowledge_retrieve',
                  description: 'Retrieve relevant documents from the agent knowledge database to ground your answer. Use when additional facts are needed.',
                  integration: 'agent_knowledge',
                  function: 'retrieve',
                  parameters: {
                    query: { type: 'string', description: 'Query to search the knowledge base' },
                    topK: { type: 'number', description: 'Number of results to return' },
                    tableId: { type: 'string', description: 'Optional table ID to target' },
                    tableName: { type: 'string', description: 'Optional table name to target' }
                  }
                }
              ]
            } as any)
          },
          metadata: {}
        },
        {
          triggerName: 'webchat_reply',
          id: 'webchat002',
          name: 'Webchat Reply',
          type: 'action',
          integration: 'webchat',
          function: 'execute',
          position: { x: 500, y: 100 },
          disabled: false,
          config: {
            sourceNode: 'agent001',
            responseType: 'text',
            includeMetadata: true
          },
          metadata: {}
        }
      ],
      edges: [
        { id: 'edge001', source: 'webchat001', target: 'agent001' },
        { id: 'edge002', source: 'agent001', target: 'webchat002' }
      ],
      metadata: {
        triggerType: 'webchat',
        channel: 'webchat'
      } as any
    };

    return this.createFlow({
      agentId,
      tenantId,
      name: 'main',
      description: 'Main workflow - AI assistant using OpenRouter free models',
      workflow_data: defaultWorkflowGraph as any,
      isDefault: true
    }, true); // internal = true → allow server-only creation
  }

  /**
   * Get all flows for an agent
   */
  async getFlowsByAgent(agentId: string): Promise<GetFlowsResponse> {
    try {
      const flows = await this.flowsRepository.getFlowsByAgent(agentId);
      
      return {
        success: true,
        flows
      };
    } catch (error) {
      logger.error('Failed to get flows by agent', { error, agentId });
      return {
        success: false,
        message: 'Failed to get flows'
      };
    }
  }

  /**
   * Get default flow for an agent
   */
  async getDefaultFlow(agentId: string): Promise<CreateFlowResponse> {
    try {
      const flow = await this.flowsRepository.getDefaultFlow(agentId);
      
      if (!flow) {
        return {
          success: false,
          message: 'No default flow found'
        };
      }

      return {
        success: true,
        flow
      };
    } catch (error) {
      logger.error('Failed to get default flow', { error, agentId });
      return {
        success: false,
        message: 'Failed to get default flow'
      };
    }
  }

  /**
   * Update flow definition
   */
  async updateFlowDefinition(flowId: string, definition: FlowDefinition): Promise<CreateFlowResponse> {
    try {
      if (!this.validateFlowDefinition(definition)) {
        return {
          success: false,
          message: 'Invalid flow definition structure'
        };
      }

      const flow = await this.flowsRepository.updateFlowDefinition(flowId, definition);
      
      return {
        success: true,
        flow
      };
    } catch (error) {
      logger.error('Failed to update flow definition', { error, flowId });
      return {
        success: false,
        message: 'Failed to update flow definition'
      };
    }
  }

  /**
   * Get flows by trigger type
   */
  async getFlowsByTrigger(agentId: string, triggerType: string): Promise<GetFlowsResponse> {
    try {
      const flows = await this.flowsRepository.getFlowsByTrigger(agentId, triggerType);
      
      return {
        success: true,
        flows
      };
    } catch (error) {
      logger.error('Failed to get flows by trigger', { error, agentId, triggerType });
      return {
        success: false,
        message: 'Failed to get flows by trigger'
      };
    }
  }

  /**
   * Delete a flow
   */
  async deleteFlow(flowId: string): Promise<{ success: boolean; message?: string }> {
    try {
      await this.flowsRepository.deleteFlow(flowId);
      
      logger.info('Flow deleted successfully', { flowId });
      
      return {
        success: true,
        message: 'Flow deleted successfully'
      };
    } catch (error) {
      logger.error('Failed to delete flow', { error, flowId });
      return {
        success: false,
        message: 'Failed to delete flow'
      };
    }
  }

  /**
   * Process incoming webhook message - MAIN ENTRY POINT
   * This is the core method that orchestrates workflow execution
   */
  async processWebhookMessage(
    agentId: string, 
    channel: string, 
    message: unknown
  ): Promise<ProcessWebhookResponse> {
    try {
      logger.info('🚀 [AGENT-FLOW-SERVICE] Processing webhook message', {
        agentId,
        channel,
        messageType: typeof message,
        messageKeys: message && typeof message === 'object' ? Object.keys(message) : []
      });

      // Get flows for this trigger type
      const flowsResult = await this.getFlowsByTrigger(agentId, channel);
      
      if (!flowsResult.success || !flowsResult.flows || flowsResult.flows.length === 0) {
        return {
          success: false,
          message: 'No active flows found for this trigger'
        };
      }

      // Use the first active flow (or default flow)
      const flow = flowsResult.flows[0];
      if (!flow) {
        return {
          success: false,
          message: 'No flow available'
        };
      }

      const workflowData = flow.workflow_data as FlowDefinition | WorkflowGraph;

      // Sanitize input (only for FlowDefinition format)
      let sanitizedMessage = message;
      if ('sanitization' in workflowData) {
        sanitizedMessage = this.sanitizeInput(message, (workflowData as FlowDefinition).sanitization);
      }

      // Convert to channel message format
      const channelMessage = this.convertToChannelMessage(sanitizedMessage, channel);

      // ✅ FIX: Create ChannelExecutionRequest with trigger data
      const request: ChannelExecutionRequest = {
        workflowId: flow.id,
        workflowDefinition: this.convertToWorkflowGraphForChannel(workflowData, agentId, flow.tenant_id),
        input: {
          message: channelMessage.payload.text || '',
          text: channelMessage.payload.text || '',
          userId: channelMessage.userId,
          sessionId: channelMessage.sessionId,
          messageType: channelMessage.type,
          timestamp: channelMessage.timestamp
        },
        channelId: `webhook_${flow.id}`,
        channelType: channel as 'webchat' | 'slack' | 'http' | 'whatsapp',
        agentId: agentId,
        tenantId: flow.tenant_id,
        originalMessage: {
          type: channelMessage.type,
          payload: channelMessage.payload,
          userId: channelMessage.userId,
          sessionId: channelMessage.sessionId || 'unknown',
          timestamp: channelMessage.timestamp || new Date().toISOString(),
          msgId: channelMessage.msgId || 'unknown'
        },
        // ✅ ADD: Pass trigger data injections from webhook
        triggerDataInjections: (message as any)?.triggerDataInjections || [{
          nodeId: 'channel_input',
          nodeName: 'channel_input',
          triggerType: channel,
          data: {
            message: channelMessage.payload.text || '',
            text: channelMessage.payload.text || '',
            userId: channelMessage.userId,
            sessionId: channelMessage.sessionId,
            messageType: channelMessage.type
          }
        }]
      };
      
      // ✅ Inject AI agent tool definitions directly into the workflow before execution
      try {
        const aiAgentNode = (request.workflowDefinition as any)?.nodes?.find((n: any) => n.type === 'ai_agent');
        const toolsCfg = aiAgentNode?.agentConfig?.tools;
        const defs = toolsCfg?.definitions;
        if (aiAgentNode && toolsCfg?.enabled && Array.isArray(defs) && defs.length > 0) {
          logger.info('🧰 Injecting agent tools into execution context', {
            agentId,
            toolCount: defs.length,
            toolNames: defs.map((t: any) => t?.name).filter(Boolean)
          });
          aiAgentNode.agentConfig.tools = {
            enabled: true,
            definitions: defs
          };
        } else {
          logger.warn('⚠️ No tools found in agentConfig or tools disabled', {
            agentId,
            hasAgentNode: !!aiAgentNode,
            hasToolsArray: !!defs
          });
        }
      } catch (err) {
        logger.error('❌ Failed to inject tools into workflowDefinition', { err });
      }
      
      logger.info('🚀 [AGENT-FLOW-SERVICE] Calling executeWorkflowFromChannel', {
        agentId,
        workflowId: flow.id,
        hasTriggerDataInjections: !!request.triggerDataInjections,
        triggerDataCount: request.triggerDataInjections?.length || 0,
        channelInputMessage: request.input.message
      });
      
      // Call executor
      const result = await executeWorkflowFromChannel(request);
      
      return {
        success: result.success,
        response: {
          response: result.finalOutput,
          finalOutput: result.finalOutput,
          executionContext: result.executionContext || {},
          model: result.model || 'unknown',
          timestamp: result.timestamp
        },
        message: result.error || 'Success'
      };
    } catch (error) {
      logger.error('Failed to process webhook message', { error, agentId, channel });
      return {
        success: false,
        message: 'Failed to process message'
      };
    }
  }

  /**
   * Execute workflow using the new workflow executor
   * This is the core execution method that follows executer.ts pattern
   */
  private async executeWorkflow(
    workflowData: FlowDefinition | WorkflowGraph,
    channelMessage: ChannelMessage,
    agentId: string,
    tenantId: string
  ): Promise<{
    response: string;
    model: string;
    timestamp: string;
    executionContext: Record<string, unknown>;
    error?: string;
  }> {
    try {
      // Determine if we have FlowDefinition or WorkflowGraph
      const isWorkflowGraph = 'nodes' in workflowData && 'edges' in workflowData;
      
      let workflowGraph: WorkflowGraph;
      let triggerType: string;
      
      if (isWorkflowGraph) {
        // Already in WorkflowGraph format
        workflowGraph = workflowData as WorkflowGraph;
        triggerType = (workflowGraph.metadata as any)?.triggerType || 'webchat';
      } else {
        // Convert FlowDefinition to WorkflowGraph
        const definition = workflowData as FlowDefinition;
        triggerType = definition.trigger.type;
        workflowGraph = this.convertToWorkflowGraph(definition, agentId, tenantId);
      }

      logger.info('Executing workflow', {
        agentId,
        tenantId,
        triggerType,
        nodeCount: workflowGraph.nodes.length,
        edgeCount: workflowGraph.edges.length
      });

      // Prepare trigger data injection
      // Try to use the actual trigger node ID from the workflow, fallback to channel_input
      const triggerNode = workflowGraph.nodes.find(n => n.type === 'trigger');
      const triggerNodeId = triggerNode?.id || 'channel_input';
      const triggerNodeName = triggerNode?.name || 'channel_input';
      
      const triggerDataInjection = {
        nodeId: triggerNodeId,
        nodeName: triggerNodeName,
        triggerType: triggerType,
        data: {
          text: channelMessage.payload.text || '',
          message: channelMessage.payload.text || '',
          userId: channelMessage.userId,
          sessionId: channelMessage.sessionId || `session_${Date.now()}`,
          timestamp: channelMessage.timestamp || new Date().toISOString(),
          messageType: channelMessage.type,
          msgId: channelMessage.msgId || `msg_${Date.now()}`
        }
      };

      // Execute workflow using the workflow executor
      const executionContext = await executeWorkflowByDefinition(workflowGraph as any, {
        agentId,
        tenantId,
        triggerDataInjections: [triggerDataInjection]
      });

      // Extract response from execution context
      const response = this.extractResponseFromWorkflowGraph(executionContext, workflowGraph as any);

      logger.info('Workflow execution completed', {
        agentId,
        tenantId,
        responseLength: response.response.length,
        model: response.model
      });

      return response;

    } catch (error) {
      logger.error('Workflow execution failed', { error, agentId, tenantId });
      return {
        response: 'I apologize, but I encountered an error processing your request.',
        model: 'deepseek/deepseek-chat-v3.1:free',
        timestamp: new Date().toISOString(),
        executionContext: {},
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Convert FlowDefinition or WorkflowGraph to WorkflowGraph for channel execution
   */
  private convertToWorkflowGraphForChannel(
    workflowData: FlowDefinition | any,
    agentId: string,
    tenantId: string
  ): WorkflowGraph {
    // Determine if we have FlowDefinition or WorkflowGraph
    const isWorkflowGraph = 'nodes' in workflowData && 'edges' in workflowData;
    
    if (isWorkflowGraph) {
      // Already in WorkflowGraph format
      return workflowData as WorkflowGraph;
    } else {
      // Convert FlowDefinition to WorkflowGraph
      const definition = workflowData as FlowDefinition;
      return this.convertToWorkflowGraph(definition, agentId, tenantId);
    }
  }

  /**
   * Convert FlowDefinition to WorkflowGraph for the executor
   */
  private convertToWorkflowGraph(
    definition: FlowDefinition,
    agentId: string,
    tenantId: string
  ): WorkflowGraph {
    const nodes: GraphNode[] = definition.workflow.integrations.map(integration => {
      const baseNode: GraphNode = {
        triggerName: integration.name,
        id: integration.id,
        name: integration.name,
        type: integration.type as 'trigger' | 'ai_agent' | 'action' | 'tool',
        integration: integration.integration,
        function: integration.function,
        position: integration.position,
        disabled: false,
        config: integration.data,
        metadata: {}
      };

      // Convert AI agent integrations to agentConfig structure
      if (integration.type === 'ai_agent') {
        const agentConfig: AgentNodeConfig = {
          llm: {
            model: integration.data.model || definition.prompt.model,
            provider: integration.integration || 'openrouter',
            integration: integration.integration || 'openrouter',
            temperature: integration.data.temperature ?? definition.prompt.temperature ?? 0.7,
            maxTokens: integration.data.maxTokens ?? definition.prompt.max_tokens ?? 500,
            credentials: definition.credentials?.api_keys?.[integration.integration || 'openrouter']
              ? { apiKey: definition.credentials.api_keys[integration.integration || 'openrouter'] }
              : {}
          },
          systemPrompt: integration.data.systemPrompt || definition.prompt.system_prompt || '',
          userPrompt: integration.data.userPrompt || definition.prompt.user_prompt_template || '',
          tools: { enabled: false }
        };

        return {
          ...baseNode,
          agentConfig
        };
      }

      return baseNode;
    });

    const edges: GraphEdge[] = definition.workflow.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target
    }));

    return {
      id: definition.workflow.id || 'workflow',
      name: definition.workflow.name || 'Workflow',
      agentId,
      nodes,
      edges,
      metadata: {
        triggerType: definition.trigger.type,
        channel: definition.trigger.channel
      } as any
    };
  }

  /**
   * Extract response from execution context for WorkflowGraph format
   */
  private extractResponseFromWorkflowGraph(
    context: any,
    workflowGraph: WorkflowGraph
  ): {
    response: string;
    model: string;
    timestamp: string;
    executionContext: Record<string, unknown>;
    error?: string;
  } {
    // Find the AI agent node result
    const agentNode = workflowGraph.nodes.find(node => node.type === 'ai_agent');
    let response = 'I apologize, but I cannot process your request at this time.';
    let model = 'deepseek/deepseek-chat-v3.1:free';
    let executionContext: Record<string, unknown> = {};

    if (agentNode) {
      const nodeData = context.nodeData?.[agentNode.id] || context.nodeData?.[agentNode.name];
      if (nodeData) {
        // ✅ Check nested result structure first (where executor stores responses)
        const result = nodeData.result;
        if (result && result.json) {
          response = result.json.output || result.json.agentOutput || result.json.response || response;
          model = result.json.model || agentNode.agentConfig?.llm?.model || model;
        }
        // ✅ Fallback to direct fields
        else {
          response = nodeData.output || nodeData.agentOutput || nodeData.response || response;
          model = nodeData.model || agentNode.agentConfig?.llm?.model || model;
        }
        
        executionContext = {
          [agentNode.id]: nodeData,
          [agentNode.name]: nodeData
        };
      }
    }

    return {
      response,
      model,
      timestamp: new Date().toISOString(),
      executionContext
    };
  }

  /**
   * Extract response from execution context for FlowDefinition format (legacy)
   */
  private extractResponseFromContext(
    context: any,
    definition: FlowDefinition
  ): {
    response: string;
    model: string;
    timestamp: string;
    executionContext: Record<string, unknown>;
    error?: string;
  } {
    // Find the AI agent node result
    const agentNode = definition.workflow.integrations.find(int => int.type === 'ai_agent');
    let response = 'I apologize, but I cannot process your request at this time.';
    let model = definition.prompt.model;
    let executionContext: Record<string, unknown> = {};

    if (agentNode) {
      const nodeData = context.nodeData?.[agentNode.id] || context.nodeData?.[agentNode.name];
      if (nodeData) {
        // ✅ Check nested result structure first (where executor stores responses)
        const result = nodeData.result;
        if (result && result.json) {
          response = result.json.output || result.json.agentOutput || result.json.response || response;
          model = result.json.model || model;
        }
        // ✅ Fallback to direct fields
        else {
          response = nodeData.output || nodeData.agentOutput || nodeData.response || response;
          model = nodeData.model || model;
        }
        
        executionContext = {
          [agentNode.id]: nodeData,
          [agentNode.name]: nodeData
        };
      }
    }

    return {
      response,
      model,
      timestamp: new Date().toISOString(),
      executionContext
    };
  }

  /**
   * Convert input message to channel message format
   */
  private convertToChannelMessage(input: unknown, channel: string): ChannelMessage {
    const messageInput = input as {
      payload?: { text?: string };
      message?: string;
      userId?: string;
      msgId?: string;
      sessionId?: string;
      timestamp?: string;
    };

    return {
      type: 'text',
      payload: {
        text: messageInput.payload?.text || messageInput.message || 'Hello'
      },
      userId: messageInput.userId || 'anonymous',
      sessionId: messageInput.sessionId || `session_${Date.now()}`,
      timestamp: messageInput.timestamp || new Date().toISOString(),
      msgId: messageInput.msgId || `msg_${Date.now()}`
    };
  }

  /**
   * Sanitize input message
   */
  private sanitizeInput(message: unknown, sanitization?: FlowDefinition['sanitization']): unknown {
    if (!sanitization?.input_validation) {
      return message;
    }

    const { max_length } = sanitization.input_validation;
    
    let sanitized: unknown = message;
    
    if (typeof message === 'string' && max_length) {
      sanitized = message.substring(0, max_length);
    }

    return sanitized;
  }

  /**
   * Validate flow definition structure (supports both FlowDefinition and WorkflowGraph)
   */
  private validateFlowDefinition(definition: FlowDefinition | WorkflowGraph): boolean {
    try {
      // Check if it's WorkflowGraph format
      if ('nodes' in definition && 'edges' in definition) {
        return this.validateWorkflowGraph(definition as WorkflowGraph);
      }
      
      // Otherwise, validate as FlowDefinition format
      return this.validateFlowDefinitionLegacy(definition as FlowDefinition);
    } catch (error) {
      logger.error('Error validating flow definition', { error });
      return false;
    }
  }

  /**
   * Validate WorkflowGraph format
   */
  private validateWorkflowGraph(workflowGraph: WorkflowGraph): boolean {
    try {
      // Check required fields
      if (!workflowGraph.id || !workflowGraph.name || !workflowGraph.agentId) {
        logger.error('Invalid WorkflowGraph structure', { 
          id: workflowGraph.id, 
          name: workflowGraph.name, 
          agentId: workflowGraph.agentId 
        });
        return false;
      }

      if (!Array.isArray(workflowGraph.nodes) || !Array.isArray(workflowGraph.edges)) {
        logger.error('WorkflowGraph nodes or edges must be arrays');
        return false;
      }

      // Validate nodes
      for (const node of workflowGraph.nodes) {
        if (!node.id || !node.name || !node.type) {
          logger.error('Invalid node structure', { node });
          return false;
        }
        
        // Validate AI agent nodes have agentConfig
        if (node.type === 'ai_agent' && !node.agentConfig) {
          logger.error('AI agent node missing agentConfig', { nodeId: node.id });
          return false;
        }
      }

      // Validate edges
      for (const edge of workflowGraph.edges) {
        if (!edge.source || !edge.target) {
          logger.error('Invalid edge structure', { edge });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error validating WorkflowGraph', { error });
      return false;
    }
  }

  /**
   * Validate FlowDefinition format (legacy)
   */
  private validateFlowDefinitionLegacy(definition: FlowDefinition): boolean {
    try {
      // Check required fields
      if (!definition.trigger || !definition.trigger.type || !definition.trigger.channel) {
        logger.error('Invalid trigger configuration', { trigger: definition.trigger });
        return false;
      }

      if (!definition.workflow || !definition.workflow.integrations || !definition.workflow.edges) {
        logger.error('Invalid workflow structure', { workflow: definition.workflow });
        return false;
      }

      if (!definition.prompt || !definition.prompt.model || !definition.prompt.system_prompt) {
        logger.error('Invalid prompt configuration', { prompt: definition.prompt });
        return false;
      }

      // Validate trigger type
      const validTriggerTypes = ['webhook', 'whatsapp', 'slack', 'webchat'];
      if (!validTriggerTypes.includes(definition.trigger.type)) {
        logger.error('Invalid trigger type', { type: definition.trigger.type });
        return false;
      }

      // Validate workflow structure
      if (!Array.isArray(definition.workflow.integrations) || !Array.isArray(definition.workflow.edges)) {
        logger.error('Workflow integrations or edges must be arrays');
        return false;
      }

      // Validate integration structure
      for (const integration of definition.workflow.integrations) {
        if (!integration.id || !integration.name || !integration.type || !integration.integration) {
          logger.error('Invalid integration structure', { integration });
          return false;
        }
        
        if (!integration.data || !integration.position) {
          logger.error('Integration missing data or position', { integrationId: integration.id });
          return false;
        }
      }

      // Validate edges
      for (const edge of definition.workflow.edges) {
        if (!edge.source || !edge.target) {
          logger.error('Invalid edge structure', { edge });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error validating FlowDefinition', { error });
      return false;
    }
  }

  /**
   * Create integration for flow
   */
  private async createIntegrationForFlow(
    agentId: string, 
    triggerType: string, 
    channel: string, 
    workflowData: FlowDefinition | WorkflowGraph, 
    flowId: string
  ): Promise<{ integrationId: string; webhookUrl: string } | void> {
    try {
      const integrationId = uuidv4();
      let webhookUrl = '';

      // Create webhook URL for webhook and webchat trigger types
      if (triggerType === 'webhook') {
        webhookUrl = `${process.env.API_BASE_URL || 'http://localhost:3000'}/webhook/${integrationId}`;
      } else if (triggerType === 'webchat') {
        webhookUrl = `${process.env.API_BASE_URL || 'http://localhost:3000'}/webchat/webhook/${integrationId}`;
      }

      // Extract config from workflow data
      let triggerConfig = {};
      if ('trigger' in workflowData) {
        triggerConfig = (workflowData as FlowDefinition).trigger.config || {};
      }

      // Build webchat connect config and upload agent-specific config.js to R2
      let connectConfig: any = undefined;
      if (triggerType === 'webchat') {
        try {
          const { uploadJsToR2, formatTimestamp } = await import('../../utils/r2Uploader');
          // Load agent to personalize branding (use agent name and derived initials)
          const agentsRepo = new AgentsRepository();
          const agent = await agentsRepo.findById(agentId);
          const agentName = (agent && agent.name) ? String(agent.name) : 'Agent';
          const makeInitials = (name: string): string => {
            const parts = name.trim().split(/\s+/).filter(Boolean);
            if (parts.length === 0) return 'AG';
            const first = parts[0]!.charAt(0).toUpperCase();
            const second = parts.length > 1 ? parts[1]!.charAt(0).toUpperCase() : (parts[0]!.charAt(1) || 'A').toUpperCase();
            return `${first}${second}`;
          };
          const initials = makeInitials(agentName);
          const timestamp = formatTimestamp(new Date());
          const bucket = 'webchat';
          const key = `agent/config/${timestamp}-${agentId}.js`;

          // Use the config template to generate the exact format
          const { generateWebchatConfig, defaultWebchatConfig, extractUuidFromUrl } = await import('../../config/webchat-config-template');
          
          // Extract webhook UUID from URL
          const webhookUuid = extractUuidFromUrl(webhookUrl) || integrationId;
          
          const configParams = {
            agentName: agentName,
            agentSubtitle: defaultWebchatConfig.agentSubtitle || 'Always here to help',
            companyLogo: defaultWebchatConfig.companyLogo || '',
            companyInitials: initials,
            hideWatermark: defaultWebchatConfig.hideWatermark ?? false,
            greeting: defaultWebchatConfig.greeting || 'Hello! How can I assist you today?',
            welcomeMessage: defaultWebchatConfig.welcomeMessage || 'Welcome to our support chat!',
            placeholder: defaultWebchatConfig.placeholder || 'Type your message...',
            autoResponseMessage: defaultWebchatConfig.autoResponseMessage || 'Thanks for reaching out! I will get back to you shortly.',
            autoResponse: defaultWebchatConfig.autoResponse ?? true,
            autoResponseDelay: defaultWebchatConfig.autoResponseDelay || 1500,
            persistMessages: defaultWebchatConfig.persistMessages ?? false,
            waitForAgent: defaultWebchatConfig.waitForAgent ?? false,
            backendEnabled: true, // Enable backend for this agent
            webhookUuid: webhookUuid,
            timeout: defaultWebchatConfig.timeout || 30000,
            widgetId: agentId
          };

          const configJs = generateWebchatConfig(configParams);

          const upload = await uploadJsToR2({ bucket, key, content: configJs });
          // For agent config files, exclude "webchat/" from URL path
          const configJsUrl = upload.publicUrl || `https://cdn.agvion.com/${key}`;

          connectConfig = {
            chatbubble: {
              // Static inject script (same for every agent)
              webchat_js: 'https://cdn.agvion.com/webchat/v1/webchat.js',
              // Agent-scoped config file uploaded to R2
              config_js: configJsUrl
            }
          };
        } catch (uploadError) {
          logger.warn('Failed to prepare or upload webchat config to R2', { uploadError, agentId, flowId });
        }
      }

      // Create installed integration using repository to enrich from catalog
      await this.integrationsRepository.installIntegrationForAgent(
        agentId,
        flowId,
        channel,
        null,
        {
          auto_respond: false,
          wait_for_agent: true,
          ...(connectConfig ? { connect: connectConfig } : {}),
          ...triggerConfig
        },
        webhookUrl,
        integrationId
      );

      logger.info('Integration created for flow', { 
        integrationId, 
        agentId, 
        triggerType,
        channel, 
        webhookUrl 
      });

      return { integrationId, webhookUrl };
    } catch (error) {
      logger.error('Failed to create integration for flow', { error, agentId, triggerType, channel });
      // Don't throw - integration creation failure shouldn't break flow creation
    }
  }
}

export default AgentFlowService.getInstance();