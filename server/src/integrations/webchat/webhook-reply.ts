// path: integrations/webchat/webhook-reply.ts

import logger from '../../utils/logger';
import { cleanSpecialTokens } from '../../core/agentrunner/execution/executer';

/**
 * Webhook Reply Configuration
 */
export interface WebhookReplyConfig {
  responseType?: 'text' | 'json' | 'custom';
  includeMetadata?: boolean;
  format?: {
    wrapInResponse?: boolean;
    includeTimestamp?: boolean;
    includeExecutionId?: boolean;
  };
}

/**
 * Reply Context - data available from workflow execution
 */
export interface ReplyContext {
  agentId: string;
  tenantId: string;
  workflowId: string;
  workflowName: string;
  executionId: string;
  nodeId: string;
  nodeName: string;
  triggerName: string;
}

/**
 * Reply Data - the actual response content
 */
export interface ReplyData {
  result: any;
  text?: string;
  response?: string;
  output?: string;
  agentOutput?: string;
  content?: string;
  data?: any;
}

/**
 * Webhook Reply Result
 */
export interface WebhookReplyResult {
  success: boolean;
  message: string;
  response?: {
    type: string;
    text: string;
    metadata?: {
      timestamp: string;
      executionId: string;
      agentId: string;
      workflowId: string;
    };
  };
  error?: string;
}

/**
 * Extract response text from various possible data structures
 */
function extractResponseText(data: ReplyData, context: ReplyContext): string {
  // Priority order for extracting response text
  const candidates = [
    // Top-level possibilities
    data.text,
    data.response,
    data.output,
    data.agentOutput,
    data.content,
  
    // Deeply nested agent outputs
    data.result?.json?.agentOutput,
    data.result?.json?.response,
    data.result?.json?.output,
    data.result?.json?.text,
  
    // Fallback data fields
    typeof data.data === 'string' ? data.data : null,
    data.data?.text,
    data.data?.response,
    data.data?.output,
    data.data?.content
  ];
  

    for (const candidate of candidates) {
    if (candidate && typeof candidate === 'string' && candidate.trim().length > 0) {
      // Clean special tokens from the output before returning
      const cleaned = cleanSpecialTokens(candidate);
      return cleaned;
    }
  }

  // If no valid text found, log a warning
  logger.warn('No valid response text found in webhook reply data', {
    executionId: context.executionId,
    nodeId: context.nodeId,
    nodeName: context.nodeName,
    availableKeys: Object.keys(data)
  });

  return 'Response generated successfully.';
}

/**
 * Build the webhook reply response
 */
function buildReplyResponse(
  responseText: string,
  context: ReplyContext,
  config: WebhookReplyConfig
): WebhookReplyResult {
  const response: WebhookReplyResult = {
    success: true,
    message: 'Webhook reply prepared successfully',
    response: {
      type: 'text',
      text: responseText
    }
  };

  // Add metadata if requested
  if (config.includeMetadata || config.format?.includeTimestamp || config.format?.includeExecutionId) {
    response.response!.metadata = {
      timestamp: new Date().toISOString(),
      executionId: context.executionId,
      agentId: context.agentId,
      workflowId: context.workflowId
    };
  }

  return response;
}

/**
 * Main webhook reply function
 * 
 * This function is called by the workflow executor when a webhook_reply node is executed.
 * It extracts the response from the previous node's output and formats it for return.
 */
export async function executeWebhookReply(
  workflowContext: any,
  nodeConfig: any
): Promise<WebhookReplyResult> {
  // 🔍 WEBHOOK-REPLY DEBUG: Log function entry
  logger.info('🚀 [WEBHOOK-REPLY] executeWebhookReply called', {
    workflowContext: workflowContext,
    workflowContextKeys: workflowContext ? Object.keys(workflowContext) : [],
    nodeConfig: nodeConfig,
    nodeConfigKeys: nodeConfig ? Object.keys(nodeConfig) : [],
    timestamp: new Date().toISOString()
  });

  try {
    // Extract execution context
    const context: ReplyContext = {
      agentId: workflowContext.agentId || 'unknown',
      tenantId: workflowContext.tenantId || workflowContext.agentId || 'unknown',
      workflowId: workflowContext.workflowId || 'unknown',
      workflowName: workflowContext.workflowName || 'Unknown Workflow',
      executionId: workflowContext.executionId || 'unknown',
      nodeId: nodeConfig.nodeId || 'webhook_reply',
      nodeName: nodeConfig.nodeName || 'Webhook Reply',
      triggerName: workflowContext.triggerName || 'Webhook Trigger'
    };

    // 🔍 WEBHOOK-REPLY DEBUG: Log extracted context
    logger.info('🔍 [WEBHOOK-REPLY] Extracted context', {
      context: context,
      timestamp: new Date().toISOString()
    });

    logger.info('🔄 [WEBHOOK-REPLY] Processing webhook reply', {
      executionId: context.executionId,
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      workflowId: context.workflowId,
      agentId: context.agentId
    });

    // Extract reply configuration
    const config: WebhookReplyConfig = {
      responseType: nodeConfig.responseType || 'text',
      includeMetadata: nodeConfig.includeMetadata ?? true,
      format: {
        wrapInResponse: nodeConfig.format?.wrapInResponse ?? true,
        includeTimestamp: nodeConfig.format?.includeTimestamp ?? true,
        includeExecutionId: nodeConfig.format?.includeExecutionId ?? false
      }
    };

    // Get the data to reply with
    let replyData: ReplyData = {
      result: undefined
    };

    // Option 1: Explicit reply data provided in node config
    if (nodeConfig.replyData) {
      replyData = nodeConfig.replyData;
      logger.debug('Using explicit reply data from node config', {
        executionId: context.executionId,
        dataKeys: Object.keys(replyData)
      });
    }
    // Option 2: Extract from previous node's output using $json reference
    else if (nodeConfig.sourceNode || nodeConfig.source) {
      const sourceNodeName = nodeConfig.sourceNode || nodeConfig.source;
      
      // Try to get data from workflow context using standard $json pattern
      const nodeData = workflowContext.nodeData?.[sourceNodeName] || 
                       workflowContext.stepResults?.[sourceNodeName] ||
                       workflowContext[`$json`]?.[sourceNodeName];

      if (nodeData) {
        replyData = nodeData;
        logger.debug('Extracted reply data from source node', {
          executionId: context.executionId,
          sourceNode: sourceNodeName,
          dataKeys: Object.keys(replyData)
        });
      } else {
        logger.warn('Source node data not found', {
          executionId: context.executionId,
          sourceNode: sourceNodeName,
          availableNodes: Object.keys(workflowContext.nodeData || {})
        });
      }
    }
    // Option 3: Try to find the most recent AI agent output
    else if (workflowContext.nodeData) {
      // Look for AI agent outputs in reverse order (most recent first)
      const nodeNames = Object.keys(workflowContext.nodeData).reverse();
      
      for (const nodeName of nodeNames) {
        if (nodeName === context.triggerName) continue; // Skip trigger node
        
        const data = workflowContext.nodeData[nodeName];
        if (data && (data.output || data.agentOutput || data.text || data.response)) {
          replyData = data;
          logger.debug('Auto-detected reply data from recent node', {
            executionId: context.executionId,
            sourceNode: nodeName,
            dataKeys: Object.keys(replyData)
          });
          break;
        }
      }
    }

    // Extract the actual response text
    logger.info('🔍 [WEBHOOK-REPLY] Extracting response text from reply data', {
      executionId: context.executionId,
      replyData: replyData,
      replyDataKeys: Object.keys(replyData),
      timestamp: new Date().toISOString()
    });

    const responseText = extractResponseText(replyData, context);

    // 🔍 WEBHOOK-REPLY DEBUG: Log extracted response text
    logger.info('📤 [WEBHOOK-REPLY] Response text extracted', {
      executionId: context.executionId,
      nodeId: context.nodeId,
      responseText: responseText,
      responseLength: responseText.length,
      responseType: typeof responseText,
      truncatedPreview: responseText.substring(0, 100),
      timestamp: new Date().toISOString()
    });

    // Build the final response
    const result = buildReplyResponse(responseText, context, config);

    // 🔍 WEBHOOK-REPLY DEBUG: Log final result
    logger.info('📤 [WEBHOOK-REPLY] Final result built', {
      executionId: context.executionId,
      result: result,
      resultKeys: Object.keys(result),
      includesMetadata: !!result.response?.metadata,
      timestamp: new Date().toISOString()
    });

    logger.info('✅ [WEBHOOK-REPLY] Webhook reply completed successfully', {
      executionId: context.executionId,
      nodeId: context.nodeId,
      nodeName: context.nodeName,
      responseLength: responseText.length,
      includesMetadata: !!result.response?.metadata
    });

    return result;

  } catch (error) {
    logger.error('❌ [WEBHOOK-REPLY] Failed to process webhook reply', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack
      } : String(error),
      nodeConfig
    });

    return {
      success: false,
      message: 'Failed to process webhook reply',
      error: error instanceof Error ? error.message : String(error),
      response: {
        type: 'text',
        text: 'I apologize, but I encountered an error while preparing the response.'
      }
    };
  }
}

/**
 * Validate webhook reply configuration
 */
export function validateWebhookReplyConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.responseType && !['text', 'json', 'custom'].includes(config.responseType)) {
    errors.push(`Invalid responseType: ${config.responseType}. Must be 'text', 'json', or 'custom'.`);
  }

  if (config.sourceNode && typeof config.sourceNode !== 'string') {
    errors.push('sourceNode must be a string');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}