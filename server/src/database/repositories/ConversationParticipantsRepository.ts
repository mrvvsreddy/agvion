// database/repositories/ConversationParticipantsRepository.ts
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import logger from '../../utils/logger';

export interface ConversationParticipant {
  conversation_id: string;
  customer_id: string;
  agent_id: string;
  role: string; // 'owner' | 'collaborator'
  joined_at: string;
  left_at: string | null;
  is_active: boolean;
}

export interface CreateConversationParticipantData {
  conversation_id: string;
  customer_id: string;
  agent_id: string;
  role: string;
  joined_at?: string;
  left_at?: string | null;
  is_active?: boolean;
}

export interface UpdateConversationParticipantData {
  role?: string;
  left_at?: string | null;
  is_active?: boolean;
}

export interface ConversationParticipantFilters {
  conversation_id?: string;
  customer_id?: string;
  agent_id?: string;
  role?: string;
  is_active?: boolean;
}

class ConversationParticipantsRepository extends BaseRepository<
  ConversationParticipant,
  CreateConversationParticipantData,
  UpdateConversationParticipantData
> {
  constructor() {
    super('conversation_participants');
  }

  /**
   * Create a participant with composite primary key handling
   */
  async create(data: CreateConversationParticipantData): Promise<ConversationParticipant> {
    try {
      const participantData = {
        conversation_id: data.conversation_id,
        customer_id: data.customer_id,
        agent_id: data.agent_id,
        role: data.role,
        joined_at: data.joined_at || new Date().toISOString(),
        left_at: data.left_at || null,
        is_active: data.is_active !== undefined ? data.is_active : true
      };

      const { data: result, error } = await this.client
        .from(this.tableName)
        .insert(participantData)
        .select()
        .single();

      if (error) {
        logger.error('Failed to create conversation participant', { error, data });
        throw new Error(`Failed to create conversation participant: ${error.message}`);
      }

      logger.info('Created conversation participant', {
        conversationId: data.conversation_id,
        agentId: data.agent_id
      });

      return result as ConversationParticipant;
    } catch (error) {
      logger.error('Error creating conversation participant', { error, data });
      throw error;
    }
  }

  /**
   * Find a specific participant by conversation_id and agent_id (composite key)
   */
  async findByConversationAndAgent(
    conversationId: string,
    agentId: string
  ): Promise<ConversationParticipant | null> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('agent_id', agentId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No participant found
        }
        logger.error('Failed to find participant by conversation and agent', {
          error,
          conversationId,
          agentId
        });
        throw new Error(
          `Failed to find participant by conversation and agent: ${error.message}`
        );
      }

      return data as ConversationParticipant;
    } catch (error) {
      logger.error('Error finding participant by conversation and agent', {
        error,
        conversationId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Find all participants for a conversation
   */
  async findByConversation(
    conversationId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationParticipant>> {
    try {
      const { page = 1, limit = 100, orderBy = 'joined_at', orderDirection = 'asc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId);

      // Get paginated data
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('conversation_id', conversationId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find participants by conversation', {
          error,
          conversationId,
          options
        });
        throw new Error(`Failed to find participants by conversation: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as ConversationParticipant[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding participants by conversation', {
        error,
        conversationId,
        options
      });
      throw error;
    }
  }

  /**
   * Find active participants for a conversation
   */
  async findActiveByConversation(
    conversationId: string
  ): Promise<ConversationParticipant[]> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('is_active', true)
        .order('joined_at', { ascending: true });

      if (error) {
        logger.error('Failed to find active participants by conversation', {
          error,
          conversationId
        });
        throw new Error(
          `Failed to find active participants by conversation: ${error.message}`
        );
      }

      return (data || []) as ConversationParticipant[];
    } catch (error) {
      logger.error('Error finding active participants by conversation', {
        error,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Find all conversations a specific agent is participating in
   */
  async findByAgent(
    agentId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationParticipant>> {
    try {
      const { page = 1, limit = 50, orderBy = 'joined_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId);

      // Get paginated data
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('agent_id', agentId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find participants by agent', { error, agentId, options });
        throw new Error(`Failed to find participants by agent: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as ConversationParticipant[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding participants by agent', { error, agentId, options });
      throw error;
    }
  }

  /**
   * Find all participants for a customer (tenant)
   */
  async findByCustomer(
    customerId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationParticipant>> {
    try {
      const { page = 1, limit = 50, orderBy = 'joined_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', customerId);

      // Get paginated data
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('customer_id', customerId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find participants by customer', {
          error,
          customerId,
          options
        });
        throw new Error(`Failed to find participants by customer: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as ConversationParticipant[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding participants by customer', {
        error,
        customerId,
        options
      });
      throw error;
    }
  }

  /**
   * Update participant using composite key
   */
  async updateParticipant(
    conversationId: string,
    agentId: string,
    data: UpdateConversationParticipantData
  ): Promise<ConversationParticipant> {
    try {
      const updateData: any = {
        ...data
      };

      if (data.is_active === false && !data.left_at) {
        updateData.left_at = new Date().toISOString();
      }

      if (data.is_active === true && data.left_at) {
        updateData.left_at = null;
      }

      const { data: result, error } = await this.client
        .from(this.tableName)
        .update(updateData)
        .eq('conversation_id', conversationId)
        .eq('agent_id', agentId)
        .select()
        .single();

      if (error) {
        logger.error('Failed to update participant', {
          error,
          conversationId,
          agentId,
          data
        });
        throw new Error(`Failed to update participant: ${error.message}`);
      }

      logger.info('Updated participant', { conversationId, agentId });
      return result as ConversationParticipant;
    } catch (error) {
      logger.error('Error updating participant', {
        error,
        conversationId,
        agentId,
        data
      });
      throw error;
    }
  }

  /**
   * Remove a participant (mark as inactive and set left_at)
   */
  async removeParticipant(
    conversationId: string,
    agentId: string
  ): Promise<ConversationParticipant> {
    try {
      return await this.updateParticipant(conversationId, agentId, {
        is_active: false,
        left_at: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error removing participant', { error, conversationId, agentId });
      throw error;
    }
  }

  /**
   * Delete a participant (hard delete)
   */
  async deleteParticipant(conversationId: string, agentId: string): Promise<boolean> {
    try {
      const { error } = await this.client
        .from(this.tableName)
        .delete()
        .eq('conversation_id', conversationId)
        .eq('agent_id', agentId);

      if (error) {
        logger.error('Failed to delete participant', {
          error,
          conversationId,
          agentId
        });
        throw new Error(`Failed to delete participant: ${error.message}`);
      }

      logger.info('Deleted participant', { conversationId, agentId });
      return true;
    } catch (error) {
      logger.error('Error deleting participant', { error, conversationId, agentId });
      throw error;
    }
  }

  /**
   * Delete all participants for a conversation
   */
  async deleteByConversation(conversationId: string): Promise<number> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .delete()
        .eq('conversation_id', conversationId)
        .select('conversation_id');

      if (error) {
        logger.error('Failed to delete participants by conversation', {
          error,
          conversationId
        });
        throw new Error(
          `Failed to delete participants by conversation: ${error.message}`
        );
      }

      const deletedCount = data?.length || 0;
      logger.info('Deleted participants by conversation', {
        conversationId,
        deletedCount
      });
      return deletedCount;
    } catch (error) {
      logger.error('Error deleting participants by conversation', {
        error,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Find participants with filters
   */
  async findWithFilters(
    filters: ConversationParticipantFilters,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<ConversationParticipant>> {
    try {
      const { page = 1, limit = 50, orderBy = 'joined_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let query = this.client
        .from(this.tableName)
        .select('*', { count: 'exact' });

      // Apply filters
      if (filters.conversation_id) {
        query = query.eq('conversation_id', filters.conversation_id);
      }
      if (filters.customer_id) {
        query = query.eq('customer_id', filters.customer_id);
      }
      if (filters.agent_id) {
        query = query.eq('agent_id', filters.agent_id);
      }
      if (filters.role) {
        query = query.eq('role', filters.role);
      }
      if (typeof filters.is_active === 'boolean') {
        query = query.eq('is_active', filters.is_active);
      }

      // Apply pagination and ordering
      const { data, error, count } = await query
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find participants with filters', { error, filters, options });
        throw new Error(`Failed to find participants with filters: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as ConversationParticipant[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error('Error finding participants with filters', { error, filters, options });
      throw error;
    }
  }

  /**
   * Check if an agent is an active participant in a conversation
   */
  async isActiveParticipant(conversationId: string, agentId: string): Promise<boolean> {
    try {
      const participant = await this.findByConversationAndAgent(conversationId, agentId);
      return participant !== null && participant.is_active === true;
    } catch (error) {
      logger.error('Error checking if agent is active participant', {
        error,
        conversationId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Get participant count for a conversation
   */
  async getParticipantCount(conversationId: string, activeOnly: boolean = false): Promise<number> {
    try {
      let query = this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId);

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      const { count, error } = await query;

      if (error) {
        logger.error('Failed to get participant count', { error, conversationId, activeOnly });
        throw new Error(`Failed to get participant count: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error('Error getting participant count', { error, conversationId, activeOnly });
      throw error;
    }
  }
}

export default new ConversationParticipantsRepository();

