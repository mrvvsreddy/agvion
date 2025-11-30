// database/services/ConversationService.ts
import ConversationsRepository, { 
  Conversation, 
  CreateConversationData, 
  UpdateConversationData,
  ConversationFilters 
} from '../repositories/ConversationsRepository';
import MessagesRepository, { 
  Message, 
  CreateMessageData, 
  UpdateMessageData,
  MessageFilters 
} from '../repositories/MessagesRepository';
import ConversationParticipantsRepository, {
  ConversationParticipant,
  CreateConversationParticipantData,
  UpdateConversationParticipantData,
  ConversationParticipantFilters
} from '../repositories/ConversationParticipantsRepository';
import { PaginationOptions, PaginatedResult } from '../repositories/BaseRepository';
import {
  ConversationNotFoundError,
  ConversationUnauthorizedError,
  ParticipantUnauthorizedError,
  ParticipantNotFoundError,
  ConversationValidationError,
  MessageNotFoundError
} from '../errors/ConversationErrors';
import logger from '../../utils/logger';

// "latestMessage" is now required (not optional) in ConversationWithMessages and ConversationSummary interfaces,
// to match the types from the repository methods and avoid TS error about 'undefined'.

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
  messageCount: number;
  latestMessage: Message | null;
  participants?: ConversationParticipant[]; // Active participants in the conversation
  participantCount?: number;
}

export interface ConversationSummary {
  id: string;
  agent_id: string;
  user_id: string;
  channel: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  messageCount: number;
  latestMessage: {
    id: string;
    direction: string;
    type: string;
    timestamp: string;
    preview: string;
  } | null;
}

export interface CreateConversationWithMessageData {
  conversation: CreateConversationData;
  initialMessage?: CreateMessageData;
}

export interface ConversationStats {
  totalConversations: number;
  activeConversations: number;
  completedConversations: number;
  totalMessages: number;
  averageMessagesPerConversation: number;
  conversationsByChannel: Record<string, number>;
  conversationsByStatus: Record<string, number>;
  messagesByDirection: Record<string, number>;
  messagesByType: Record<string, number>;
  recentActivity: {
    conversationsCreated: number;
    messagesSent: number;
    lastActivity: string;
  };
}

export interface ConversationSearchOptions {
  query?: string;
  agentId?: string;
  userId?: string;
  channel?: string;
  status?: string;
  dateRange?: {
    from: string;
    to: string;
  };
  includeMessages?: boolean;
  messageLimit?: number;
}

class ConversationService {
  private conversationsRepo: typeof ConversationsRepository;
  private messagesRepo: typeof MessagesRepository;
  private participantsRepo: typeof ConversationParticipantsRepository;

  constructor() {
    this.conversationsRepo = ConversationsRepository;
    this.messagesRepo = MessagesRepository;
    this.participantsRepo = ConversationParticipantsRepository;
  }

  /**
   * Helper method to validate conversation ownership and existence
   * Throws appropriate errors if validation fails
   */
  private async validateConversationAccess(
    customerId: string,
    conversationId: string
  ): Promise<Conversation> {
    const conversation = await this.conversationsRepo.findById(conversationId);
    
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId, customerId);
    }

    if (conversation.customer_id !== customerId) {
      throw new ConversationUnauthorizedError(
        conversationId,
        customerId,
        conversation.customer_id
      );
    }

    return conversation;
  }

  /**
   * Helper method to validate participant belongs to same customer as conversation
   */
  private async validateParticipantCustomer(
    agentId: string,
    agentCustomerId: string,
    conversationCustomerId: string
  ): Promise<void> {
    if (agentCustomerId !== conversationCustomerId) {
      throw new ParticipantUnauthorizedError(
        agentId,
        agentCustomerId,
        conversationCustomerId
      );
    }
  }

  /**
   * Private helper to enrich conversations with message counts and latest messages
   * Uses batch loading to avoid N+1 queries
   */
  private async enrichConversationsWithSummaries(
    conversations: Conversation[]
  ): Promise<ConversationSummary[]> {
    if (conversations.length === 0) {
      return [];
    }

    const conversationIds = conversations.map(c => c.id);
    const [messageCounts, latestMessages] = await Promise.all([
      this.messagesRepo.getMessageCountsBatch(conversationIds),
      this.messagesRepo.getLatestMessagesBatch(conversationIds)
    ]);

    return conversations.map(conversation => {
      const messageCount = messageCounts[conversation.id] || 0;
      const latestMessage = latestMessages[conversation.id] || null;

      return {
        id: conversation.id,
        agent_id: conversation.agent_id,
        user_id: conversation.user_id,
        channel: conversation.channel,
        status: conversation.status || 'active', // Default status if not set (NOTE: status should be in schema with CHECK constraint)
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        last_message_at: conversation.last_message_at,
        messageCount,
        latestMessage: latestMessage ? {
          id: latestMessage.id,
          direction: latestMessage.direction,
          type: latestMessage.type,
          timestamp: latestMessage.timestamp,
          preview: this.createMessagePreview(latestMessage)
        } : null
      };
    });
  }

  /**
   * Helper method to calculate interval between two timestamps
   * Returns PostgreSQL interval format: 'HH:MM:SS.ms'
   */
  private calculateInterval(startTime: string, endTime: string): string {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    // Validate timestamp format
    if (isNaN(start) || isNaN(end)) {
      throw new ConversationValidationError(
        'Invalid timestamp format for interval calculation',
        'timestamp',
        { startTime, endTime }
      );
    }

    // Handle edge case: end time before start time
    if (end < start) {
      logger.warn('ConversationService.calculateInterval: end time before start time', {
        startTime,
        endTime,
        startMs: start,
        endMs: end
      });
      // Return zero interval for invalid time order
      return '00:00:00.0';
    }

    const diffMs = end - start;

    // Convert to PostgreSQL interval format: 'HH:MM:SS.ms'
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    const milliseconds = diffMs % 1000;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${Math.floor(milliseconds)}`;
  }

  /**
   * Create a new conversation with optional initial message
   * NOTE: Supabase PostgREST doesn't support native transactions.
   * This implements compensating actions (rollback) on failure.
   */
  async createConversationWithMessage(
    data: CreateConversationWithMessageData
  ): Promise<ConversationWithMessages> {
    let conversation: Conversation | null = null;
    let participant: ConversationParticipant | null = null;
    let message: Message | null = null;

    try {
      logger.info('ConversationService.createConversationWithMessage: starting operation', {
        agentId: data.conversation.agent_id,
        userId: data.conversation.user_id,
        channel: data.conversation.channel,
        customerId: data.conversation.customer_id,
        hasInitialMessage: !!data.initialMessage
      });

      // Step 1: Create the conversation
      conversation = await this.conversationsRepo.create(data.conversation);

      try {
        // Step 2: Add the primary agent as owner participant
        participant = await this.participantsRepo.create({
          conversation_id: conversation.id,
          customer_id: data.conversation.customer_id,
          agent_id: data.conversation.agent_id,
          role: 'owner',
          is_active: true
        });

        let messages: Message[] = [];
        let latestMessage: Message | null = null;

        // Step 3: Add initial message if provided
        if (data.initialMessage) {
          try {
            const messageData: CreateMessageData = {
              ...data.initialMessage,
              conversation_id: conversation.id,
              timestamp: data.initialMessage.timestamp || new Date().toISOString()
            };

            message = await this.messagesRepo.create(messageData);
            messages = [message];
            latestMessage = message;

            // Step 4: Update conversation's last_message_at
            await this.conversationsRepo.updateLastMessageAt(conversation.id, message.timestamp);
          } catch (messageError) {
            // Rollback: Delete participant and conversation if message creation fails
            logger.error('ConversationService.createConversationWithMessage: message creation failed, rolling back', {
              error: messageError instanceof Error ? messageError.message : String(messageError),
              conversationId: conversation.id
            });
            
            if (participant) {
              try {
                await this.participantsRepo.deleteParticipant(conversation.id, data.conversation.agent_id);
              } catch (deleteError) {
                logger.error('ConversationService.createConversationWithMessage: failed to rollback participant', {
                  error: deleteError instanceof Error ? deleteError.message : String(deleteError)
                });
              }
            }
            
            try {
              await this.conversationsRepo.delete(conversation.id);
            } catch (deleteError) {
              logger.error('ConversationService.createConversationWithMessage: failed to rollback conversation', {
                error: deleteError instanceof Error ? deleteError.message : String(deleteError)
              });
            }
            
            throw messageError;
          }
        }

        // Get active participants
        const participants = await this.participantsRepo.findActiveByConversation(conversation.id);
        const participantCount = participants.length;

        const result: ConversationWithMessages = {
          ...conversation,
          messages,
          messageCount: messages.length,
          latestMessage,
          participants,
          participantCount
        };

        logger.info('ConversationService.createConversationWithMessage: operation completed', {
          conversationId: conversation.id,
          messageCount: messages.length
        });

        return result;
      } catch (participantError) {
        // Rollback: Delete conversation if participant creation fails
        logger.error('ConversationService.createConversationWithMessage: participant creation failed, rolling back', {
          error: participantError instanceof Error ? participantError.message : String(participantError),
          conversationId: conversation.id
        });
        
        try {
          await this.conversationsRepo.delete(conversation.id);
        } catch (deleteError) {
          logger.error('ConversationService.createConversationWithMessage: failed to rollback conversation', {
            error: deleteError instanceof Error ? deleteError.message : String(deleteError)
          });
        }
        
        throw participantError;
      }
    } catch (error) {
      logger.error('ConversationService.createConversationWithMessage: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId: data.conversation.agent_id,
        userId: data.conversation.user_id,
        customerId: data.conversation.customer_id
      });
      throw error;
    }
  }

  /**
   * Add a message to an existing conversation
   */
  async addMessageToConversation(
    customerId: string,
    conversationId: string,
    messageData: Omit<CreateMessageData, 'conversation_id'>
  ): Promise<Message> {
    const startTime = Date.now();
    const operation = 'ConversationService.addMessageToConversation';
    
    try {
      logger.info(`${operation}: starting`, {
        operation,
        customerId,
        conversationId,
        direction: messageData.direction,
        type: messageData.type,
        senderType: messageData.sender_type
      });

      // Validate conversation access and ownership
      const conversation = await this.validateConversationAccess(customerId, conversationId);

      // Create the message
      const fullMessageData: CreateMessageData = {
        ...messageData,
        conversation_id: conversationId,
        timestamp: messageData.timestamp || new Date().toISOString()
      };

      const message = await this.messagesRepo.create(fullMessageData);

      // Update conversation's last_message_at
      await this.conversationsRepo.updateLastMessageAt(conversationId, message.timestamp);

      // Calculate first_response_time if this is first agent reply
      let firstResponseTimeCalculated = false;
      if (
        messageData.sender_type === 'agent' &&
        messageData.direction === 'outbound' &&
        !conversation.first_response_time
      ) {
        const firstResponseTime = this.calculateInterval(conversation.created_at, message.timestamp);
        await this.conversationsRepo.update(conversationId, {
          first_response_time: firstResponseTime
        });
        firstResponseTimeCalculated = true;
        logger.info(`${operation}: calculated first_response_time`, {
          operation,
          conversationId,
          firstResponseTime
        });
      }

      const durationMs = Date.now() - startTime;
      logger.info(`${operation}: completed`, {
        operation,
        customerId,
        conversationId,
        messageId: message.id,
        durationMs,
        firstResponseTimeCalculated
      });

      return message;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error(`${operation}: failed`, {
        operation,
        customerId,
        conversationId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get a conversation with its messages
   */
  async getConversationWithMessages(
    customerId: string,
    conversationId: string,
    messageOptions: PaginationOptions = {}
  ): Promise<ConversationWithMessages> {
    const startTime = Date.now();
    const operation = 'ConversationService.getConversationWithMessages';
    
    try {
      logger.info(`${operation}: starting`, {
        operation,
        customerId,
        conversationId,
        messagePage: messageOptions.page,
        messageLimit: messageOptions.limit
      });

      // Validate conversation access and ownership
      const conversation = await this.validateConversationAccess(customerId, conversationId);

      // Get messages for the conversation
      const messagesResult = await this.messagesRepo.findByConversation(conversationId, messageOptions);
      const messages = messagesResult.data;

      // Get the latest message
      const latestMessage = await this.messagesRepo.getLatestMessage(conversationId);

      // Get active participants
      const participants = await this.participantsRepo.findActiveByConversation(conversationId);
      const participantCount = participants.length;

      const result: ConversationWithMessages = {
        ...conversation,
        messages,
        messageCount: messagesResult.totalCount,
        latestMessage,
        participants,
        participantCount
      };

      const durationMs = Date.now() - startTime;
      logger.info(`${operation}: completed`, {
        operation,
        customerId,
        conversationId,
        durationMs,
        messageCount: messagesResult.totalCount,
        participantCount
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error(`${operation}: failed`, {
        operation,
        customerId,
        conversationId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get conversations with summary information (including latest message preview)
   * Uses batch loading to fix N+1 query problem
   */
  async getConversationSummaries(
    customerId: string,
    filters: ConversationFilters = {},
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationSummary>> {
    const startTime = Date.now();
    const operation = 'ConversationService.getConversationSummaries';
    
    try {
      logger.info(`${operation}: starting`, {
        operation,
        customerId,
        filters,
        page: options.page,
        limit: options.limit
      });

      // Ensure customer_id is always in filters for security
      const secureFilters: ConversationFilters = {
        ...filters,
        customer_id: customerId
      };

      // Get conversations with filters
      const conversationsResult = await this.conversationsRepo.findWithFilters(secureFilters, options);
      const conversations = conversationsResult.data;

      if (conversations.length === 0) {
        const durationMs = Date.now() - startTime;
        logger.info(`${operation}: completed (no results)`, {
          operation,
          customerId,
          durationMs,
          resultCount: 0,
          totalCount: conversationsResult.totalCount
        });
        return {
          data: [],
          totalCount: conversationsResult.totalCount,
          page: conversationsResult.page,
          limit: conversationsResult.limit,
          totalPages: conversationsResult.totalPages
        };
      }

      // Enrich conversations with message counts and latest messages (fixes N+1 queries)
      const summaries = await this.enrichConversationsWithSummaries(conversations);

      const result: PaginatedResult<ConversationSummary> = {
        data: summaries,
        totalCount: conversationsResult.totalCount,
        page: conversationsResult.page,
        limit: conversationsResult.limit,
        totalPages: conversationsResult.totalPages
      };

      const durationMs = Date.now() - startTime;
      logger.info(`${operation}: completed`, {
        operation,
        customerId,
        durationMs,
        conversationCount: summaries.length,
        totalCount: result.totalCount,
        page: result.page,
        limit: result.limit
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error(`${operation}: failed`, {
        operation,
        customerId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        filters
      });
      throw error;
    }
  }

  /**
   * Search conversations with advanced filtering
   */
  async searchConversations(
    customerId: string,
    searchOptions: ConversationSearchOptions,
    paginationOptions: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationSummary>> {
    try {
      logger.info('ConversationService.searchConversations: starting operation', {
        customerId,
        searchOptions,
        paginationOptions
      });

      // Build conversation filters from search options, ensuring customer_id is always included
      const conversationFilters: ConversationFilters = {
        customer_id: customerId // CRITICAL: Always filter by customer for security
      };
      if (typeof searchOptions.agentId === "string") conversationFilters.agent_id = searchOptions.agentId;
      if (typeof searchOptions.userId === "string") conversationFilters.user_id = searchOptions.userId;
      if (typeof searchOptions.channel === "string") conversationFilters.channel = searchOptions.channel;
      if (typeof searchOptions.status === "string") conversationFilters.status = searchOptions.status;
      if (searchOptions.dateRange?.from) conversationFilters.created_after = searchOptions.dateRange.from;
      if (searchOptions.dateRange?.to) conversationFilters.created_before = searchOptions.dateRange.to;

      let summaries: ConversationSummary[] = [];

      if (searchOptions.query) {
        // Use full-text search in database (much faster than memory filtering)
        const conversationIds = await this.searchConversationsByMessageContent(
          customerId,
          searchOptions.query,
          conversationFilters,
          searchOptions.messageLimit || 10
        );

        if (conversationIds.length === 0) {
          return {
            data: [],
            totalCount: 0,
            page: paginationOptions.page || 1,
            limit: paginationOptions.limit || 50,
            totalPages: 0
          };
        }

        // Get conversations that match - filter by conversation IDs
        // Since Supabase doesn't support IN directly, we'll get all and filter
        const allConversationsResult = await this.conversationsRepo.findWithFilters(
          conversationFilters,
          { limit: 1000 }
        );

        // Filter to only include conversations with matching messages
        const matchingConversations = allConversationsResult.data.filter((c: Conversation) =>
          conversationIds.includes(c.id)
        );

        // Use batch loading for summaries
        if (matchingConversations.length > 0) {
          summaries = await this.enrichConversationsWithSummaries(matchingConversations);
        }
      } else {
        // No text query, just get summaries with batch loading
        const conversationsResultNoQuery = await this.conversationsRepo.findWithFilters(
          conversationFilters,
          paginationOptions
        );

        if (conversationsResultNoQuery.data.length === 0) {
          return {
            data: [],
            totalCount: conversationsResultNoQuery.totalCount,
            page: conversationsResultNoQuery.page,
            limit: conversationsResultNoQuery.limit,
            totalPages: conversationsResultNoQuery.totalPages
          };
        }

        // Enrich conversations with summaries using batch loading
        summaries = await this.enrichConversationsWithSummaries(conversationsResultNoQuery.data);

        // For non-query path, pagination is already handled by repository
        const result: PaginatedResult<ConversationSummary> = {
          data: summaries,
          totalCount: conversationsResultNoQuery.totalCount,
          page: conversationsResultNoQuery.page,
          limit: conversationsResultNoQuery.limit,
          totalPages: conversationsResultNoQuery.totalPages
        };

        logger.info('ConversationService.searchConversations: operation completed', {
          customerId,
          resultCount: summaries.length,
          totalCount: result.totalCount,
          hasQuery: false
        });

        return result;
      }

      // For query path, calculate pagination from summaries
      const page = paginationOptions.page || 1;
      const limit = paginationOptions.limit || 50;
      const totalCount = summaries.length;
      const totalPages = Math.ceil(totalCount / limit);

      const result: PaginatedResult<ConversationSummary> = {
        data: summaries.slice((page - 1) * limit, page * limit), // Apply pagination to summaries
        totalCount,
        page,
        limit,
        totalPages
      };

      logger.info('ConversationService.searchConversations: operation completed', {
        customerId,
        resultCount: summaries.length,
        totalCount: result.totalCount,
        hasQuery: !!searchOptions.query
      });

      return result;
    } catch (error) {
      logger.error('ConversationService.searchConversations: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        searchOptions
      });
      throw error;
    }
  }

  /**
   * Update conversation status
   */
  async updateConversationStatus(
    customerId: string,
    conversationId: string,
    status: string
  ): Promise<Conversation> {
    try {
      logger.info('ConversationService.updateConversationStatus: starting operation', {
        customerId,
        conversationId,
        status
      });

      // Validate conversation access and ownership
      await this.validateConversationAccess(customerId, conversationId);

      const conversation = await this.conversationsRepo.updateStatus(conversationId, status);

      logger.info('ConversationService.updateConversationStatus: operation completed', {
        customerId,
        conversationId,
        status
      });

      return conversation;
    } catch (error) {
      logger.error('ConversationService.updateConversationStatus: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId,
        status
      });
      throw error;
    }
  }

  /**
   * Update conversation state
   */
  async updateConversationState(
    customerId: string,
    conversationId: string,
    state: Record<string, any>
  ): Promise<Conversation> {
    try {
      logger.info('ConversationService.updateConversationState: starting operation', {
        customerId,
        conversationId,
        stateKeys: Object.keys(state)
      });

      // Validate conversation access and ownership
      await this.validateConversationAccess(customerId, conversationId);

      const conversation = await this.conversationsRepo.updateState(conversationId, state);

      logger.info('ConversationService.updateConversationState: operation completed', {
        customerId,
        conversationId
      });

      return conversation;
    } catch (error) {
      logger.error('ConversationService.updateConversationState: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(customerId: string, conversationId: string): Promise<{
    conversationDeleted: boolean;
    messagesDeleted: number;
  }> {
    try {
      logger.info('ConversationService.deleteConversation: starting operation', {
        customerId,
        conversationId
      });

      // Validate conversation access and ownership
      await this.validateConversationAccess(customerId, conversationId);

      // Delete all messages first
      const messagesDeleted = await this.messagesRepo.deleteByConversation(conversationId);

      // Delete all participants
      await this.participantsRepo.deleteByConversation(conversationId);

      // Delete the conversation
      const conversationDeleted = await this.conversationsRepo.delete(conversationId);

      const result = {
        conversationDeleted,
        messagesDeleted
      };

      logger.info('ConversationService.deleteConversation: operation completed', {
        customerId,
        conversationId,
        ...result
      });

      return result;
    } catch (error) {
      logger.error('ConversationService.deleteConversation: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Get comprehensive conversation statistics
   */
  async getConversationStats(agentId?: string): Promise<ConversationStats> {
    try {
      logger.info('ConversationService.getConversationStats: starting operation', {
        agentId
      });

      // Get conversation stats
      const conversationStats = await this.conversationsRepo.getConversationStats(agentId);

      // Get message stats
      const messageStats = await this.messagesRepo.getMessageStats();

      // Calculate additional metrics
      const averageMessagesPerConversation = conversationStats.total > 0 
        ? messageStats.total / conversationStats.total 
        : 0;

      // Get recent activity (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentConversations = await this.conversationsRepo.findWithFilters({
        created_after: oneDayAgo
      }, { limit: 1000 });

      const recentMessages = await this.messagesRepo.findWithFilters({
        timestamp_after: oneDayAgo
      }, { limit: 1000 });

      const recentActivity = {
        conversationsCreated: recentConversations.totalCount,
        messagesSent: recentMessages.totalCount,
        lastActivity:
          recentMessages.data && recentMessages.data.length > 0 && recentMessages.data[0]
            ? recentMessages.data[0].timestamp
            : new Date().toISOString()
      };

      const result: ConversationStats = {
        totalConversations: conversationStats.total,
        activeConversations: conversationStats.active,
        completedConversations: conversationStats.completed,
        totalMessages: messageStats.total,
        averageMessagesPerConversation: Math.round(averageMessagesPerConversation * 100) / 100,
        conversationsByChannel: conversationStats.byChannel,
        conversationsByStatus: conversationStats.byStatus,
        messagesByDirection: messageStats.byDirection,
        messagesByType: messageStats.byType,
        recentActivity
      };

      logger.info('ConversationService.getConversationStats: operation completed', {
        agentId,
        totalConversations: result.totalConversations,
        totalMessages: result.totalMessages
      });

      return result;
    } catch (error) {
      logger.error('ConversationService.getConversationStats: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        agentId
      });
      throw error;
    }
  }

  /**
   * Get conversations by agent with pagination
   * Uses batch loading to fix N+1 query problem
   */
  async getConversationsByAgent(
    customerId: string,
    agentId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationSummary>> {
    try {
      logger.info('ConversationService.getConversationsByAgent: starting operation', {
        customerId,
        agentId,
        page: options.page,
        limit: options.limit
      });

      // Filter by customer_id AND agent_id for security
      const conversationsResult = await this.conversationsRepo.findWithFilters(
        { customer_id: customerId, agent_id: agentId },
        options
      );

      if (conversationsResult.data.length === 0) {
        return {
          data: [],
          totalCount: conversationsResult.totalCount,
          page: conversationsResult.page,
          limit: conversationsResult.limit,
          totalPages: conversationsResult.totalPages
        };
      }

      // Enrich conversations with summaries using batch loading
      const summaries = await this.enrichConversationsWithSummaries(conversationsResult.data);

      const result: PaginatedResult<ConversationSummary> = {
        data: summaries,
        totalCount: conversationsResult.totalCount,
        page: conversationsResult.page,
        limit: conversationsResult.limit,
        totalPages: conversationsResult.totalPages
      };

      logger.info('ConversationService.getConversationsByAgent: operation completed', {
        customerId,
        agentId,
        conversationCount: summaries.length,
        totalCount: result.totalCount
      });

      return result;
    } catch (error) {
      logger.error('ConversationService.getConversationsByAgent: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Get conversations by user with pagination
   * Uses batch loading to fix N+1 query problem
   */
  async getConversationsByUser(
    customerId: string,
    userId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationSummary>> {
    try {
      logger.info('ConversationService.getConversationsByUser: starting operation', {
        customerId,
        userId,
        page: options.page,
        limit: options.limit
      });

      // Filter by customer_id AND user_id for security
      const conversationsResult = await this.conversationsRepo.findWithFilters(
        { customer_id: customerId, user_id: userId },
        options
      );

      if (conversationsResult.data.length === 0) {
        return {
          data: [],
          totalCount: conversationsResult.totalCount,
          page: conversationsResult.page,
          limit: conversationsResult.limit,
          totalPages: conversationsResult.totalPages
        };
      }

      // Enrich conversations with summaries using batch loading
      const summaries = await this.enrichConversationsWithSummaries(conversationsResult.data);

      const result: PaginatedResult<ConversationSummary> = {
        data: summaries,
        totalCount: conversationsResult.totalCount,
        page: conversationsResult.page,
        limit: conversationsResult.limit,
        totalPages: conversationsResult.totalPages
      };

      logger.info('ConversationService.getConversationsByUser: operation completed', {
        customerId,
        userId,
        conversationCount: summaries.length,
        totalCount: result.totalCount
      });

      return result;
    } catch (error) {
      logger.error('ConversationService.getConversationsByUser: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        userId
      });
      throw error;
    }
  }

  /**
   * Private helper method to search conversations by message content
   * Uses database full-text search instead of memory filtering
   */
  private async searchConversationsByMessageContent(
    customerId: string,
    query: string,
    conversationFilters: ConversationFilters,
    messageLimit: number
  ): Promise<string[]> {
    // First get all conversation IDs for this customer
    const conversationsResult = await this.conversationsRepo.findWithFilters(
      conversationFilters,
      { limit: 1000 }
    );

    if (conversationsResult.data.length === 0) {
      return [];
    }

    const conversationIds = conversationsResult.data.map((c: Conversation) => c.id);

    // Use full-text search to find matching messages
    const messagesResult = await this.messagesRepo.fullTextSearch(
      customerId,
      query,
      conversationIds,
      { limit: 1000 }
    );

    // Extract unique conversation IDs from matching messages
    const matchingConversationIds = Array.from(
      new Set(messagesResult.data.map((m: Message) => m.conversation_id))
    );

    return matchingConversationIds;
  }

  /**
   * Add a participant to a conversation
   */
  async addParticipant(
    customerId: string,
    conversationId: string,
    participantData: Omit<CreateConversationParticipantData, 'conversation_id' | 'customer_id'>
  ): Promise<ConversationParticipant> {
    try {
      logger.info('ConversationService.addParticipant: starting operation', {
        customerId,
        conversationId,
        agentId: participantData.agent_id,
        role: participantData.role
      });

      // Validate conversation access and ownership
      const conversation = await this.validateConversationAccess(customerId, conversationId);

      // Note: participantData doesn't include customer_id after Omit
      // We'll validate using the provided customerId parameter
      // In a real system, you'd look up the agent's customer_id from an agents table
      // For now, we assume the caller provided the correct customerId

      // Check if participant already exists
      const existing = await this.participantsRepo.findByConversationAndAgent(
        conversationId,
        participantData.agent_id
      );

      if (existing) {
        // If exists but inactive, reactivate them
        if (!existing.is_active) {
          const updated = await this.participantsRepo.updateParticipant(
            conversationId,
            participantData.agent_id,
            {
              is_active: true,
              role: participantData.role,
              left_at: null
            }
          );
          logger.info('ConversationService.addParticipant: reactivated participant', {
            conversationId,
            agentId: participantData.agent_id
          });
          return updated;
        }
        // If already active, just update role if different
        if (existing.role !== participantData.role) {
          return await this.participantsRepo.updateParticipant(
            conversationId,
            participantData.agent_id,
            { role: participantData.role }
          );
        }
        return existing;
      }

      // Create new participant (ensure customer_id matches conversation)
      const participant = await this.participantsRepo.create({
        conversation_id: conversationId,
        customer_id: conversation.customer_id, // Use conversation's customer_id for security
        ...participantData
      });

      logger.info('ConversationService.addParticipant: operation completed', {
        customerId,
        conversationId,
        agentId: participantData.agent_id,
        role: participantData.role
      });

      return participant;
    } catch (error) {
      logger.error('ConversationService.addParticipant: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId,
        agentId: participantData.agent_id
      });
      throw error;
    }
  }

  /**
   * Remove a participant from a conversation (marks as inactive)
   */
  async removeParticipant(
    customerId: string,
    conversationId: string,
    agentId: string
  ): Promise<ConversationParticipant> {
    try {
      logger.info('ConversationService.removeParticipant: starting operation', {
        customerId,
        conversationId,
        agentId
      });

      // Validate conversation access and ownership
      await this.validateConversationAccess(customerId, conversationId);

      const participant = await this.participantsRepo.removeParticipant(conversationId, agentId);

      logger.info('ConversationService.removeParticipant: operation completed', {
        customerId,
        conversationId,
        agentId
      });

      return participant;
    } catch (error) {
      logger.error('ConversationService.removeParticipant: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Get all participants for a conversation
   */
  async getConversationParticipants(
    customerId: string,
    conversationId: string,
    activeOnly: boolean = false
  ): Promise<ConversationParticipant[]> {
    try {
      logger.info('ConversationService.getConversationParticipants: starting operation', {
        customerId,
        conversationId,
        activeOnly
      });

      // Validate conversation access and ownership
      await this.validateConversationAccess(customerId, conversationId);

      if (activeOnly) {
        const participants = await this.participantsRepo.findActiveByConversation(conversationId);
        return participants;
      }

      const result = await this.participantsRepo.findByConversation(conversationId, { limit: 100 });
      return result.data;
    } catch (error) {
      logger.error('ConversationService.getConversationParticipants: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Hand off conversation from one agent to another
   * NOTE: Implements compensating actions for transaction safety
   */
  async handoffConversation(
    customerId: string,
    conversationId: string,
    fromAgentId: string,
    toAgentId: string,
    toAgentCustomerId: string,
    newOwnerRole: string = 'owner'
  ): Promise<{
    conversation: Conversation;
    oldOwner: ConversationParticipant;
    newOwner: ConversationParticipant;
  }> {
    let newOwnerCreated = false;

    try {
      logger.info('ConversationService.handoffConversation: starting operation', {
        customerId,
        conversationId,
        fromAgentId,
        toAgentId
      });

      // Validate conversation access and ownership
      const conversation = await this.validateConversationAccess(customerId, conversationId);

      // Validate new agent belongs to same customer
      await this.validateParticipantCustomer(
        toAgentId,
        toAgentCustomerId,
        conversation.customer_id
      );

      // Step 1: Remove old owner (mark as inactive and set left_at)
      const oldOwner = await this.participantsRepo.findByConversationAndAgent(
        conversationId,
        fromAgentId
      );

      if (!oldOwner) {
        throw new ParticipantNotFoundError(conversationId, fromAgentId);
      }

      await this.participantsRepo.updateParticipant(conversationId, fromAgentId, {
        is_active: false,
        left_at: new Date().toISOString()
      });

      try {
        // Step 2: Add or update new owner
        const newOwnerData: CreateConversationParticipantData = {
          conversation_id: conversationId,
          customer_id: conversation.customer_id,
          agent_id: toAgentId,
          role: newOwnerRole,
          is_active: true
        };

        let newOwner: ConversationParticipant;
        const existing = await this.participantsRepo.findByConversationAndAgent(
          conversationId,
          toAgentId
        );

        if (existing) {
          newOwner = await this.participantsRepo.updateParticipant(conversationId, toAgentId, {
            role: newOwnerRole,
            is_active: true,
            left_at: null
          });
        } else {
          newOwner = await this.participantsRepo.create(newOwnerData);
          newOwnerCreated = true;
        }

        try {
          // Step 3: Update conversation's agent_id to the new owner
          const updatedConversation = await this.conversationsRepo.update(conversationId, {
            agent_id: toAgentId
          });

          logger.info('ConversationService.handoffConversation: operation completed', {
            customerId,
            conversationId,
            fromAgentId,
            toAgentId
          });

          return {
            conversation: updatedConversation,
            oldOwner: oldOwner,
            newOwner
          };
        } catch (updateError) {
          // Rollback: Restore old owner if conversation update fails
          logger.error('ConversationService.handoffConversation: conversation update failed, rolling back', {
            error: updateError instanceof Error ? updateError.message : String(updateError),
            conversationId
          });

          try {
            // Restore old owner
            await this.participantsRepo.updateParticipant(conversationId, fromAgentId, {
              is_active: true,
              left_at: null
            });

            // Remove new owner if it was newly created
            if (newOwnerCreated) {
              await this.participantsRepo.deleteParticipant(conversationId, toAgentId);
            }
          } catch (rollbackError) {
            logger.error('ConversationService.handoffConversation: failed to rollback participants', {
              error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
            });
          }

          throw updateError;
        }
      } catch (newOwnerError) {
        // Rollback: Restore old owner if new owner creation/update fails
        logger.error('ConversationService.handoffConversation: new owner creation failed, rolling back', {
          error: newOwnerError instanceof Error ? newOwnerError.message : String(newOwnerError),
          conversationId
        });

        try {
          await this.participantsRepo.updateParticipant(conversationId, fromAgentId, {
            is_active: true,
            left_at: null
          });
        } catch (rollbackError) {
          logger.error('ConversationService.handoffConversation: failed to rollback old owner', {
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }

        throw newOwnerError;
      }
    } catch (error) {
      logger.error('ConversationService.handoffConversation: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId,
        fromAgentId,
        toAgentId
      });
      throw error;
    }
  }

  /**
   * Get conversations by customer (tenant) - important for multi-tenancy
   * Uses batch loading to fix N+1 query problem
   */
  async getConversationsByCustomer(
    customerId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationSummary>> {
    try {
      logger.info('ConversationService.getConversationsByCustomer: starting operation', {
        customerId,
        page: options.page,
        limit: options.limit
      });

      const conversationsResult = await this.conversationsRepo.findByCustomer(customerId, options);

      if (conversationsResult.data.length === 0) {
        return {
          data: [],
          totalCount: conversationsResult.totalCount,
          page: conversationsResult.page,
          limit: conversationsResult.limit,
          totalPages: conversationsResult.totalPages
        };
      }

      // Enrich conversations with summaries using batch loading (fixes N+1 queries)
      const summaries = await this.enrichConversationsWithSummaries(conversationsResult.data);

      const result: PaginatedResult<ConversationSummary> = {
        data: summaries,
        totalCount: conversationsResult.totalCount,
        page: conversationsResult.page,
        limit: conversationsResult.limit,
        totalPages: conversationsResult.totalPages
      };

      logger.info('ConversationService.getConversationsByCustomer: operation completed', {
        customerId,
        conversationCount: summaries.length,
        totalCount: result.totalCount
      });

      return result;
    } catch (error) {
      logger.error('ConversationService.getConversationsByCustomer: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId
      });
      throw error;
    }
  }

  /**
   * Private helper method to create a message preview
   * Fixed null handling for migration period
   */
  private createMessagePreview(message: Message): string {
    try {
      // Prefer content field (new schema) - check explicitly for null/undefined
      if (message.content !== null && message.content !== undefined && message.content !== '') {
        return String(message.content).substring(0, 100);
      }

      // Fallback to payload (legacy/structured data)
      const payload = message.payload;
      if (typeof payload === 'object' && payload !== null) {
        // Try to extract text content from common message types
        if (payload.text) {
          return String(payload.text).substring(0, 100);
        }
        if (payload.content) {
          return String(payload.content).substring(0, 100);
        }
        if (payload.message) {
          return String(payload.message).substring(0, 100);
        }
        // Fallback to JSON string
        return JSON.stringify(payload).substring(0, 100);
      }
      if (payload) {
        return String(payload).substring(0, 100);
      }

      return '[Message preview unavailable]';
    } catch (error) {
      return '[Message preview unavailable]';
    }
  }

  /**
   * Mark message as delivered
   */
  async markMessageDelivered(
    customerId: string,
    messageId: string,
    deliveredAt?: string
  ): Promise<Message> {
    try {
      logger.info('ConversationService.markMessageDelivered: starting operation', {
        customerId,
        messageId
      });

      // Get message to verify it exists
      const message = await this.messagesRepo.findById(messageId);
      if (!message) {
        throw new MessageNotFoundError(messageId);
      }

      // Validate message belongs to customer's conversation
      await this.validateConversationAccess(customerId, message.conversation_id);

      // Now safe to update
      const updated = await this.messagesRepo.updateDeliveryStatus(
        messageId,
        'delivered',
        deliveredAt
      );

      logger.info('ConversationService.markMessageDelivered: operation completed', {
        customerId,
        messageId,
        conversationId: message.conversation_id
      });

      return updated;
    } catch (error) {
      logger.error('ConversationService.markMessageDelivered: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        messageId
      });
      throw error;
    }
  }

  /**
   * Mark message as read
   */
  async markMessageRead(
    customerId: string,
    messageId: string,
    readAt?: string
  ): Promise<Message> {
    try {
      logger.info('ConversationService.markMessageRead: starting operation', {
        customerId,
        messageId
      });

      // Get message to verify it exists
      const message = await this.messagesRepo.findById(messageId);
      if (!message) {
        throw new MessageNotFoundError(messageId);
      }

      // Validate message belongs to customer's conversation
      await this.validateConversationAccess(customerId, message.conversation_id);

      // Now safe to update
      const updated = await this.messagesRepo.markAsRead(messageId, readAt);

      logger.info('ConversationService.markMessageRead: operation completed', {
        customerId,
        messageId,
        conversationId: message.conversation_id
      });

      return updated;
    } catch (error) {
      logger.error('ConversationService.markMessageRead: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        messageId
      });
      throw error;
    }
  }

  /**
   * Update conversation subjects
   */
  async updateConversationSubjects(
    customerId: string,
    conversationId: string,
    subjects: Record<string, any>
  ): Promise<Conversation> {
    try {
      logger.info('ConversationService.updateConversationSubjects: starting operation', {
        customerId,
        conversationId,
        subjectKeys: Object.keys(subjects)
      });

      await this.validateConversationAccess(customerId, conversationId);

      const conversation = await this.conversationsRepo.update(conversationId, {
        subjects
      });

      logger.info('ConversationService.updateConversationSubjects: operation completed', {
        customerId,
        conversationId
      });

      return conversation;
    } catch (error) {
      logger.error('ConversationService.updateConversationSubjects: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Add tags to conversation
   */
  async addConversationTags(
    customerId: string,
    conversationId: string,
    tags: string[]
  ): Promise<Conversation> {
    try {
      logger.info('ConversationService.addConversationTags: starting operation', {
        customerId,
        conversationId,
        tags
      });

      // Validate input
      if (!tags || !Array.isArray(tags) || tags.length === 0) {
        throw new ConversationValidationError('Tags array cannot be empty', 'tags');
      }

      // Validate and sanitize tags
      const validTags = tags
        .filter(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.trim().length <= 50)
        .map(tag => tag.trim())
        .filter((tag, index, self) => self.indexOf(tag) === index); // Remove duplicates

      if (validTags.length === 0) {
        throw new ConversationValidationError('No valid tags provided. Tags must be non-empty strings with max 50 characters', 'tags');
      }

      const conversation = await this.validateConversationAccess(customerId, conversationId);

      const existingTags = conversation.tags || [];
      const newTags = Array.from(new Set([...existingTags, ...validTags])); // Remove duplicates

      const updated = await this.conversationsRepo.update(conversationId, {
        tags: newTags
      });

      logger.info('ConversationService.addConversationTags: operation completed', {
        customerId,
        conversationId,
        tagCount: newTags.length,
        addedTags: validTags
      });

      return updated;
    } catch (error) {
      logger.error('ConversationService.addConversationTags: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Remove tags from conversation
   */
  async removeConversationTags(
    customerId: string,
    conversationId: string,
    tagsToRemove: string[]
  ): Promise<Conversation> {
    try {
      logger.info('ConversationService.removeConversationTags: starting operation', {
        customerId,
        conversationId,
        tagsToRemove
      });

      // Validate input
      if (!tagsToRemove || !Array.isArray(tagsToRemove) || tagsToRemove.length === 0) {
        throw new ConversationValidationError('Tags to remove array cannot be empty', 'tagsToRemove');
      }

      const conversation = await this.validateConversationAccess(customerId, conversationId);

      const existingTags = conversation.tags || [];
      const remainingTags = existingTags.filter(tag => !tagsToRemove.includes(tag));

      const updated = await this.conversationsRepo.update(conversationId, {
        tags: remainingTags.length > 0 ? remainingTags : null
      });

      logger.info('ConversationService.removeConversationTags: operation completed', {
        customerId,
        conversationId,
        remainingTagCount: remainingTags.length
      });

      return updated;
    } catch (error) {
      logger.error('ConversationService.removeConversationTags: operation failed', {
        error: error instanceof Error ? error.message : String(error),
        customerId,
        conversationId
      });
      throw error;
    }
  }
}

export default new ConversationService();
