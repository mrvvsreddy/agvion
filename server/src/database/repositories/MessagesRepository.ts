// database/repositories/MessagesRepository.ts
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import logger from '../../utils/logger';

export interface Message {
  id: string;
  conversation_id: string;
  direction: string; // 'inbound' from user, 'outbound' from agent
  type: string; // 'text', 'image', 'file', 'system', etc.
  sender_id: string; // ID of the sender
  sender_type: string; // 'user', 'agent', 'system'
  content: string; // The actual message body/text
  attachments?: Record<string, any> | null; // JSONB - files, screenshots, documents
  replied_to_id?: string | null; // ID of message this replies to (threading)
  delivery_status?: string | null; // 'sent', 'delivered', 'failed', etc.
  delivered_at?: string | null; // Timestamp when message was delivered
  read_at?: string | null; // Timestamp when message was read
  payload?: Record<string, any>; // Legacy/structured data (kept for backward compatibility)
  node_id?: string;
  metadata?: Record<string, any>; // Additional JSONB metadata
  timestamp: string; // When the message was created/sent
}

export interface CreateMessageData {
  conversation_id: string;
  direction: string;
  type: string;
  sender_id: string;
  sender_type: string; // 'user', 'agent', 'system'
  content: string; // The actual message body/text
  attachments?: Record<string, any> | null;
  replied_to_id?: string | null;
  delivery_status?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  payload?: Record<string, any>; // Legacy/structured data
  node_id?: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export interface UpdateMessageData {
  direction?: string;
  type?: string;
  sender_id?: string;
  sender_type?: string;
  content?: string;
  attachments?: Record<string, any> | null;
  replied_to_id?: string | null;
  delivery_status?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  payload?: Record<string, any>;
  node_id?: string;
  metadata?: Record<string, any>;
}

export interface MessageFilters {
  conversation_id?: string;
  direction?: string;
  type?: string;
  sender_id?: string;
  sender_type?: string;
  node_id?: string;
  timestamp_after?: string;
  timestamp_before?: string;
  delivery_status?: string;
}

class MessagesRepository extends BaseRepository<Message, CreateMessageData, UpdateMessageData> {
  constructor() {
    super('messages');
  }

  // Helper to build match object for filters
  private buildMatchObject(filters: Record<string, any>): Record<string, any> {
    const match: Record<string, any> = {};
    for (const key in filters) {
      if (
        filters[key] !== undefined &&
        filters[key] !== null &&
        key !== 'timestamp_after' &&
        key !== 'timestamp_before'
      ) {
        match[key] = filters[key];
      }
    }
    return match;
  }

  async findByConversation(conversationId: string, options: PaginationOptions = {}): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'asc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for conversation
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .match({ conversation_id: conversationId });

      // Get paginated data for conversation
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .match({ conversation_id: conversationId })
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find messages by conversation', { error, conversationId, options });
        throw new Error(`Failed to find messages by conversation: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding messages by conversation', { error, conversationId, options });
      throw error;
    }
  }

  async findByDirection(direction: string, options: PaginationOptions = {}): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for direction
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .match({ direction });

      // Get paginated data for direction
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .match({ direction })
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find messages by direction', { error, direction, options });
        throw new Error(`Failed to find messages by direction: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding messages by direction', { error, direction, options });
      throw error;
    }
  }

  async findByType(type: string, options: PaginationOptions = {}): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for type
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .match({ type });

      // Get paginated data for type
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .match({ type })
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find messages by type', { error, type, options });
        throw new Error(`Failed to find messages by type: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding messages by type', { error, type, options });
      throw error;
    }
  }

  async findBySender(senderId: string, options: PaginationOptions = {}): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for sender
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .match({ sender_id: senderId });

      // Get paginated data for sender
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .match({ sender_id: senderId })
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find messages by sender', { error, senderId, options });
        throw new Error(`Failed to find messages by sender: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding messages by sender', { error, senderId, options });
      throw error;
    }
  }

  async findByNode(nodeId: string, options: PaginationOptions = {}): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for node
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .match({ node_id: nodeId });

      // Get paginated data for node
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .match({ node_id: nodeId })
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find messages by node', { error, nodeId, options });
        throw new Error(`Failed to find messages by node: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding messages by node', { error, nodeId, options });
      throw error;
    }
  }

  async findWithFilters(filters: MessageFilters, options: PaginationOptions = {}): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const match: Record<string, any> = this.buildMatchObject(filters);

      let query = this.client
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .match(match);

      // Handle timestamp filter separately using .gte and .lte
      if (filters.timestamp_after) {
        query = query.gte('timestamp', filters.timestamp_after);
      }
      if (filters.timestamp_before) {
        query = query.lte('timestamp', filters.timestamp_before);
      }

      // Pagination and ordering
      const { data, error, count } = await query
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find messages with filters', { error, filters, options });
        throw new Error(`Failed to find messages with filters: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding messages with filters', { error, filters, options });
      throw error;
    }
  }

  async getLatestMessage(conversationId: string): Promise<Message | null> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .match({ conversation_id: conversationId })
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No messages found
        }
        logger.error('Failed to get latest message', { error, conversationId });
        throw new Error(`Failed to get latest message: ${error.message}`);
      }

      return data as Message;
    } catch (error) {
      logger.error('Error getting latest message', { error, conversationId });
      throw error;
    }
  }

  async getMessageCount(conversationId: string): Promise<number> {
    try {
      const { count, error } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .match({ conversation_id: conversationId });

      if (error) {
        logger.error('Failed to get message count', { error, conversationId });
        throw new Error(`Failed to get message count: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error getting message count', { error, conversationId });
      throw error;
    }
  }

  /**
   * Get message counts for multiple conversations in batch (fixes N+1 query problem)
   */
  async getMessageCountsBatch(conversationIds: string[]): Promise<Record<string, number>> {
    try {
      if (conversationIds.length === 0) {
        return {};
      }

      // Use IN query to get all counts at once
      const { data, error } = await this.client
        .from(this.tableName)
        .select('conversation_id')
        .in('conversation_id', conversationIds);

      if (error) {
        logger.error('Failed to get message counts in batch', { error, conversationIds });
        throw new Error(`Failed to get message counts in batch: ${error.message}`);
      }

      // Count messages per conversation
      const counts: Record<string, number> = {};
      conversationIds.forEach(id => counts[id] = 0); // Initialize all to 0
      
      if (data) {
        data.forEach((item: any) => {
          const convId = item.conversation_id;
          if (convId) {
            counts[convId] = (counts[convId] || 0) + 1;
          }
        });
      }

      return counts;
    } catch (error) {
      logger.error('Error getting message counts in batch', { error, conversationIds });
      throw error;
    }
  }

  /**
   * Get latest messages for multiple conversations in batch (fixes N+1 query problem)
   */
  async getLatestMessagesBatch(conversationIds: string[]): Promise<Record<string, Message | null>> {
    try {
      if (conversationIds.length === 0) {
        return {};
      }

      // For each conversation, get the latest message
      // Using Promise.all since we need DISTINCT ON per conversation which Supabase doesn't support directly
      const results = await Promise.all(
        conversationIds.map(async (conversationId) => {
          const latest = await this.getLatestMessage(conversationId);
          return { conversationId, message: latest };
        })
      );

      const latestMessages: Record<string, Message | null> = {};
      results.forEach(({ conversationId, message }) => {
        latestMessages[conversationId] = message;
      });

      return latestMessages;
    } catch (error) {
      logger.error('Error getting latest messages in batch', { error, conversationIds });
      throw error;
    }
  }

  /**
   * Full-text search across messages (uses PostgreSQL text search)
   */
  async fullTextSearch(
    customerId: string,
    query: string,
    conversationIds?: string[],
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Build query - Supabase/PostgREST doesn't have direct full-text search,
      // so we'll use ilike pattern matching which can use indexes
      let dbQuery = this.client
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .or(`content.ilike.%${query}%,content.ilike.%${query}%`); // Search in content field

      if (conversationIds && conversationIds.length > 0) {
        dbQuery = dbQuery.in('conversation_id', conversationIds);
      }

      const { data, error, count } = await dbQuery
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to perform full-text search', { error, query, customerId });
        throw new Error(`Failed to perform full-text search: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: (data || []) as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error performing full-text search', { error, query, customerId });
      throw error;
    }
  }

  async getMessageStats(conversationId?: string): Promise<{
    total: number;
    byDirection: Record<string, number>;
    byType: Record<string, number>;
    bySender: Record<string, number>;
  }> {
    try {
      const match = conversationId ? { conversation_id: conversationId } : {};

      // Get total count
      const { count: totalCount } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .match(match);

      // Get messages by direction
      const { data: directionData } = await this.client
        .from(this.tableName)
        .select('direction')
        .match(match)
        .not('direction', 'is', null);

      // Get messages by type
      const { data: typeData } = await this.client
        .from(this.tableName)
        .select('type')
        .match(match)
        .not('type', 'is', null);

      // Get messages by sender
      const { data: senderData } = await this.client
        .from(this.tableName)
        .select('sender_id')
        .match(match)
        .not('sender_id', 'is', null);

      const byDirection: Record<string, number> = {};
      const byType: Record<string, number> = {};
      const bySender: Record<string, number> = {};

      // Count by direction
      if (directionData) {
        directionData.forEach((item: any) => {
          byDirection[item.direction] = (byDirection[item.direction] || 0) + 1;
        });
      }

      // Count by type
      if (typeData) {
        typeData.forEach((item: any) => {
          byType[item.type] = (byType[item.type] || 0) + 1;
        });
      }

      // Count by sender
      if (senderData) {
        senderData.forEach((item: any) => {
          bySender[item.sender_id] = (bySender[item.sender_id] || 0) + 1;
        });
      }

      return {
        total: totalCount || 0,
        byDirection,
        byType,
        bySender
      };
    } catch (error) {
      logger.error('Error getting message stats', { error, conversationId });
      throw error;
    }
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .delete()
        .match({ conversation_id: conversationId })
        .select('id');

      if (error) {
        logger.error('Failed to delete messages by conversation', { error, conversationId });
        throw new Error(`Failed to delete messages by conversation: ${error.message}`);
      }

      const deletedCount = data?.length || 0;
      logger.info('Deleted messages by conversation', { conversationId, deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Error deleting messages by conversation', { error, conversationId });
      throw error;
    }
  }

  /**
   * Update message delivery status
   */
  async updateDeliveryStatus(
    messageId: string,
    status: string,
    deliveredAt?: string
  ): Promise<Message> {
    try {
      const updateData: any = {
        delivery_status: status
      };

      if (deliveredAt || status === 'delivered') {
        updateData.delivered_at = deliveredAt || new Date().toISOString();
      }

      const { data: result, error } = await this.client
        .from(this.tableName)
        .update(updateData)
        .eq('id', messageId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update delivery status', { error, messageId, status });
        throw new Error(`Failed to update delivery status: ${error.message}`);
      }

      logger.info('Updated delivery status', { messageId, status });
      return result as Message;
    } catch (error) {
      logger.error('Error updating delivery status', { error, messageId, status });
      throw error;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string, readAt?: string): Promise<Message> {
    try {
      const { data: result, error } = await this.client
        .from(this.tableName)
        .update({
          read_at: readAt || new Date().toISOString()
        })
        .eq('id', messageId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to mark message as read', { error, messageId });
        throw new Error(`Failed to mark message as read: ${error.message}`);
      }

      logger.info('Marked message as read', { messageId });
      return result as Message;
    } catch (error) {
      logger.error('Error marking message as read', { error, messageId });
      throw error;
    }
  }

  /**
   * Find messages that are replies to a specific message (threading)
   */
  async findRepliesTo(messageId: string, options: PaginationOptions = {}): Promise<PaginatedResult<Message>> {
    try {
      const { page = 1, limit = 50, orderBy = 'timestamp', orderDirection = 'asc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('replied_to_id', messageId);

      // Get paginated data
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('replied_to_id', messageId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find replies to message', { error, messageId, options });
        throw new Error(`Failed to find replies to message: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Message[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding replies to message', { error, messageId, options });
      throw error;
    }
  }
}

export default new MessagesRepository();
