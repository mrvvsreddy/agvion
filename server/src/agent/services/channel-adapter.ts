// path: agent/services/channel-adapter.ts

import logger from '../../utils/logger';
import { 
  ChannelAdapter, 
  ChannelMessage, 
  ChannelResponse, 
  WorkflowExecutionContext 
} from './types';

/**
 * Channel Adapter Interface
 * 
 * Provides a unified interface for different communication channels (webchat, slack, whatsapp, etc.)
 * to send and receive messages during workflow execution.
 * 
 * Key Features:
 * - Unified message processing across channels
 * - Response formatting and delivery
 * - Channel-specific configuration handling
 * - Error handling and fallback responses
 */
export class ChannelAdapterService {
  private static instance: ChannelAdapterService;
  private adapters: Map<string, ChannelAdapter> = new Map();

  constructor() {
    this.registerDefaultAdapters();
  }

  public static getInstance(): ChannelAdapterService {
    if (!ChannelAdapterService.instance) {
      ChannelAdapterService.instance = new ChannelAdapterService();
    }
    return ChannelAdapterService.instance;
  }

  /**
   * Register a channel adapter
   */
  public registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);
    logger.info('Channel adapter registered', { 
      name: adapter.name,
      totalAdapters: this.adapters.size 
    });
  }

  /**
   * Get a channel adapter by name
   */
  public getAdapter(channelName: string): ChannelAdapter | null {
    return this.adapters.get(channelName) || null;
  }

  /**
   * Process a message through the appropriate channel adapter
   */
  public async processMessage(
    channelName: string,
    message: ChannelMessage,
    context: WorkflowExecutionContext
  ): Promise<ChannelResponse> {
    const adapter = this.getAdapter(channelName);
    
    if (!adapter) {
      logger.error('Channel adapter not found', { channelName });
      return {
        type: 'text',
        text: 'I apologize, but this communication channel is not supported.'
      };
    }

    try {
      logger.info('Processing message through channel adapter', {
        channelName,
        adapterName: adapter.name,
        messageType: message.type,
        userId: message.userId,
        executionId: context.executionId
      });

      return await adapter.processMessage(message, context);
    } catch (error) {
      logger.error('Channel adapter processing failed', {
        channelName,
        adapterName: adapter.name,
        error: error instanceof Error ? error.message : String(error),
        executionId: context.executionId
      });

      return {
        type: 'text',
        text: 'I apologize, but I encountered an error processing your message.'
      };
    }
  }

  /**
   * Send a response through the appropriate channel adapter
   */
  public async sendResponse(
    channelName: string,
    response: ChannelResponse,
    context: WorkflowExecutionContext
  ): Promise<void> {
    const adapter = this.getAdapter(channelName);
    
    if (!adapter) {
      logger.error('Channel adapter not found for response', { channelName });
      return;
    }

    try {
      logger.info('Sending response through channel adapter', {
        channelName,
        adapterName: adapter.name,
        responseType: response.type,
        executionId: context.executionId
      });

      await adapter.sendResponse(response, context);
    } catch (error) {
      logger.error('Channel adapter response failed', {
        channelName,
        adapterName: adapter.name,
        error: error instanceof Error ? error.message : String(error),
        executionId: context.executionId
      });
    }
  }

  /**
   * Register default channel adapters
   */
  private registerDefaultAdapters(): void {
    // Webchat adapter
    this.registerAdapter({
      name: 'webchat',
      processMessage: async (message: ChannelMessage, context: WorkflowExecutionContext) => {
        // Webchat messages are already processed by the webhook server
        // This is mainly for consistency and future extensibility
        return {
          type: 'text',
          text: message.payload.text || 'Message received'
        };
      },
      sendResponse: async (response: ChannelResponse, context: WorkflowExecutionContext) => {
        // Webchat responses are handled by the webhook server
        // This is mainly for consistency and future extensibility
        logger.info('Webchat response sent', {
          responseType: response.type,
          executionId: context.executionId
        });
      }
    });

    // Slack adapter (placeholder)
    this.registerAdapter({
      name: 'slack',
      processMessage: async (message: ChannelMessage, context: WorkflowExecutionContext) => {
        return {
          type: 'text',
          text: 'Slack integration not yet implemented'
        };
      },
      sendResponse: async (response: ChannelResponse, context: WorkflowExecutionContext) => {
        logger.info('Slack response sent', {
          responseType: response.type,
          executionId: context.executionId
        });
      }
    });

    // WhatsApp adapter (placeholder)
    this.registerAdapter({
      name: 'whatsapp',
      processMessage: async (message: ChannelMessage, context: WorkflowExecutionContext) => {
        return {
          type: 'text',
          text: 'WhatsApp integration not yet implemented'
        };
      },
      sendResponse: async (response: ChannelResponse, context: WorkflowExecutionContext) => {
        logger.info('WhatsApp response sent', {
          responseType: response.type,
          executionId: context.executionId
        });
      }
    });

    logger.info('Default channel adapters registered', {
      adapters: Array.from(this.adapters.keys())
    });
  }

  /**
   * Get all registered channel names
   */
  public getRegisteredChannels(): readonly string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Check if a channel is supported
   */
  public isChannelSupported(channelName: string): boolean {
    return this.adapters.has(channelName);
  }
}

export default ChannelAdapterService.getInstance();
