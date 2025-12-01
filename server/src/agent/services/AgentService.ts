// agent/services/AgentService.ts
import { v4 as uuidv4 } from 'uuid';
import crypto, { randomUUID } from 'crypto';
import Joi from 'joi';
import { AgentsRepository } from '../../database/repositories/AgentsRepository';
import { TenantsRepository } from '../../database/repositories/TenantsRepository';
import { WorkspacesRepository } from '../../database/repositories/WorkspacesRepository';
import { WorkspaceRepository } from '../../workspace/repositories/WorkspaceRepository';
import { WorkspaceCacheService } from '../../workspace/services/WorkspaceCacheService';
import { redisClient } from '../../redis';
import logger from '../../utils/logger';

import { AgentIntegrationsRepository } from '../../database/repositories/AgentIntegrationsRepository';
import AgentTablesRepository from '../../database/repositories/AgentTablesColumnsRepository';
import AgentTableRowsRepository from '../../database/repositories/AgentTableRowsRepository';
import SupabaseService from '../../database/config/supabase';
import IntegrationsRepository from '../../database/repositories/IntegrationsRepository';
import { Agent, CreateAgentRequest, CreateAgentResponse, GetAgentsResponse, DeleteAgentResponse, AgentStudioData, GetAgentStudioDataResponse } from '../types';

// Default system prompt for new agents
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant. Please assist the user with their questions and tasks to the best of your ability.';

// Validation schemas
const createAgentSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(255)
    .required()
    .trim()
    .pattern(/^[a-zA-Z0-9\s\-_\.]+$/) // Only allow safe characters
    .messages({
      'string.pattern.base': 'Name can only contain letters, numbers, spaces, hyphens, underscores, and periods'
    }),
  description: Joi.string()
    .max(1000)
    .optional()
    .trim()
    .allow('', null)
});

const tenantIdSchema = Joi.string().min(1).required();

/**
 * Generate alphanumeric ID of exactly 16 characters for agents only
 * Uses cryptographically secure random bytes
 * 
 * NOTE: Race Condition
 * There's a potential race condition between checking and creating the ID.
 * For production systems, consider:
 * 1. Using a database-level reservation table with INSERT ... ON CONFLICT
 * 2. Using a distributed lock (Redis, etc.)
 * 3. Using database sequences or UUIDs
 * 
 * TODO: Implement AgentsRepository.reserveId() method with database-level atomicity
 */
async function generateAgentId(agentsRepository: AgentsRepository): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    // Use cryptographically secure random bytes
    const randomBytes = crypto.randomBytes(16);
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(randomBytes[i]! % chars.length);
    }

    // Check if ID already exists
    // RACE CONDITION: Multiple requests could pass this check simultaneously
    // Mitigation: Database unique constraint will prevent duplicates
    try {
      const existingAgent = await agentsRepository.findById(result);
      if (!existingAgent) {
        return result; // ID is unique (at this moment)
      }
    } catch (error) {
      // If there's an error checking, log it but try another ID
      logger.warn('Error checking agent ID existence', { error: error instanceof Error ? error.message : 'Unknown error' });
      // Continue to next attempt
    }

    attempts++;
  }

  // Fallback: if we can't generate a unique ID after max attempts, throw error
  throw new Error('Unable to generate unique agent ID after multiple attempts');
}

/**
 * Simple circuit breaker for external service calls
 */
class CircuitBreaker {
  public failures = 0; // Public for metrics
  public lastFailureTime: number | null = null; // Public for metrics
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) { }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.threshold) {
        this.state = 'open';
      }

      throw error;
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.lastFailureTime = null;
    this.state = 'closed';
  }
}

export class AgentService {
  private agentsRepository: AgentsRepository;
  private tenantsRepository: TenantsRepository;
  private workspacesRepository: WorkspacesRepository;
  private workspaceRepository: WorkspaceRepository;
  private workspaceCacheService: WorkspaceCacheService;

  private agentIntegrationsRepository: AgentIntegrationsRepository;
  private integrationsRepository: typeof IntegrationsRepository;
  private redisCircuitBreaker: CircuitBreaker;
  private agentTablesRepository: typeof AgentTablesRepository;

  constructor(
    agentsRepository?: AgentsRepository,
    tenantsRepository?: TenantsRepository,
    workspacesRepository?: WorkspacesRepository,
    workspaceRepository?: WorkspaceRepository,
    workspaceCacheService?: WorkspaceCacheService,

    agentIntegrationsRepository?: AgentIntegrationsRepository,
    integrationsRepository?: typeof IntegrationsRepository
  ) {
    // Support dependency injection while maintaining backward compatibility
    this.agentsRepository = agentsRepository || new AgentsRepository();
    this.tenantsRepository = tenantsRepository || new TenantsRepository();
    this.workspacesRepository = workspacesRepository || new WorkspacesRepository();
    this.workspaceRepository = workspaceRepository || new WorkspaceRepository();
    this.workspaceCacheService = workspaceCacheService || new WorkspaceCacheService();

    this.agentIntegrationsRepository = agentIntegrationsRepository || new AgentIntegrationsRepository();
    this.integrationsRepository = integrationsRepository || IntegrationsRepository;
    this.agentTablesRepository = AgentTablesRepository;
    this.redisCircuitBreaker = new CircuitBreaker(5, 60000); // 5 failures threshold, 1 minute timeout
  }

  /**
   * Load knowledge bases summary for sidebar/home without requiring session
   */
  private async loadKnowledgeSummary(tenantId: string, agentId: string): Promise<Array<{
    id: string;
    name: string;
    type: 'knowledge';
    agentId: string;
    tenantId: string;
    tableName: string;
    description?: string;
    hasData: boolean;
    size: string;
    createdAt: string;
    updatedAt: string;
  }>> {
    try {
      const tables = await this.agentTablesRepository.findByAgent(agentId);
      const filtered = (tables as any[]).filter(t => t.tenant_id === tenantId);
      if (!filtered.length) return [];

      const client = SupabaseService.getInstance().getClient();
      const tableIds = filtered.map((t: any) => t.id);

      let vectorData: any[] = [];
      try {
        const result = await client.from('agent_vector_data').select('table_id').in('table_id', tableIds);
        vectorData = result.data || [];
      } catch {
        vectorData = [];
      }
      const vectorCountMap = new Map<string, number>();
      (vectorData || []).forEach((row: any) => {
        const count = vectorCountMap.get(row.table_id) || 0;
        vectorCountMap.set(row.table_id, count + 1);
      });

      const out: any[] = [];
      for (const table of filtered) {
        let hasData = (vectorCountMap.get(table.id) || 0) > 0;
        let size = '0 KB';
        try {
          const manifest = await AgentTableRowsRepository.findByTable(table.id, { page: 1, limit: 100 }).catch(() => ({ data: [] }));
          const files = ((manifest.data || []) as any[]).map((r: any) => r.row_data).filter((d: any) => d && d.type === 'knowledge_file');
          if (files.length > 0) {
            hasData = true;
            const totalBytes = files.reduce((acc: number, f: any) => acc + (Number(f.sizeBytes) || 0), 0);
            const totalKB = Math.max(1, Math.round(totalBytes / 1024));
            size = `${files.length} file${files.length > 1 ? 's' : ''} — ${totalKB < 1024 ? `${totalKB} KB` : `${(totalKB / 1024).toFixed(2)} MB`}`;
          }
        } catch { }

        const name = typeof table.description === 'string'
          ? (table.description.match(/Knowledge base:\s*(.+)/)?.[1] || table.table_name)
          : table.table_name;
        out.push({
          id: table.id,
          name,
          type: 'knowledge' as const,
          agentId,
          tenantId,
          tableName: table.table_name,
          description: table.description || undefined,
          hasData,
          size,
          createdAt: table.created_at,
          updatedAt: table.updated_at
        });
      }
      return out;
    } catch (error) {
      logger.warn('Failed to load knowledge summary for agent', { error, agentId, tenantId });
      return [];
    }
  }

  /**
   * Wrapper to add timeout to async operations
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = 30000,
    errorMessage: string = 'Operation timed out'
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      )
    ]);
  }

  /**
   * Retry helper for transient failures
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: Error | unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Check if error is retryable (network issues, timeouts, etc.)
        const isRetryable = error instanceof Error && (
          error.message.includes('ECONNRESET') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('network') ||
          error.message.includes('timeout')
        );

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        logger.warn('Retrying operation after failure', {
          attempt,
          maxRetries,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }

    throw lastError;
  }

  /**
   * Emit metric (implement based on your monitoring solution)
   */
  private emitMetric(name: string, value: number = 1, tags?: Record<string, string>): void {
    try {
      // Example: Send to your metrics service (DataDog, CloudWatch, Prometheus, etc.)
      // metrics.increment(name, tags);
      // metrics.timing(name, value, tags);
      // For now, just log
      logger.debug('Metric emitted', { name, value, tags });
    } catch (error) {
      // Never let metrics break the application
      logger.warn('Failed to emit metric', { name, error });
    }
  }

  /**
   * Get circuit breaker metrics for monitoring
   */
  getCircuitBreakerMetrics(): {
    redis: {
      state: string;
      failures: number;
      lastFailureTime: number | null;
    };
  } {
    return {
      redis: {
        state: this.redisCircuitBreaker.getState(),
        failures: this.redisCircuitBreaker.failures,
        lastFailureTime: this.redisCircuitBreaker.lastFailureTime
      }
    };
  }

  /**
   * Verify agent access and ownership
   */
  private async verifyAgentAccess(
    tenantId: string,
    agentId: string
  ): Promise<{ authorized: boolean; agent?: any; message?: string }> {
    try {
      // Validate input
      if (!tenantId || typeof tenantId !== 'string' || tenantId.length === 0) {
        return { authorized: false, message: 'Invalid tenant ID' };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return { authorized: false, message: 'Invalid agent ID' };
      }

      const agent = await this.agentsRepository.findById(agentId);

      if (!agent) {
        return { authorized: false, message: 'Agent not found' };
      }

      // Check if agent's workspace belongs to the tenant
      const workspace = await this.workspacesRepository.findById(agent.workspace_id);
      if (!workspace || workspace.tenant_id !== tenantId) {
        logger.warn('Unauthorized agent access attempt', {
          tenantId,
          agentId,
          workspaceId: agent.workspace_id,
          actualTenantId: workspace?.tenant_id
        });
        return { authorized: false, message: 'Access denied' };
      }

      return { authorized: true, agent };
    } catch (error) {
      logger.error('Error verifying agent access', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return { authorized: false, message: 'Authorization check failed' };
    }
  }

  /**
   * Invalidate agent cache with improved error handling and circuit breaker
   */
  private async invalidateAgentCache(agentId: string): Promise<void> {
    try {
      await this.redisCircuitBreaker.execute(async () => {
        const keys = [
          `agent:studio:${agentId}`,
          `agent:studio:home:${agentId}`
        ];

        // Delete keys individually to avoid partial failures affecting everything
        const results = await Promise.allSettled(
          keys.map(key => redisClient.deleteKey(key))
        );

        const failures = results.filter(r => r.status === 'rejected');
        if (failures.length > 0) {
          logger.warn('Some cache keys failed to invalidate', {
            agentId,
            failedCount: failures.length,
            totalKeys: keys.length,
            errors: failures.map((f: PromiseRejectedResult) =>
              f.reason instanceof Error ? f.reason.message : 'Unknown error'
            )
          });
        } else {
          logger.info('Agent cache invalidated', { agentId });
        }
      });
    } catch (error) {
      logger.warn('Failed to invalidate agent cache', {
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        circuitState: this.redisCircuitBreaker.getState()
      });
      // Don't throw - cache invalidation failure shouldn't break operations
    }
  }

  /**
   * Update workspace metadata in database with current agent list
   */
  private async updateWorkspaceMetadata(workspaceId: string): Promise<void> {
    try {
      // Get current agents for this workspace
      const agents = await this.agentsRepository.getAgentsByWorkspace(workspaceId);

      // Create updated metadata
      const metadata = {
        agentIds: agents.map(agent => agent.id),
        lastAgentUpdate: new Date().toISOString(),
        version: 1
      };

      // Update workspace metadata in database
      await this.workspacesRepository.updateMetadata(workspaceId, metadata);

      logger.info('Workspace metadata updated with agent list', {
        workspaceId,
        agentCount: agents.length
      });
    } catch (error) {
      logger.warn('Failed to update workspace metadata', {
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - metadata update failure shouldn't break the operation
    }
  }
  private async refreshWorkspaceCache(workspaceId: string): Promise<void> {
    try {
      // Get the updated workspace data from database with agents
      const workspace = await this.workspaceRepository.getWorkspaceWithAgents(workspaceId);
      if (workspace) {
        // Update Redis cache
        await this.workspaceCacheService.setWorkspace(workspaceId, workspace);
        logger.info('Workspace cache refreshed after agent change', { workspaceId });
      }
    } catch (error) {
      logger.warn('Failed to refresh workspace cache', {
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - cache refresh failure shouldn't break the operation
    }
  }

  /**
   * Dynamically adds a "Knowledge Router" node to the workflow.
   * It fetches all agent tables (knowledge + any type),
   * links them to the workflow, and rewires edges: trigger → knowledge → agent.
   * This does NOT modify the saved workflow — only runtime copy.
   */


  /**
   * Create a new agent for a tenant
   * 
   * @param tenantId - The ID of the tenant creating the agent
   * @param agentData - The agent creation data containing name and optional description
   * @returns CreateAgentResponse with success status and agent data or error message
   * 
   * @example
   * ```typescript
   * const result = await agentService.createAgent('tenant-123', {
   *   name: 'Customer Support Bot',
   *   description: 'Handles customer inquiries'
   * });
   * 
   * if (result.success) {
   *   console.log('Agent created:', result.agent.id);
   * }
   * ```
   * 
   * @remarks
   * - Operations are not wrapped in a transaction (Supabase limitation)
   * - Partial failures may occur; consider implementing idempotency
   * - Default webchat flow is created asynchronously
   * - Cache and metadata updates are non-blocking
   * - Uses retry logic for transient database failures
   * - Emits metrics for monitoring (agent.created, agent.create.duration, agent.create.error)
   */
  async createAgent(tenantId: string, agentData: CreateAgentRequest): Promise<CreateAgentResponse> {
    const startTime = Date.now();

    try {
      // Validate tenantId
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      // Validate agent data
      const { error, value } = createAgentSchema.validate(agentData);
      if (error) {
        return {
          success: false,
          message: `Validation error: ${error.details[0]?.message || 'Invalid input data'}`
        };
      }

      const validatedData = value;

      // Get tenant to verify they exist and get their default workspace
      // Use retry for transient network failures
      const tenant = await this.withRetry(() =>
        this.tenantsRepository.findTenantById(tenantId)
      );
      if (!tenant) {
        return {
          success: false,
          message: 'Tenant not found'
        };
      }

      // NOTE: The following operations are not in a transaction.
      // If any operation fails after this point, partial state may exist.
      // Consider implementing Supabase RPC function for atomic creation.

      // Get tenant's workspaces to find the first one (or create a default one)
      const workspaces = await this.workspacesRepository.getWorkspacesByTenant(tenantId);
      let workspaceId: string;

      if (workspaces.length === 0) {
        // Create a default workspace for the tenant using UUID
        const defaultWorkspace = await this.workspacesRepository.create({
          id: uuidv4(),
          tenant_id: tenantId,
          email: tenant.email,
          name: `${tenant.name}'s Workspace`,
          slug: `${tenant.name.toLowerCase().replace(/\s+/g, '-')}-workspace`,
          description: 'Default workspace',
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        workspaceId = defaultWorkspace.id;

        // Update tenant workspace count
        await this.tenantsRepository.updateTenantCounts(tenantId, {
          workspace_count: 1
        });
      } else {
        // Add safety check for array access
        if (workspaces[0]) {
          workspaceId = workspaces[0].id;
        } else {
          logger.error('Workspace array unexpectedly empty', { tenantId });
          return {
            success: false,
            message: 'Failed to retrieve workspace'
          };
        }
      }

      // Create the agent with proper defaults
      const agentId = await generateAgentId(this.agentsRepository);
      const now = new Date().toISOString();

      const newAgent = await this.agentsRepository.create({
        id: agentId,
        workspace_id: workspaceId,
        name: validatedData.name,

        // Status must be 'draft' - cannot be activated without LLM config
        status: 'draft',

        // LLM configuration - all NULL until user configures
        llm_provider: null,
        llm_model: null,
        secret_id: null,

        // Provider-agnostic tuning defaults
        temperature: null,
        max_tokens: null,
        response_timeout_ms: 60000, // 60 seconds default timeout

        // System prompt with default value
        system_prompt: DEFAULT_SYSTEM_PROMPT,

        // Autonomy and permissions
        autonomy_mode: 'manual',
        approval_required: false,
        tool_permissions: {},

        // Feature flags - all disabled by default
        is_public: false,
        widget_enabled: false,
        api_enabled: false,

        // Usage counters - start at zero
        total_messages: 0,
        total_tokens: 0,

        // Configuration objects - empty by default
        brain: {},
        goals: {},
        tools: [],
        memory_config: {},

        // Audit fields
        created_at: now,
        updated_at: now,
        created_by: null,
        updated_by: null,
        last_executed_at: null,
        llm_secret_ref: null
      });

      // Update tenant's total agents count - logic removed as we can't easily count by tenant anymore without join
      // Or we could count by workspaces. For now, skipping to avoid error.
      /*
      const currentAgentCount = await this.agentsRepository.countByTenant(tenantId);
      await this.tenantsRepository.updateTenantCounts(tenantId, {
        total_agents: currentAgentCount
      });
      */



      // Update workspace metadata in database with new agent list
      await this.updateWorkspaceMetadata(workspaceId);

      // Refresh workspace cache to include the new agent
      await this.refreshWorkspaceCache(workspaceId);

      const duration = Date.now() - startTime;
      logger.info('Agent created successfully', {
        agentId,
        tenantId,
        workspaceId,
        agentName: validatedData.name,
        duration
      });

      // Emit metrics
      this.emitMetric('agent.created', 1, { tenant: tenantId });
      this.emitMetric('agent.create.duration', duration);

      return {
        success: true,
        agent: newAgent as Agent
      };
    } catch (error) {
      // Emit error metric
      this.emitMetric('agent.create.error', 1, { tenant: tenantId });

      // Log detailed error internally without sensitive data
      logger.error('Failed to create agent', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentName: agentData?.name, // Only log name, not full agentData
        duration: Date.now() - startTime
      });

      // Return generic message to user
      return {
        success: false,
        message: 'Failed to create agent. Please try again or contact support.'
      };
    }
  }

  /**
   * Get all agents for a tenant with pagination support
   */
  async getAgentsByTenant(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<GetAgentsResponse & { pagination?: { total: number; limit: number; offset: number; hasMore: boolean } }> {
    try {
      // Validate tenantId
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      // Validate pagination params
      const limit = Math.min(Math.max(options?.limit || 50, 1), 100); // Between 1-100
      const offset = Math.max(options?.offset || 0, 0); // Non-negative
      const sortBy = options?.sortBy || 'created_at';
      const sortOrder = options?.sortOrder || 'desc';

      // Validate sortBy to prevent SQL injection (even though we use parameterized queries)
      const allowedSortFields = ['created_at', 'updated_at', 'name', 'status'];
      if (!allowedSortFields.includes(sortBy)) {
        return {
          success: false,
          message: 'Invalid sort field'
        };
      }

      // Get all workspaces for tenant
      const workspaces = await this.workspacesRepository.getWorkspacesByTenant(tenantId);
      const workspaceIds = workspaces.map(w => w.id);

      if (workspaceIds.length === 0) {
        return {
          success: true,
          agents: [],
          pagination: {
            total: 0,
            limit,
            offset,
            hasMore: false
          }
        };
      }

      // Fetch agents for these workspaces
      const agents = await this.agentsRepository.getAgentsByWorkspaces(workspaceIds);
      const total = agents.length;

      // Simple pagination (repository should ideally handle this at DB level)
      let paginatedAgents = agents;
      if (limit && offset !== undefined) {
        paginatedAgents = agents.slice(offset, offset + limit);
      }

      return {
        success: true,
        agents: paginatedAgents as Agent[],
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total
        }
      };
    } catch (error) {
      logger.error('Failed to get agents by tenant', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId
      });
      return {
        success: false,
        message: 'Failed to get agents'
      };
    }
  }

  /**
   * Get agents by workspace
   */
  async getAgentsByWorkspace(workspaceId: string): Promise<GetAgentsResponse> {
    try {
      const agents = await this.agentsRepository.getAgentsByWorkspace(workspaceId);

      return {
        success: true,
        agents: agents as Agent[]
      };
    } catch (error) {
      logger.error('Failed to get agents by workspace', { error, workspaceId });
      return {
        success: false,
        message: 'Failed to get agents'
      };
    }
  }

  /**
   * Update an agent (rename)
   */
  async updateAgent(
    tenantId: string,
    agentId: string,
    updates: { name: string }
  ): Promise<{ success: boolean; agent?: Agent; message?: string }> {
    try {
      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Validate name
      const { error, value } = createAgentSchema.validate(updates);
      if (error) {
        return {
          success: false,
          message: `Validation error: ${error.details[0]?.message || 'Invalid input data'}`
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      // Update agent in database
      const updatedAgent = await this.agentsRepository.update(agentId, {
        name: value.name,
        updated_at: new Date().toISOString()
      });

      if (!updatedAgent) {
        return {
          success: false,
          message: 'Failed to update agent'
        };
      }

      // Invalidate cache
      await this.invalidateAgentCache(agentId);

      logger.info('Agent updated successfully', {
        agentId,
        tenantId,
        updates: value
      });

      return {
        success: true,
        agent: updatedAgent as Agent
      };
    } catch (error) {
      logger.error('Failed to update agent', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });

      return {
        success: false,
        message: 'Failed to update agent. Please try again or contact support.'
      };
    }
  }

  /**
   * Delete an agent
   */
  async deleteAgent(tenantId: string, agentId: string): Promise<DeleteAgentResponse> {
    try {
      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      // NOTE: The following operations are not in a transaction.
      // If any operation fails after this point, partial state may exist.
      // Consider implementing Supabase RPC function for atomic deletion.

      // Delete the agent
      await this.agentsRepository.delete(agentId);

      // Delete agent config files from R2
      try {
        const { deleteAgentConfigFiles } = await import('../../utils/r2Uploader');
        const r2DeleteResult = await deleteAgentConfigFiles(agentId);
        if (r2DeleteResult.success) {
          logger.info('Agent config files deleted from R2', {
            agentId,
            deletedCount: r2DeleteResult.deletedCount
          });
        } else {
          logger.warn('Failed to delete some agent config files from R2', {
            agentId,
            deletedCount: r2DeleteResult.deletedCount,
            errors: r2DeleteResult.errors
          });
        }
      } catch (r2Error) {
        logger.warn('Error deleting agent config files from R2', {
          agentId,
          error: r2Error instanceof Error ? r2Error.message : 'Unknown error'
        });
        // Don't fail agent deletion if R2 cleanup fails
      }

      // Invalidate agent cache
      await this.invalidateAgentCache(agentId);

      // Update tenant's total agents count
      /*
      const currentAgentCount = await this.agentsRepository.countByTenant(tenantId);
      await this.tenantsRepository.updateTenantCounts(tenantId, {
        total_agents: currentAgentCount
      });
      */

      // Update workspace metadata in database with updated agent list
      await this.updateWorkspaceMetadata(agent.workspace_id || '');

      // Refresh workspace cache to remove the deleted agent
      await this.refreshWorkspaceCache(agent.workspace_id || '');

      logger.info('Agent deleted successfully', { agentId, tenantId });

      return {
        success: true,
        message: 'Agent deleted successfully'
      };
    } catch (error) {
      logger.error('Failed to delete agent', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return {
        success: false,
        message: 'Failed to delete agent. Please try again or contact support.'
      };
    }
  }

  /**
   * Get agent by ID
   */
  async getAgentById(tenantId: string, agentId: string): Promise<{ success: boolean; agent?: Agent; message?: string }> {
    try {
      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      return {
        success: true,
        agent: agent as Agent
      };
    } catch (error) {
      logger.error('Failed to get agent by ID', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return {
        success: false,
        message: 'Failed to get agent'
      };
    }
  }

  /**
   * Get agent studio data with Redis caching
   * This loads all agent-related data including workflows, database connections, and integrations
   */
  private generateWorkflowColor(index: number): string {
    const colors = ["#22c55e", "#ef4444", "#60a5fa", "#f59e0b", "#a78bfa", "#14b8a6"];
    return colors[index % colors.length] || "#22c55e";
  }

  /**
   * Extract agent prompt from main workflow system prompt
   */
  private extractAgentPrompt(workflows: any[]): string | null {
    try {
      // Find the default workflow (main workflow)
      const defaultWorkflow = workflows.find(flow => flow.is_default === true);
      if (!defaultWorkflow || !defaultWorkflow.workflow_data) {
        return null;
      }

      // Extract system prompt from workflow data (already in minimal format from getAgentStudioHomeData)
      const workflowData = defaultWorkflow.workflow_data;
      if (workflowData.prompt && workflowData.prompt.system_prompt) {
        return workflowData.prompt.system_prompt;
      }

      return null;
    } catch (error) {
      logger.warn('Failed to extract agent prompt from workflow', { error });
      return null;
    }
  }

  /**
   * Load agent integrations with metadata from base integrations table
   * This joins agent_integrations (installed integrations) with integrations (catalog)
   */
  private async loadAgentIntegrationsWithMetadata(agentId: string): Promise<any[]> {
    try {
      // Get installed integrations for this agent
      const agentIntegrations = await this.agentIntegrationsRepository.getIntegrationsByAgent(agentId);

      // Enrich with metadata from the base integrations table
      const integrationsWithMetadata = await Promise.all(
        agentIntegrations.map(async (agentIntegration: any) => {
          // If integration_id is set, fetch metadata from base integrations table
          if (agentIntegration.integration_id) {
            try {
              const baseIntegration = await this.integrationsRepository.getIntegrationById(agentIntegration.integration_id);

              if (baseIntegration) {
                return {
                  id: agentIntegration.id,
                  agent_id: agentIntegration.agent_id,
                  workflow_id: agentIntegration.workflow_id,
                  channel: agentIntegration.channel,
                  webhook_url: agentIntegration.webhook_url,
                  config: agentIntegration.config,
                  is_enabled: agentIntegration.is_enabled,
                  installed_version: agentIntegration.installed_version,
                  latest_version: agentIntegration.latest_version,
                  update_available: agentIntegration.update_available,
                  // Metadata from base integrations table
                  metadata: baseIntegration.metadata,
                  integration_status: baseIntegration.status,
                  integration_channel: baseIntegration.channel,
                  created_at: agentIntegration.created_at,
                  updated_at: agentIntegration.updated_at
                };
              }
            } catch (error) {
              logger.warn('Failed to load base integration metadata', {
                error,
                integrationId: agentIntegration.integration_id
              });
            }
          }

          // Fallback: return agent integration without metadata if base integration not found
          return {
            id: agentIntegration.id,
            agent_id: agentIntegration.agent_id,
            workflow_id: agentIntegration.workflow_id,
            channel: agentIntegration.channel,
            webhook_url: agentIntegration.webhook_url,
            config: agentIntegration.config,
            is_enabled: agentIntegration.is_enabled,
            installed_version: agentIntegration.installed_version,
            latest_version: agentIntegration.latest_version,
            update_available: agentIntegration.update_available,
            metadata: null,
            integration_status: null,
            created_at: agentIntegration.created_at,
            updated_at: agentIntegration.updated_at
          };
        })
      );

      return integrationsWithMetadata;
    } catch (error) {
      logger.error('Failed to load agent integrations with metadata', { error, agentId });
      return [];
    }
  }

  /**
   * Aggregate knowledge tables from flows' knowledge_tables jsonb column
   */


  /**
   * Get minimal agent data for studio homepage (optimized for performance)
   * Public method with timeout wrapper
   */
  async getAgentStudioHomeData(tenantId: string, agentId: string): Promise<GetAgentStudioDataResponse> {
    try {
      return await this.withTimeout(
        this._getAgentStudioHomeDataInternal(tenantId, agentId),
        30000, // 30 second timeout
        'Agent studio home data load timed out'
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        logger.error('Agent studio home data request timed out', { tenantId, agentId });
        return {
          success: false,
          message: 'Request timed out. Please try again.'
        };
      }
      throw error;
    }
  }

  /**
   * Internal implementation for getAgentStudioHomeData
   */
  private async _getAgentStudioHomeDataInternal(tenantId: string, agentId: string): Promise<GetAgentStudioDataResponse> {
    try {
      // Check Redis cache first with error handling
      const cacheKey = `agent:studio:home:${agentId}`;

      let cachedData: AgentStudioData | null = null;
      try {
        cachedData = await this.redisCircuitBreaker.execute(async () =>
          await redisClient.getJson<AgentStudioData>(cacheKey)
        );
      } catch (cacheError) {
        logger.warn('Failed to read from cache, falling back to database', {
          agentId,
          error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
          circuitState: this.redisCircuitBreaker.getState()
        });
        // Continue to load from database
      }

      if (cachedData) {
        // Validate cached data structure before returning
        if (!cachedData.agent || !cachedData.agent.id || !cachedData.agent.name) {
          logger.warn('Cached agent studio data has invalid structure, falling back to database', {
            agentId,
            tenantId,
            hasAgent: !!cachedData.agent,
            hasAgentId: !!(cachedData.agent?.id),
            hasAgentName: !!(cachedData.agent?.name)
          });
          // Clear invalid cache and continue to database
          try {
            await redisClient.deleteKey(cacheKey);
          } catch (deleteError) {
            logger.warn('Failed to delete invalid cache entry', { error: deleteError });
          }
          // Continue to load from database below
        } else {
          logger.info('Agent studio home data loaded from cache', { agentId, tenantId });
          return {
            success: true,
            data: cachedData
          };
        }
      }

      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      // Load only essential workflow data for homepage
      let workflows: any[] = [];
      let knoledge: any[] = [];
      try {
        // Workflows functionality removed
        workflows = [];
        knoledge = [];
        logger.info('Agent workflows loaded for homepage (empty)', { agentId });
      } catch (workflowError) {
        logger.warn('Failed to load workflows for agent studio homepage', { workflowError, agentId });
      }

      // Extract agent prompt from main workflow
      const agentPrompt = this.extractAgentPrompt(workflows);

      // Load integrations for homepage with metadata from base integrations table
      let integrations: any[] = [];
      try {
        integrations = await this.loadAgentIntegrationsWithMetadata(agentId);
        logger.info('Agent integrations loaded for homepage', { agentId, integrationCount: integrations.length });
      } catch (integrationError) {
        logger.warn('Failed to load integrations for agent studio homepage', { integrationError, agentId });
      }

      // Load only essential data for homepage
      const studioData: AgentStudioData = {
        agent: {
          ...agent as Agent,
          prompt: agentPrompt // Add extracted prompt to agent data
        },
        workflows: workflows,
        tables: [], // Tables functionality removed
        databaseConnections: [], // Required by AgentStudioData; none on home payload
        integrations: integrations
      };

      // Attach knoledge array sourced from flows
      try {
        (studioData as any).knoledge = knoledge;
      } catch { }

      // Cache the minimal data for 30 minutes (1800 seconds) with error handling
      try {
        await this.redisCircuitBreaker.execute(async () => {
          await redisClient.setJson(cacheKey, studioData, 1800);
          // Invalidate full studio cache when home cache is set (to ensure consistency)
          await redisClient.deleteKey(`agent:studio:${agentId}`);
        });
      } catch (cacheError) {
        logger.warn('Failed to cache agent studio home data', {
          agentId,
          error: cacheError instanceof Error ? cacheError.message : 'Unknown error'
        });
        // Continue even if caching fails
      }

      logger.info('Agent studio home data loaded and cached', { agentId, tenantId });

      return {
        success: true,
        data: studioData
      };
    } catch (error) {
      logger.error('Failed to get agent studio home data', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return {
        success: false,
        message: 'Failed to load agent studio home data'
      };
    }
  }

  /**
   * Get full agent studio data (agent + workflows + database connections)
   * Public method with timeout wrapper
   */
  async getAgentStudioData(tenantId: string, agentId: string): Promise<GetAgentStudioDataResponse> {
    try {
      return await this.withTimeout(
        this._getAgentStudioDataInternal(tenantId, agentId),
        30000, // 30 second timeout
        'Agent studio data load timed out'
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        logger.error('Agent studio data request timed out', { tenantId, agentId });
        return {
          success: false,
          message: 'Request timed out. Please try again.'
        };
      }
      throw error;
    }
  }

  /**
   * Internal implementation for getAgentStudioData
   */
  private async _getAgentStudioDataInternal(tenantId: string, agentId: string): Promise<GetAgentStudioDataResponse> {
    try {
      // Check Redis cache first with error handling
      const cacheKey = `agent:studio:${agentId}`;

      let cachedData: AgentStudioData | null = null;
      try {
        cachedData = await this.redisCircuitBreaker.execute(async () =>
          await redisClient.getJson<AgentStudioData>(cacheKey)
        );
      } catch (cacheError) {
        logger.warn('Failed to read from cache, falling back to database', {
          agentId,
          error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
          circuitState: this.redisCircuitBreaker.getState()
        });
        // Continue to load from database
      }

      if (cachedData) {
        logger.info('Agent studio data loaded from cache', { agentId, tenantId });
        return {
          success: true,
          data: cachedData
        };
      }

      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      // Load workflows using AgentFlowsRepository
      let workflows: any[] = [];
      try {
        // Workflows functionality removed
        workflows = [];
        logger.info('Agent workflows loaded (empty)', { agentId });
      } catch (workflowError) {
        logger.warn('Failed to load workflows for agent studio', { workflowError, agentId });
      }

      // Load integrations for studio with metadata from base integrations table
      let integrations: any[] = [];
      try {
        integrations = await this.loadAgentIntegrationsWithMetadata(agentId);
        logger.info('Agent integrations loaded for studio', { agentId, integrationCount: integrations.length });
      } catch (integrationError) {
        logger.warn('Failed to load integrations for agent studio', { integrationError, agentId });
      }

      // Construct studio data with loaded workflows and integrations
      // Also include knoledge aggregated from flows and remove databaseConnections
      let knoledge: any[] = [];
      try {
        // Workflows functionality removed
        knoledge = [];
      } catch (e) {
        logger.warn('Failed to aggregate knoledge for studio data', { agentId, error: e instanceof Error ? e.message : e });
      }
      const studioData: AgentStudioData = {
        agent: agent as Agent,
        workflows: workflows,
        tables: [], // Tables functionality removed
        databaseConnections: [], // Required by AgentStudioData; currently none loaded here
        integrations: integrations
      };

      try {
        (studioData as any).knoledge = knoledge;
      } catch { }

      // Cache the data for 1 hour (3600 seconds) with error handling
      try {
        await this.redisCircuitBreaker.execute(async () => {
          await redisClient.setJson(cacheKey, studioData, 3600);
        });
      } catch (cacheError) {
        logger.warn('Failed to cache agent studio data', {
          agentId,
          error: cacheError instanceof Error ? cacheError.message : 'Unknown error'
        });
        // Continue even if caching fails
      }

      logger.info('Agent studio data loaded and cached', { agentId, tenantId });

      return {
        success: true,
        data: studioData
      };
    } catch (error) {
      logger.error('Failed to get agent studio data', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return {
        success: false,
        message: 'Failed to load agent studio data'
      };
    }
  }

  /**
   * Get agent workflows with full data
   */
  async getAgentWorkflows(tenantId: string, agentId: string): Promise<{
    success: boolean;
    workflows?: any[];
    message?: string;
  }> {
    try {
      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      // Load full workflow data
      let workflows: any[] = [];
      try {
        // Workflows functionality removed
        workflows = [];
        logger.info('Agent workflows loaded (empty)', { agentId });
      } catch (workflowError) {
        logger.warn('Failed to load workflows for agent', { workflowError, agentId });
        return {
          success: false,
          message: 'Failed to load workflows'
        };
      }

      return {
        success: true,
        workflows: workflows
      };
    } catch (error) {
      logger.error('Failed to get agent workflows', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return {
        success: false,
        message: 'Failed to load workflows'
      };
    }
  }

  /**
   * Get agent integrations
   */
  async getAgentIntegrations(tenantId: string, agentId: string): Promise<{
    success: boolean;
    integrations?: any[];
    message?: string;
  }> {
    try {
      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      // Load integrations with metadata from base integrations table
      let integrations: any[] = [];
      try {
        integrations = await this.loadAgentIntegrationsWithMetadata(agentId);
        logger.info('Agent integrations loaded', { agentId, integrationCount: integrations.length });
      } catch (integrationError) {
        logger.warn('Failed to load integrations for agent', { integrationError, agentId });
        // Don't fail the entire request if integrations fail to load
      }

      return {
        success: true,
        integrations: integrations
      };
    } catch (error) {
      logger.error('Failed to get agent integrations', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return {
        success: false,
        message: 'Failed to load integrations'
      };
    }
  }

  /**
   * Get agent database connections
   */
  async getAgentDatabaseConnections(tenantId: string, agentId: string): Promise<{
    success: boolean;
    databaseConnections?: any[];
    message?: string;
  }> {
    try {
      // Validate inputs
      const tenantIdValidation = tenantIdSchema.validate(tenantId);
      if (tenantIdValidation.error) {
        return {
          success: false,
          message: 'Invalid tenant ID'
        };
      }

      if (!agentId || typeof agentId !== 'string' || agentId.length === 0) {
        return {
          success: false,
          message: 'Invalid agent ID'
        };
      }

      // Verify agent access
      const { authorized, agent, message } = await this.verifyAgentAccess(tenantId, agentId);
      if (!authorized || !agent) {
        return {
          success: false,
          message: message || 'Access denied'
        };
      }

      // TODO: Load database connections from database service
      // For now, return empty array
      const databaseConnections: any[] = [];

      return {
        success: true,
        databaseConnections: databaseConnections
      };
    } catch (error) {
      logger.error('Failed to get agent database connections', {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        tenantId,
        agentId
      });
      return {
        success: false,
        message: 'Failed to load database connections'
      };
    }
  }

  /**
   * Health check for service dependencies
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    try {
      // Test database connection by attempting to find a non-existent agent
      // This won't create anything but will test the connection
      await this.agentsRepository.findById('health-check-test-id-that-does-not-exist');

      // Test Redis connection
      await redisClient.ping();

      return {
        healthy: true,
        details: {
          database: 'connected',
          redis: 'connected'
        }
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          database: 'error',
          redis: 'error'
        }
      };
    }
  }
}

// Export singleton instance for backward compatibility
// New code should use dependency injection instead
const agentServiceInstance = new AgentService();
export default agentServiceInstance;
