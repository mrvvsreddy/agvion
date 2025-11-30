// database/repositories/BaseRepository.ts
import { SupabaseClient } from '@supabase/supabase-js';
import SupabaseService, { Database } from '../config/supabase';
import logger from '../../utils/logger';

export interface PaginationOptions {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export abstract class BaseRepository<T, InsertT, UpdateT> {
  // Use a lenient client typing to avoid over-constrained generics causing `never` inference
  protected client: SupabaseClient<any>;
  protected tableName: string;

  constructor(tableName: string) {
    this.client = SupabaseService.getInstance().getClient() as unknown as SupabaseClient<any>;
    this.tableName = tableName;
  }

  async create(data: InsertT): Promise<T> {
    try {
      const { data: result, error } = await this.client
        .from(this.tableName as any)
        .insert(data as any)
        .select()
        .single();

      if (error) {
        logger.error(`Failed to create ${this.tableName}`, { error, data });
        throw new Error(`Failed to create ${this.tableName}: ${error.message}`);
      }

      logger.info(`Created ${this.tableName}`, { id: (result as any).id });
      return result as T;
    } catch (error) {
      logger.error(`Error creating ${this.tableName}`, { error, data });
      throw error;
    }
  }

  async findById(id: string): Promise<T | null> {
    try {
      const { data, error } = await this.client
        .from(this.tableName as any)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // No rows found
        }
        logger.error(`Failed to find ${this.tableName} by id`, { error, id });
        throw new Error(`Failed to find ${this.tableName}: ${error.message}`);
      }

      return data as T;
    } catch (error) {
      logger.error(`Error finding ${this.tableName} by id`, { error, id });
      throw error;
    }
  }

  async findAll(options: PaginationOptions = {}): Promise<PaginatedResult<T>> {
    try {
      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count
      const { count } = await this.client
        .from(this.tableName as any)
        .select('*', { count: 'exact', head: true });

      // Get paginated data
      const { data, error } = await this.client
        .from(this.tableName as any)
        .select('*')
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error(`Failed to find all ${this.tableName}`, { error, options });
        throw new Error(`Failed to find all ${this.tableName}: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as T[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error(`Error finding all ${this.tableName}`, { error, options });
      throw error;
    }
  }

  async update(id: string, data: UpdateT): Promise<T> {
    try {
      const { data: result, error } = await this.client
        .from(this.tableName as any)
        .update({
          ...data,
          updated_at: new Date().toISOString()
        } as any)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        logger.error(`Failed to update ${this.tableName}`, { error, id, data });
        throw new Error(`Failed to update ${this.tableName}: ${error.message}`);
      }

      logger.info(`Updated ${this.tableName}`, { id });
      return result as T;
    } catch (error) {
      logger.error(`Error updating ${this.tableName}`, { error, id, data });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const { error } = await this.client
        .from(this.tableName as any)
        .delete()
        .eq('id', id);

      if (error) {
        logger.error(`Failed to delete ${this.tableName}`, { error, id });
        throw new Error(`Failed to delete ${this.tableName}: ${error.message}`);
      }

      logger.info(`Deleted ${this.tableName}`, { id });
      return true;
    } catch (error) {
      logger.error(`Error deleting ${this.tableName}`, { error, id });
      throw error;
    }
  }

  async findBy(column: string, value: any): Promise<T[]> {
    try {
      const { data, error } = await this.client
        .from(this.tableName as any)
        .select('*')
        .eq(column, value);

      if (error) {
        logger.error(`Failed to find ${this.tableName} by ${column}`, { error, column, value });
        throw new Error(`Failed to find ${this.tableName}: ${error.message}`);
      }

      return data as T[];
    } catch (error) {
      logger.error(`Error finding ${this.tableName} by ${column}`, { error, column, value });
      throw error;
    }
  }

  async findByTenant(tenantId: string, options: PaginationOptions = {}): Promise<PaginatedResult<T>> {
    try {
      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      // Get total count for tenant
      const { count } = await this.client
        .from(this.tableName as any)
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      // Get paginated data for tenant
      const { data, error } = await this.client
        .from(this.tableName as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error(`Failed to find ${this.tableName} by tenant`, { error, tenantId, options });
        throw new Error(`Failed to find ${this.tableName} by tenant: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: data as T[],
        totalCount,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      logger.error(`Error finding ${this.tableName} by tenant`, { error, tenantId, options });
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from(this.tableName as any)
        .select('id')
        .eq('id', id)
        .single();

      if (error && error.code !== 'PGRST116') {
        logger.error(`Failed to check if ${this.tableName} exists`, { error, id });
        throw new Error(`Failed to check if ${this.tableName} exists: ${error.message}`);
      }

      return data !== null;
    } catch (error) {
      logger.error(`Error checking if ${this.tableName} exists`, { error, id });
      throw error;
    }
  }

  async count(filters?: Record<string, any>): Promise<number> {
    try {
      let query = this.client
        .from(this.tableName as any)
        .select('*', { count: 'exact', head: true });

      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }

      const { count, error } = await query;

      if (error) {
        logger.error(`Failed to count ${this.tableName}`, { error, filters });
        throw new Error(`Failed to count ${this.tableName}: ${error.message}`);
      }

      return count || 0;
    } catch (error) {
      logger.error(`Error counting ${this.tableName}`, { error, filters });
      throw error;
    }
  }
}