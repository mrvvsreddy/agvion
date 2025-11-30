// path: core/workflowrunner/execution/channel-adapter.ts

import logger from '../../../utils/logger';
import { WorkflowGraph, TriggerDataInjection } from './types';

// ============================================================================
// CHANNEL INTEGRATION TYPES
// ============================================================================

export interface ChannelMessage {
  readonly type: 'text' | 'image' | 'audio' | 'video' | 'file' | 'location';
  readonly payload: {
    readonly text?: string;
    readonly url?: string;
    readonly mimeType?: string;
  };
  readonly userId: string;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly msgId?: string;
}

export interface ChannelResponse {
  readonly type: 'text';
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ChannelExecutionRequest {
  readonly workflowId: string;
  readonly workflowDefinition?: WorkflowGraph;
  readonly input: Record<string, unknown>;
  readonly channelId: string;
  readonly channelType: 'webchat' | 'slack' | 'http' | 'whatsapp';
  readonly agentId: string;
  readonly tenantId: string;
  readonly originalMessage?: ChannelMessage;
  // ✅ ADD: Make sure this field exists
  readonly triggerDataInjections?: readonly TriggerDataInjection[];
}

export interface WorkflowExecutionResult {
  readonly success: boolean;
  readonly finalOutput: string;
  readonly executionId: string;
  readonly model?: string;
  readonly timestamp: string;
  readonly error?: string;
  readonly executionContext?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly send: (response: ChannelResponse, context: ChannelSendContext) => Promise<void>;
  readonly isAvailable: () => boolean;
}

export interface ChannelSendContext {
  readonly channelId: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly executionId: string;
  readonly agentId: string;
  readonly tenantId: string;
}

// ============================================================================
// CHANNEL REGISTRY
// ============================================================================

export class ChannelRegistry {
  private static instance: ChannelRegistry;
  private channels: Map<string, ChannelAdapter> = new Map();

  constructor() {
    this.registerDefaultChannels();
  }

  public static getInstance(): ChannelRegistry {
    if (!ChannelRegistry.instance) {
      ChannelRegistry.instance = new ChannelRegistry();
    }
    return ChannelRegistry.instance;
  }

  /**
   * Register a channel adapter
   */
  public registerChannel(adapter: ChannelAdapter): void {
    this.channels.set(adapter.name, adapter);
    logger.info('Channel adapter registered', { 
      name: adapter.name,
      totalChannels: this.channels.size 
    });
  }

  /**
   * Get a channel adapter by name
   */
  public getChannel(channelType: string): ChannelAdapter | null {
    return this.channels.get(channelType) || null;
  }

  /**
   * Send response to a specific channel
   */
  public async sendResponse(
    channelType: string,
    channelId: string,
    response: ChannelResponse,
    context: ChannelSendContext
  ): Promise<void> {
    const channel = this.getChannel(channelType);
    
    if (!channel) {
      logger.error('Channel not found', { channelType, channelId });
      throw new Error(`Channel not found: ${channelType}`);
    }

    if (!channel.isAvailable()) {
      logger.error('Channel not available', { channelType, channelId });
      throw new Error(`Channel not available: ${channelType}`);
    }

    try {
      logger.info('Sending response to channel', {
        channelType,
        channelId,
        responseType: response.type,
        executionId: context.executionId
      });

      await channel.send(response, context);
    } catch (error) {
      logger.error('Failed to send response to channel', {
        channelType,
        channelId,
        error: error instanceof Error ? error.message : String(error),
        executionId: context.executionId
      });
      throw error;
    }
  }

  /**
   * Register default channel adapters
   */
  private registerDefaultChannels(): void {
    // Webchat adapter
    this.registerChannel({
      name: 'webchat',
      send: async (response: ChannelResponse, context: ChannelSendContext) => {
        // Webchat responses are handled by the webhook server
        // This is mainly for consistency and future extensibility
        logger.info('Webchat response sent', {
          channelId: context.channelId,
          userId: context.userId,
          responseType: response.type,
          executionId: context.executionId
        });
      },
      isAvailable: () => true
    });

    // HTTP adapter (for webhook responses)
    this.registerChannel({
      name: 'http',
      send: async (response: ChannelResponse, context: ChannelSendContext) => {
        logger.info('HTTP response sent', {
          channelId: context.channelId,
          responseType: response.type,
          executionId: context.executionId
        });
      },
      isAvailable: () => true
    });

    // Slack adapter (placeholder)
    this.registerChannel({
      name: 'slack',
      send: async (response: ChannelResponse, context: ChannelSendContext) => {
        logger.info('Slack response sent', {
          channelId: context.channelId,
          userId: context.userId,
          responseType: response.type,
          executionId: context.executionId
        });
      },
      isAvailable: () => false // Not implemented yet
    });

    // WhatsApp adapter (placeholder)
    this.registerChannel({
      name: 'whatsapp',
      send: async (response: ChannelResponse, context: ChannelSendContext) => {
        logger.info('WhatsApp response sent', {
          channelId: context.channelId,
          userId: context.userId,
          responseType: response.type,
          executionId: context.executionId
        });
      },
      isAvailable: () => false // Not implemented yet
    });

    logger.info('Default channel adapters registered', {
      channels: Array.from(this.channels.keys())
    });
  }

  /**
   * Get all registered channel types
   */
  public getRegisteredChannels(): readonly string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Check if a channel type is supported
   */
  public isChannelSupported(channelType: string): boolean {
    return this.channels.has(channelType);
  }
}

export default ChannelRegistry.getInstance();
