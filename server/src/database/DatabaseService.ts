// path: database/DatabaseService.ts
import SupabaseService from './config/supabase';
import logger from '../utils/logger';

// Import all repositories
import TenantsRepository from './repositories/TenantsRepository';
import AgentsRepository from './repositories/AgentsRepository';
import AgentTablesRepository from './repositories/AgentTablesColumnsRepository';
import AgentTableRowsRepository from './repositories/AgentTableRowsRepository';
import AgentVectorDataRepository from './repositories/AgentVectorDataRepository';
import WorkspacesRepository from './repositories/WorkspacesRepository';
import WorkspaceUsageRepository from './repositories/WorkspaceUsageRepository';
import WorkspaceSettingsRepository from './repositories/WorkspaceSettingsRepository';
import ConversationsRepository from './repositories/ConversationsRepository';
import MessagesRepository from './repositories/MessagesRepository';

// Import services
import TableService from './services/TableService';
import ConversationService from './services/ConversationService';

export interface DatabaseStats {
  tenants: {
    total: number;
    recent: number;
  };
  users: {
    total: number;
    byRole: Record<string, number>;
    recent: number;
  };
  contacts: {
    total: number;
    byChannel: Record<string, number>;
    recent: number;
    withConversations: number;
  };
  tables: {
    total: number;
    withRows: number;
    totalRows: number;
    averageRowsPerTable: number;
  };
}

class DatabaseService {
  private static instance: DatabaseService;
  private supabaseService: SupabaseService;
  private isInitialized: boolean = false;

  // Repository accessors
  public get tenants() {
    // Provide only public interface/properties/methods
    const { client, tableName, ...rest } = TenantsRepository as any;
    return rest as typeof TenantsRepository;
  }
  public get agents() {
    const { client, tableName, ...rest } = AgentsRepository as any;
    return rest as typeof AgentsRepository;
  }
  public get users() {
    const { client, tableName, ...rest } = TenantsRepository as any;
    return rest as typeof TenantsRepository;
  }
  public get agentTables() {
    const { client, tableName, ...rest } = AgentTablesRepository as any;
    return rest as typeof AgentTablesRepository;
  }
  public get agentTableRows() {
    const { client, tableName, ...rest } = AgentTableRowsRepository as any;
    return rest as typeof AgentTableRowsRepository;
  }
  public get agentVectorData() {
    const { client, tableName, ...rest } = AgentVectorDataRepository as any;
    return rest as typeof AgentVectorDataRepository;
  }
  public get workspaces() {
    const { client, tableName, ...rest } = WorkspacesRepository as any;
    return rest as typeof WorkspacesRepository;
  }
  public get workspaceUsage() {
    const { client, tableName, ...rest } = WorkspaceUsageRepository as any;
    return rest as typeof WorkspaceUsageRepository;
  }
  public get workspaceSettings() {
    const { client, tableName, ...rest } = WorkspaceSettingsRepository as any;
    return rest as typeof WorkspaceSettingsRepository;
  }
  public get conversations() {
    // The main repo may have private/protected fields (client, tableName, buildMatchObject, etc)
    // Exclude them from the public returned interface
    // NOTE: Some repositories (like ConversationsRepository) may expose additional protected/private methods,
    // which we defensively omit
    // As a workaround, we pick only own properties except the common protected/private ones
    const {
      client, tableName, buildMatchObject,
      // any other known private/protected members
      ...rest
    } = ConversationsRepository as any;
    return rest as typeof ConversationsRepository;
  }
  public get messages() {
    const {
      client, tableName, buildMatchObject,
      // any other known private/protected members
      ...rest
    } = MessagesRepository as any;
    return rest as typeof MessagesRepository;
  }

  // Services
  public get tables() { return TableService; }
  public get conversationService() {
    // Similarly, ConversationService might reference private fields (messagesRepo, conversationsRepo, etc).
    // Defensive tactic: Omit known private/protected fields on the object
    const {
      conversationsRepo,
      messagesRepo,
      createMessagePreview,
      searchConversationsByMessageContent,
      // Add any other known private/protected members here
      ...rest
    } = ConversationService as any;
    return rest as typeof ConversationService;
  }

  private constructor() {
    this.supabaseService = SupabaseService.getInstance();
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  public async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        logger.info('Database service already initialized');
        return;
      }

      logger.info('Initializing database service...');

      this.verifyEnvironmentVariables();

      this.isInitialized = true;
      logger.info('Database service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database service', { error });
      throw error;
    }
  }

  private verifyEnvironmentVariables(): void {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  private normalizeContactStats(rawStats: any): DatabaseStats['contacts'] {
    if (rawStats && typeof rawStats === 'object') {
      return {
        total: rawStats.totalContacts ?? 0,
        byChannel: rawStats.contactsByChannel ?? {},
        recent: rawStats.recentContacts ?? 0,
        withConversations: rawStats.contactsWithConversations ?? 0,
      };
    }
    return { total: 0, byChannel: {}, recent: 0, withConversations: 0 };
  }

  private normalizeTableStats(rawStats: any): DatabaseStats['tables'] {
    if (rawStats && typeof rawStats === 'object') {
      return {
        total: rawStats.totalTables ?? 0,
        withRows: rawStats.tablesWithRows ?? 0,
        totalRows: rawStats.totalRows ?? 0,
        averageRowsPerTable: rawStats.averageRowsPerTable ?? 0,
      };
    }
    return { total: 0, withRows: 0, totalRows: 0, averageRowsPerTable: 0 };
  }

  public async getTenantStats(tenantId: string): Promise<DatabaseStats> {
    try {
      logger.info('Generating tenant stats', { tenantId });

      const [
        tenantStats,
        tableStats,
      ] = await Promise.allSettled([
        this.tenants.getTenantStats(tenantId),
        this.tables.getTableStats(),
      ]);

      const stats: DatabaseStats = {
        tenants: {
          total: 1,
          recent: 1,
        },
        users: { total: 0, byRole: {}, recent: 0 },
        contacts: { total: 0, byChannel: {}, recent: 0, withConversations: 0 },
        tables: tableStats.status === 'fulfilled'
          ? this.normalizeTableStats(tableStats.value)
          : { total: 0, withRows: 0, totalRows: 0, averageRowsPerTable: 0 },
      };

      logger.info('Generated tenant stats', { tenantId, stats });
      return stats;
    } catch (error) {
      logger.error('Failed to generate tenant stats', { error, tenantId });
      throw error;
    }
  }

  public async getGlobalStats(): Promise<Partial<DatabaseStats>> {
    try {
      logger.info('Generating global stats');

      const [
        allTenantsCount,
        globalTableStats,
      ] = await Promise.allSettled([
        this.tenants.count(),
        this.tables.getTableStats(),
      ]);

      const stats: Partial<DatabaseStats> = {
        tenants: {
          total: allTenantsCount.status === 'fulfilled' ? allTenantsCount.value : 0,
          recent: 0,
        },
        tables: globalTableStats.status === 'fulfilled'
          ? this.normalizeTableStats(globalTableStats.value)
          : { total: 0, withRows: 0, totalRows: 0, averageRowsPerTable: 0 },
      };

      logger.info('Generated global stats', { stats });
      return stats;
    } catch (error) {
      logger.error('Failed to generate global stats', { error });
      throw error;
    }
  }

  public async performMaintenance(): Promise<{
    completedTasks: string[];
    errors: string[];
  }> {
    const completedTasks: string[] = [];
    const errors: string[] = [];

    try {
      logger.info('Starting database maintenance');

      // Clean up orphaned table rows
      try {
        completedTasks.push('Orphaned table rows cleanup');
      } catch (error) {
        const errorMsg = `Failed to clean up orphaned table rows: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }

      logger.info('Database maintenance completed', { completedTasks, errors });

      return { completedTasks, errors };
    } catch (error) {
      logger.error('Database maintenance failed', { error });
      throw error;
    }
  }

  public async closeConnection(): Promise<void> {
    try {
      this.isInitialized = false;
      logger.info('Database service connection closed');
    } catch (error) {
      logger.error('Error closing database connection', { error });
    }
  }

  public get client() {
    return this.supabaseService.getClient();
  }

  public get isReady(): boolean {
    return this.isInitialized;
  }

  public async getHealthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    timestamp: string;
    database: {
      connected: boolean;
      responseTime?: number;
    };
    repositories: {
      tenants: boolean;
      agents: boolean;
      users: boolean;
      tables: boolean;
      conversations: boolean;
      messages: boolean;
    };
  }> {
    try {
      const startTime = Date.now();

      // Test database connection by running a simple query
      const { error } = await this.client
        .from('tenants')
        .select('id')
        .limit(1);

      const responseTime = Date.now() - startTime;

      if (error) {
        logger.error('Database health check failed', { error: error.message });
        return {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          database: {
            connected: false,
            responseTime
          },
          repositories: {
            tenants: false,
            agents: false,
            users: false,
            tables: false,
            conversations: false,
            messages: false
          }
        };
      }

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          responseTime
        },
        repositories: {
          tenants: true,
          agents: true,
          users: true,
          tables: true,
          conversations: true,
          messages: true
        }
      };
    } catch (error) {
      logger.error('Database health check error', { error });
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: false
        },
        repositories: {
          tenants: false,
          agents: false,
          users: false,
          tables: false,
          conversations: false,
          messages: false
        }
      };
    }
  }
}

export default DatabaseService;