// path: integrations/webchat/webhook-server.ts
import express, { Request, Response, NextFunction } from 'express';
import { config } from 'dotenv';
import AgentIntegrationsRepository from '../../database/repositories/AgentIntegrationsRepository';
import AgentFlowsRepository from '../../database/repositories/AgentFlowsRepository';
import logger from '../../utils/logger';
import { loadAgentContext } from '../../core/agentrunner/AgentContextLoader';

config();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'location';

export interface TextPayload {
  text: string;
}

export interface ImagePayload {
  url: string;
  mimeType?: string;
}

export interface IncomingMessage {
  type: MessageType;
  payload: TextPayload | ImagePayload;
  userId: string;
  sessionId?: string;
}

export interface ResponseMessage {
  type: 'text';
  text: string;
}

export interface WebhookResponse {
  agentId: string;
  responses: ResponseMessage[];
  timestamp: string;
  executionId: string;
}

interface WorkflowIntegration {
  id: string;
  name: string;
  type: string;
  integration?: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

interface WorkflowDefinition {
  integrations: WorkflowIntegration[];
  edges: WorkflowEdge[];
  variables?: Record<string, any>;
}

interface WorkflowData {
  workflow?: WorkflowDefinition;
  prompt?: {
    model?: string;
    system_prompt?: string;
    user_prompt_template?: string;
    temperature?: number;
    max_tokens?: number;
  };
  trigger?: {
    type: string;
    config: Record<string, any>;
    channel: string;
  };
  sanitization?: {
    input_validation?: {
      max_length?: number;
      allowed_characters?: string;
    };
    output_validation?: {
      max_length?: number;
    };
  };
  credentials?: {
    api_keys?: Record<string, string>;
    webhook_secrets?: Record<string, string>;
  };
  knowledgeTables?: any;
}

declare global {
  namespace Express {
    interface Request {
      startTime?: number;
      executionId?: string;
    }
  }
}

// ============================================================================
// REQUEST VALIDATION (Minimal - just structure)
// ============================================================================

interface ValidationResult {
  isValid: boolean;
  error?: string;
  message?: IncomingMessage;
}

function validateMessage(body: any): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { isValid: false, error: 'Request body must be a valid JSON object' };
  }

  if (!body.type || typeof body.type !== 'string') {
    return { isValid: false, error: 'Missing or invalid field: type' };
  }

  if (!body.payload || typeof body.payload !== 'object') {
    return { isValid: false, error: 'Missing or invalid field: payload' };
  }

  if (!body.userId || typeof body.userId !== 'string' || body.userId.trim() === '') {
    return { isValid: false, error: 'Missing or invalid field: userId' };
  }

  const validTypes: MessageType[] = ['text', 'image', 'audio', 'video', 'file', 'location'];
  if (!validTypes.includes(body.type)) {
    return {
      isValid: false,
      error: `Unsupported message type: ${body.type}. Supported: ${validTypes.join(', ')}`
    };
  }

  // Basic payload validation
  if (body.type === 'text') {
    if (!body.payload.text || typeof body.payload.text !== 'string' || body.payload.text.trim() === '') {
      return { isValid: false, error: 'Missing or invalid field: payload.text' };
    }
  } else if (body.type === 'image') {
    if (!body.payload.url || typeof body.payload.url !== 'string') {
      return { isValid: false, error: 'Missing or invalid field: payload.url' };
    }
  }

  if (body.sessionId !== undefined && typeof body.sessionId !== 'string') {
    return { isValid: false, error: 'Invalid field: sessionId must be a string' };
  }

  return {
    isValid: true,
    message: {
      type: body.type as MessageType,
      payload: body.payload,
      userId: body.userId.trim(),
      sessionId: body.sessionId
    }
  };
}

// ============================================================================
// WORKFLOW PROCESSING (Simplified - No Response Validation)
// ============================================================================

async function processWebhookMessage(
  webhookId: string,
  message: IncomingMessage,
  executionId: string
): Promise<{ responses: ResponseMessage[]; agentId: string }> {
  const startTime = Date.now();

  logger.info('🚀 [WEBHOOK] Starting message processing', {
    executionId,
    webhookId,
    userId: message.userId,
    messageType: message.type,
    messagePayload: message.payload,
    sessionId: message.sessionId,
    timestamp: new Date().toISOString()
  });

  try {

    // Step 1: Load webhook record
    logger.info('🔍 [WEBHOOK] Loading webhook record', { executionId, webhookId });
    const webhook = await AgentIntegrationsRepository.getIntegrationById(webhookId);

    if (!webhook) {
      logger.warn('❌ [WEBHOOK] Webhook not found', { executionId, webhookId });
      return {
        agentId: 'unknown',
        responses: [{
          type: 'text',
          text: 'I apologize, but this webhook is not configured.'
        }]
      };
    }

    if (!webhook.is_enabled) {
      logger.warn('❌ [WEBHOOK] Webhook disabled', { executionId, webhookId });
      return {
        agentId: (webhook as any).agent_id || 'unknown',
        responses: [{
          type: 'text',
          text: 'I apologize, but this service is currently unavailable.'
        }]
      };
    }

    // Extract agent_id from webhook table
    const agentId = (webhook as any).agent_id;
    if (!agentId || typeof agentId !== 'string') {
      logger.error('❌ [WEBHOOK] Missing agent_id in webhook record', { 
        executionId, 
        webhookId,
        availableKeys: Object.keys(webhook)
      });
      return {
        agentId: 'unknown',
        responses: [{
          type: 'text',
          text: 'I apologize, but this webhook is not properly configured.'
        }]
      };
    }

    if (!(webhook as any).workflow_id) {
      logger.error('❌ [WEBHOOK] No workflow_id in webhook', { executionId, webhookId, agentId });
      return {
        agentId,
        responses: [{
          type: 'text',
          text: 'I apologize, but this webhook is not properly configured.'
        }]
      };
    }

    // Step 2: Load workflow
    logger.info('📋 [WEBHOOK] Loading workflow', {
      executionId,
      webhookId,
      agentId,
      workflowId: (webhook as any).workflow_id
    });

    const workflow = await AgentFlowsRepository.getFlowById((webhook as any).workflow_id);

    if (!workflow) {
      logger.error('❌ [WEBHOOK] Workflow not found', {
        executionId,
        webhookId,
        agentId,
        workflowId: (webhook as any).workflow_id
      });
      return {
        agentId,
        responses: [{
          type: 'text',
          text: 'I apologize, but the workflow configuration is missing.'
        }]
      };
    }

    if (workflow.status !== 'active') {
      logger.warn('❌ [WEBHOOK] Workflow not active', {
        executionId,
        webhookId,
        agentId,
        workflowId: workflow.id,
        status: workflow.status
      });
      return {
        agentId,
        responses: [{
          type: 'text',
          text: 'I apologize, but this workflow is not currently active.'
        }]
      };
    }

    // Step 3: Parse workflow definition (only use workflow_data column)
    let workflowData: WorkflowData;
    let isWorkflowGraph = false;
    let isFlowDefinition = false;
    
    try {
      const rawDefinition = (workflow as any).workflow_data;
      
      if (!rawDefinition) {
        logger.error('❌ [WEBHOOK] workflow_data column is missing', {
          executionId,
          webhookId,
          agentId,
          workflowId: workflow.id,
          availableKeys: Object.keys(workflow)
        });
        return {
          agentId,
          responses: [{
            type: 'text',
            text: 'I apologize, but the workflow configuration is missing.'
          }]
        };
      }

      workflowData = typeof rawDefinition === 'string'
        ? JSON.parse(rawDefinition)
        : rawDefinition;

      // Validate required structure
      if (!workflowData || typeof workflowData !== 'object') {
        logger.error('❌ [WEBHOOK] workflow_data is not a valid object', {
          executionId,
          webhookId,
          agentId,
          workflowId: workflow.id,
          workflowDataType: typeof workflowData
        });
        return {
          agentId,
          responses: [{
            type: 'text',
            text: 'I apologize, but the workflow configuration is invalid.'
          }]
        };
      }

      // Support both WorkflowGraph (nodes/edges) and FlowDefinition (workflow.integrations) formats
      isWorkflowGraph = 'nodes' in workflowData && 'edges' in workflowData;
      isFlowDefinition = 'workflow' in workflowData && (workflowData.workflow as any)?.integrations;
      
      if (!isWorkflowGraph && !isFlowDefinition) {
        logger.error('❌ [WEBHOOK] workflow_data missing required structure (nodes/edges or workflow.integrations)', {
          executionId,
          webhookId,
          agentId,
          workflowId: workflow.id,
          hasWorkflow: !!workflowData.workflow,
          hasNodes: !!(workflowData as any).nodes,
          hasEdges: !!(workflowData as any).edges,
          hasIntegrations: !!(workflowData.workflow as any)?.integrations,
          workflowDataKeys: Object.keys(workflowData)
        });
        return {
          agentId,
          responses: [{
            type: 'text',
            text: 'I apologize, but the workflow configuration is invalid.'
          }]
        };
      }

      logger.debug('📋 [WEBHOOK] Workflow data parsed successfully', {
        executionId,
        webhookId,
        agentId,
        workflowId: workflow.id,
        isWorkflowGraph,
        isFlowDefinition,
        integrationCount: isWorkflowGraph ? (workflowData as any).nodes.length : (workflowData.workflow as any).integrations.length,
        edgeCount: isWorkflowGraph ? (workflowData as any).edges.length : (workflowData.workflow as any).edges.length,
        hasPrompt: !!(workflowData as any).prompt,
        hasCredentials: !!(workflowData as any).credentials
      });

      // ✅ Load workflow + knowledge data for this agent
      try {
        const agentContext = await loadAgentContext(agentId);
        // Merge into workflowData for executor use
        workflowData.knowledgeTables = agentContext.knowledgeTables;
        
        logger.debug('📚 [WEBHOOK] Knowledge tables loaded and merged', {
          executionId,
          webhookId,
          agentId,
          hasKnowledgeTables: !!workflowData.knowledgeTables
        });
      } catch (contextError) {
        logger.warn('⚠️ [WEBHOOK] Failed to load agent context, continuing without knowledge tables', {
          executionId,
          webhookId,
          agentId,
          error: contextError instanceof Error ? contextError.message : String(contextError)
        });
        // Continue without knowledge tables if loading fails
        workflowData.knowledgeTables = null;
      }

    } catch (error) {
      logger.error('❌ [WEBHOOK] Failed to parse workflow_data', {
        executionId,
        webhookId,
        agentId,
        workflowId: workflow.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        agentId,
        responses: [{
          type: 'text',
          text: 'I apologize, but the workflow configuration is invalid.'
        }]
      };
    }

    // Step 4: Use AgentFlowService to process the webhook message
    logger.info('🔧 [WEBHOOK] Preparing to call AgentFlowService', { executionId, webhookId, agentId });
    
    const AgentFlowService = await import('../../agent/services/AgentFlowService');
    const flowService = AgentFlowService.default;
    
    // ✅ FIX: Create proper trigger data structure
    const triggerData = {
      message: message.type === 'text' ? (message.payload as any).text : '',
      text: message.type === 'text' ? (message.payload as any).text : '',
      userId: message.userId,
      sessionId: message.sessionId,
      messageType: message.type,
      timestamp: new Date().toISOString()
    };

    // ✅ FIX: Find actual trigger node from workflowData instead of workflow
    let triggerNode: any = null;
    let triggerNodeId = 'unknown';
    let triggerNodeName = 'unknown';
    
    if (isWorkflowGraph && workflowData) {
      // For WorkflowGraph format: nodes/edges structure
      const nodes = (workflowData as any).nodes;
      if (nodes && Array.isArray(nodes)) {
        triggerNode = nodes.find((n: any) => n.type === 'trigger' || n.triggerName || n.id?.includes('webchat'));
      }
    } else if (isFlowDefinition && workflowData.workflow) {
      // For FlowDefinition format: workflow.integrations structure
      const integrations = (workflowData.workflow as any).integrations;
      if (integrations && Array.isArray(integrations)) {
        triggerNode = integrations.find((n: any) => n.trigger || n.triggerName || n.id?.includes('webchat'));
      }
    }
    
    if (triggerNode) {
      triggerNodeId = triggerNode.id || 'unknown';
      triggerNodeName = triggerNode.name || triggerNode.triggerName || triggerNodeId;
    } else {
      // Fallback: Try to use channel_input as default if no trigger found
      logger.warn('⚠️ [WEBHOOK] No trigger node found in workflow, using fallback', {
        executionId,
        isWorkflowGraph,
        isFlowDefinition
      });
      triggerNodeId = 'channel_input';
      triggerNodeName = 'channel_input';
    }

    logger.info('🔍 [WEBHOOK] Identified trigger node', {
      executionId,
      triggerNodeId,
      triggerNodeName,
      hasTriggerNode: !!triggerNode,
      isWorkflowGraph,
      isFlowDefinition,
      workflowDataKeys: workflowData ? Object.keys(workflowData) : [],
      nodeCount: isWorkflowGraph ? (workflowData as any).nodes?.length : (workflowData as any).workflow?.integrations?.length,
      allNodeIds: isWorkflowGraph 
        ? (workflowData as any).nodes?.map((n: any) => ({ id: n.id, name: n.name, type: n.type })) 
        : (workflowData as any).workflow?.integrations?.map((n: any) => ({ id: n.id, name: n.name, type: n.type }))
    });

    const flowServiceInput = {
      ...triggerData,
      msgId: executionId,
      // ✅ ADD: Include trigger data injections with actual node IDs
      triggerDataInjections: [{
        nodeId: triggerNodeId,
        nodeName: triggerNodeName,
        triggerType: 'webchat',
        data: triggerData
      }]
    };

    logger.info('🔄 [WEBHOOK] Calling AgentFlowService with trigger data', {
      executionId,
      webhookId,
      agentId,
      flowServiceInput: flowServiceInput,
      hasTriggerData: !!flowServiceInput.triggerDataInjections,
      triggerDataCount: flowServiceInput.triggerDataInjections?.length || 0,
      hasWorkflowData: !!workflowData,
      hasKnowledgeTables: !!workflowData.knowledgeTables,
      timestamp: new Date().toISOString()
    });
    
    const executionResult = await flowService.processWebhookMessage(
      agentId,
      'webchat',
      { ...flowServiceInput, workflowData }
    );

    logger.info('📤 [WEBHOOK] AgentFlowService.processWebhookMessage completed', {
      executionId,
      webhookId,
      agentId,
      executionResult: executionResult,
      success: executionResult.success,
      hasResponse: !!executionResult.response,
      responseType: typeof executionResult.response,
      timestamp: new Date().toISOString()
    });

    if (!executionResult.success) {
      logger.error('❌ [WEBHOOK] Workflow execution failed', {
        executionId,
        webhookId,
        agentId,
        workflowId: workflow.id,
        error: executionResult.message
      });
      return {
        agentId,
        responses: [{
          type: 'text',
          text: executionResult.message || 'I apologize, but I encountered an error while processing your request.'
        }]
      };
    }

    // ✅ SIMPLIFIED: Extract response without any validation
    // Just try to get any text from any possible field
    let responseText: string = '';

    if (executionResult.response) {
      const response = executionResult.response as any;
      
      logger.debug('🔍 [WEBHOOK] Raw response structure', {
        executionId,
        webhookId,
        agentId,
        responseType: typeof response,
        responseKeys: response && typeof response === 'object' ? Object.keys(response) : [],
        fullResponse: response
      });
      
      // Try only specific field names - no validation, just extraction
      responseText = 
        response.finalOutput ||
        response.response ||
        response.output ||
        response.content ||
        (typeof response === 'string' ? response : '') ||
        '';

      // If still empty, try to extract from executionContext
      if (!responseText && response.executionContext?.nodeData) {
        const nodeData = response.executionContext.nodeData;
        for (const [nodeKey, data] of Object.entries(nodeData)) {
          if (data && typeof data === 'object') {
            const nodeOutput = (data as any).output || 
                             (data as any).agentOutput || 
                             (data as any).response || 
                             (data as any).content;
            if (nodeOutput && typeof nodeOutput === 'string' && nodeOutput.trim()) {
              responseText = nodeOutput.trim();
              logger.debug('✅ [WEBHOOK] Found response in execution context', { 
                executionId, 
                nodeKey, 
                responseLength: responseText.length 
              });
              break;
            }
          }
        }
      }

      // If still empty, try to stringify the entire response
      if (!responseText && typeof response === 'object') {
        try {
          responseText = JSON.stringify(response);
          logger.debug('📝 [WEBHOOK] Stringified entire response object', {
            executionId,
            responseLength: responseText.length
          });
        } catch (e) {
          logger.warn('⚠️ [WEBHOOK] Could not stringify response', { executionId });
        }
      }
    }

    // Trim whitespace
    responseText = (responseText || '').trim();

    // Only use fallback if completely empty
    if (!responseText) {
      logger.warn('⚠️ [WEBHOOK] No response text found in any field, using fallback', {
        executionId,
        webhookId,
        agentId,
        hasResponse: !!executionResult.response
      });
      responseText = 'No response generated.';
    }

    const processingTime = Date.now() - startTime;
    logger.info('🎉 [WEBHOOK] Message processed successfully', {
      executionId,
      webhookId,
      agentId,
      workflowId: workflow.id,
      processingTime,
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 200) + (responseText.length > 200 ? '...' : '')
    });

    return {
      agentId,
      responses: [{ type: 'text', text: responseText }]
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('❌ [WEBHOOK] Unhandled error', {
      executionId,
      webhookId,
      userId: message.userId,
      processingTime,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error)
    });

    return {
      agentId: 'unknown',
      responses: [{
        type: 'text',
        text: 'I apologize, but I encountered an unexpected error. Please try again later.'
      }]
    };
  }
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();

const REQUEST_TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '30000', 10);
const MAX_PAYLOAD_SIZE = process.env.WEBHOOK_MAX_PAYLOAD || '10mb';

// Middleware
app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_PAYLOAD_SIZE }));

// Timeout middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      logger.warn('Request timeout', {
        method: req.method,
        path: req.path,
        timeout: REQUEST_TIMEOUT_MS
      });
      res.status(408).json({ error: 'Request timeout' });
    }
  }, REQUEST_TIMEOUT_MS);

  res.on('finish', () => clearTimeout(timeout));
  res.on('close', () => clearTimeout(timeout));
  next();
});

// Request tracking middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  req.startTime = Date.now();
  req.executionId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  next();
});

// ============================================================================
// ROUTES
// ============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Return webchat connect script URLs for a given agent

app.post('/webhook/:webhookId', async (req: Request, res: Response): Promise<void> => {
  const startTime = req.startTime || Date.now();
  const requestId = req.executionId || 'unknown';
  const { webhookId } = req.params;

  logger.info('🚀 [WEBHOOK-SERVER] Incoming request received', {
    webhookId,
    requestId,
    method: req.method,
    url: req.url,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'content-length': req.headers['content-length']
    },
    body: req.body,
    bodyType: typeof req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
    timestamp: new Date().toISOString()
  });

  try {
    // Minimal validation - just check webhook ID
    if (!webhookId || webhookId.trim() === '') {
      logger.warn('❌ [WEBHOOK-SERVER] Missing webhook ID', { requestId });
      res.status(400).json({ error: 'Webhook ID is required' });
      return;
    }

    // Validate message structure
    const validation = validateMessage(req.body);
    if (!validation.isValid) {
      logger.warn('❌ [WEBHOOK-SERVER] Message validation failed', {
        webhookId,
        requestId,
        error: validation.error,
        receivedBody: req.body
      });
      res.status(400).json({ error: validation.error });
      return;
    }

    const message = validation.message!;

    logger.info('✅ [WEBHOOK-SERVER] Processing webhook request', {
      webhookId,
      userId: message.userId,
      sessionId: message.sessionId,
      messageType: message.type,
      requestId,
      messagePayload: message.payload
    });

    logger.info('🔄 [WEBHOOK-SERVER] Calling processWebhookMessage', {
      webhookId,
      requestId,
      message: message,
      timestamp: new Date().toISOString()
    });

    const { agentId, responses } = await processWebhookMessage(webhookId, message, requestId);

    logger.info('📤 [WEBHOOK-SERVER] processWebhookMessage completed', {
      webhookId,
      requestId,
      agentId,
      responses: responses,
      responseCount: responses.length,
      timestamp: new Date().toISOString()
    });

    const webhookResponse: WebhookResponse = {
      agentId: agentId,
      responses,
      timestamp: new Date().toISOString(),
      executionId: requestId
    };

    logger.info('📤 [WEBHOOK-SERVER] Sending final response to client', {
      webhookId,
      requestId,
      webhookResponse: webhookResponse,
      responseSize: JSON.stringify(webhookResponse).length,
      timestamp: new Date().toISOString()
    });

    const duration = Date.now() - startTime;
    logger.info('✅ [WEBHOOK-SERVER] Webhook request completed successfully', {
      webhookId,
      agentId,
      userId: message.userId,
      requestId,
      duration: `${duration}ms`,
      responseCount: responses.length,
      status: 200
    });

    res.status(200).json(webhookResponse);

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('💥 [WEBHOOK-SERVER] Webhook request failed with error', {
      webhookId,
      requestId,
      duration: `${duration}ms`,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error),
      errorType: typeof error,
      timestamp: new Date().toISOString()
    });

    if (!res.headersSent) {
      const errorResponse = { error: 'Internal server error' };
      logger.info('📤 [WEBHOOK-SERVER] Sending error response to client', {
        webhookId,
        requestId,
        errorResponse,
        status: 500,
        timestamp: new Date().toISOString()
      });
      res.status(500).json(errorResponse);
    }
  }
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled middleware error', {
    error: { message: error.message, stack: error.stack },
    method: req.method,
    path: req.path,
    requestId: req.executionId
  });

  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// EXPORTS
// ============================================================================

export { app as webchatWebhookServer };
export default app;