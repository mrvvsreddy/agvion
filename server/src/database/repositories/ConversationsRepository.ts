// path: database/repositories/ConversationsRepository.ts
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import logger from '../../utils/logger';

export interface Conversation {
  id: string;
  agent_id: string;
  user_id: string;
  channel: string;
  customer_id: string; // Tenant/company ID for multi-tenancy
  subjects?: Record<string, any> | null; // JSONB - topics/subjects related to conversation
  tags?: string[] | null; // Array of text - labels like "billing", "urgent", "bug"
  first_response_time?: string | null; // Interval - duration between creation and first agent response
  state: Record<string, any>;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

export interface CreateConversationData {
  agent_id: string;
  user_id: string;
  channel: string;
  customer_id: string; // Required for multi-tenancy
  subjects?: Record<string, any> | null;
  tags?: string[] | null;
  state?: Record<string, any>;
  status?: string;
}

export interface UpdateConversationData {
  agent_id?: string;
  user_id?: string;
  channel?: string;
  customer_id?: string;
  subjects?: Record<string, any> | null;
  tags?: string[] | null;
  first_response_time?: string | null;
  state?: Record<string, any>;
  status?: string;
  last_message_at?: string;
}

export interface ConversationFilters {
  agent_id?: string;
  user_id?: string;
  channel?: string;
  customer_id?: string; // Filter by tenant/company
  status?: string;
  created_after?: string;
  created_before?: string;
}

class ConversationsRepository extends BaseRepository<Conversation, CreateConversationData, UpdateConversationData> {
  constructor() {
    super('conversations');
  }

  /**
   * Find conversations by customer (tenant) - important for multi-tenancy
   */
  async findByCustomer(
    customerId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<Conversation>> {
    try {
      const { page = 1, limit = 50, orderBy = 'last_message_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for customer
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', customerId);

      // Get paginated data for customer
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('customer_id', customerId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find conversations by customer', { error, customerId, options });
        throw new Error(`Failed to find conversations by customer: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Conversation[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding conversations by customer', { error, customerId, options });
      throw error;
    }
  }

  async findByAgent(agentId: string, options: PaginationOptions = {}): Promise<PaginatedResult<Conversation>> {
    try {
      const { page = 1, limit = 50, orderBy = 'last_message_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for agent
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId);

      // Get paginated data for agent
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('agent_id', agentId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find conversations by agent', { error, agentId, options });
        throw new Error(`Failed to find conversations by agent: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Conversation[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding conversations by agent', { error, agentId, options });
      throw error;
    }
  }

  async findByUser(userId: string, options: PaginationOptions = {}): Promise<PaginatedResult<Conversation>> {
    try {
      const { page = 1, limit = 50, orderBy = 'last_message_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for user
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Get paginated data for user
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find conversations by user', { error, userId, options });
        throw new Error(`Failed to find conversations by user: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Conversation[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding conversations by user', { error, userId, options });
      throw error;
    }
  }

  async findByChannel(channel: string, options: PaginationOptions = {}): Promise<PaginatedResult<Conversation>> {
    try {
      const { page = 1, limit = 50, orderBy = 'last_message_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for channel
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('channel', channel);

      // Get paginated data for channel
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('channel', channel)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find conversations by channel', { error, channel, options });
        throw new Error(`Failed to find conversations by channel: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Conversation[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding conversations by channel', { error, channel, options });
      throw error;
    }
  }

  async findByStatus(status: string, options: PaginationOptions = {}): Promise<PaginatedResult<Conversation>> {
    try {
      const { page = 1, limit = 50, orderBy = 'last_message_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for status
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

      // Get paginated data for status
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('status', status)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find conversations by status', { error, status, options });
        throw new Error(`Failed to find conversations by status: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Conversation[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding conversations by status', { error, status, options });
      throw error;
    }
  }

  async findWithFilters(filters: ConversationFilters, options: PaginationOptions = {}): Promise<PaginatedResult<Conversation>> {
    try {
      const { page = 1, limit = 50, orderBy = 'last_message_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let query = this.client
        .from(this.tableName)
        .select('*', { count: 'exact' });

      // Apply filters
      if (filters.agent_id) {
        query = query.eq('agent_id', filters.agent_id);
      }
      if (filters.user_id) {
        query = query.eq('user_id', filters.user_id);
      }
      if (filters.channel) {
        query = query.eq('channel', filters.channel);
      }
      if (filters.customer_id) {
        query = query.eq('customer_id', filters.customer_id);
      }
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.created_after) {
        query = query.gte('created_at', filters.created_after);
      }
      if (filters.created_before) {
        query = query.lte('created_at', filters.created_before);
      }

      // Apply pagination and ordering
      const { data, error, count } = await query
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find conversations with filters', { error, filters, options });
        throw new Error(`Failed to find conversations with filters: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as Conversation[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding conversations with filters', { error, filters, options });
      throw error;
    }
  }

  async updateLastMessageAt(conversationId: string, timestamp: string = new Date().toISOString()): Promise<Conversation> {
    try {
      const { data: result, error } = await this.client
        .from(this.tableName)
        .update({
          last_message_at: timestamp,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update last message timestamp', { error, conversationId, timestamp });
        throw new Error(`Failed to update last message timestamp: ${error.message}`);
      }

      logger.info('Updated last message timestamp', { conversationId, timestamp });
      return result as Conversation;
    } catch (error) {
      logger.error('Error updating last message timestamp', { error, conversationId, timestamp });
      throw error;
    }
  }

  async updateState(conversationId: string, state: Record<string, any>): Promise<Conversation> {
    try {
      const { data: result, error } = await this.client
        .from(this.tableName)
        .update({
          state,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update conversation state', { error, conversationId, state });
        throw new Error(`Failed to update conversation state: ${error.message}`);
      }

      logger.info('Updated conversation state', { conversationId });
      return result as Conversation;
    } catch (error) {
      logger.error('Error updating conversation state', { error, conversationId, state });
      throw error;
    }
  }

  async updateStatus(conversationId: string, status: string): Promise<Conversation> {
    try {
      const { data: result, error } = await this.client
        .from(this.tableName)
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update conversation status', { error, conversationId, status });
        throw new Error(`Failed to update conversation status: ${error.message}`);
      }

      logger.info('Updated conversation status', { conversationId, status });
      return result as Conversation;
    } catch (error) {
      logger.error('Error updating conversation status', { error, conversationId, status });
      throw error;
    }
  }

  async getConversationStats(agentId?: string): Promise<{
    total: number;
    active: number;
    completed: number;
    byChannel: Record<string, number>;
    byStatus: Record<string, number>;
  }> {
    try {
      // Get total count
      let totalQuery = this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true });
      
      if (agentId) {
        totalQuery = totalQuery.eq('agent_id', agentId);
      }
      
      const { count: totalCount } = await totalQuery;

      // Get active conversations (assuming 'active' status)
      let activeQuery = this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      
      if (agentId) {
        activeQuery = activeQuery.eq('agent_id', agentId);
      }
      
      const { count: activeCount } = await activeQuery;

      // Get completed conversations (assuming 'completed' status)
      let completedQuery = this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed');
      
      if (agentId) {
        completedQuery = completedQuery.eq('agent_id', agentId);
      }
      
      const { count: completedCount } = await completedQuery;

      // Get conversations by channel
      let channelQuery = this.client
        .from(this.tableName)
        .select('channel')
        .not('channel', 'is', null);
      
      if (agentId) {
        channelQuery = channelQuery.eq('agent_id', agentId);
      }
      
      const { data: channelData } = await channelQuery;

      // Get conversations by status
      let statusQuery = this.client
        .from(this.tableName)
        .select('status')
        .not('status', 'is', null);
      
      if (agentId) {
        statusQuery = statusQuery.eq('agent_id', agentId);
      }
      
      const { data: statusData } = await statusQuery;

      const byChannel: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      // Count by channel
      if (channelData) {
        channelData.forEach((item: any) => {
          byChannel[item.channel] = (byChannel[item.channel] || 0) + 1;
        });
      }

      // Count by status
      if (statusData) {
        statusData.forEach((item: any) => {
          byStatus[item.status] = (byStatus[item.status] || 0) + 1;
        });
      }

      return {
        total: totalCount || 0,
        active: activeCount || 0,
        completed: completedCount || 0,
        byChannel,
        byStatus
      };
    } catch (error) {
      logger.error('Error getting conversation stats', { error, agentId });
      throw error;
    }
  }
}

export default new ConversationsRepository();