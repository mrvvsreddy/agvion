// types/workflow.ts

import { UUID } from "crypto";

/**
 * Database workflow structure matching the workflows table
 */
export interface DbWorkflow {
  id: string;
  name: string;
  tenant_id: string;
  agent_id: string;
  workflow_data: any; // JSON data containing steps, actions, etc.
  status: string;
  workflow_version: string;
  settings: any;
  metadata: any;
  created_at: string; // timestamp
  last_modified_at: string;
  last_modified_by: string;
}

/**
 * Workflow trigger configuration
 */
export interface WorkflowTrigger {
  type: string; // Maps to trigger_type in DB
  value: string; // Maps to trigger_value in DB
  config?: Record<string, any>; // Additional trigger configuration
  // Optional execution properties (when trigger needs to execute code)
  id?: string;
  name?: string;
  integration?: string;
  function?: string;
}

/**
 * Individual workflow step/action
 */
export interface WorkflowStep {
  type: string; // Step type (e.g., 'http_request', 'email', 'condition')
  id: string;
  name: string;
  integration: string;
  function: string;
  config: Record<string, any>;
  order?: number; // Step execution order
  enabled?: boolean; // Whether step is active
}

/**
 * Enhanced workflow node with new structure
 */
export interface WorkflowNode {
  id: string;
  name: string;
  type: 'trigger' | 'agent' | 'action';
  disabled?: boolean;
  position: { x: number; y: number };
  config?: Record<string, any>;
  function?: string;
  integration?: string;
  integrationName?: string;
  credentials?: Record<string, any>;
  agentConfig?: AgentNodeConfig;
  metadata?: Record<string, any>;
}

/**
 * Enhanced agent node configuration
 */
export interface AgentNodeConfig {
  llm: LLMConfig;
  tools?: ToolConfig[];
  memory?: MemoryConfig;
  systemPrompt: string;
}

/**
 * LLM configuration with new structure
 */
export interface LLMConfig {
  model: string;
  provider: string;
  maxTokens?: number;
  userPrompt: string; // Moved from top level
  credentials?: Record<string, any>;
  integration?: string;
  temperature?: number;
}

/**
 * Tool configuration for agent nodes
 */
export interface ToolConfig {
  name: string;
  type: string;
  operation: string;
  description?: string;
  integrationName: string;
  credentials?: Record<string, any>;
  topK?: number;
  similarityThreshold?: number;
  [key: string]: any; // Allow additional tool-specific properties
}

/**
 * Memory configuration for agent nodes
 */
export interface MemoryConfig {
  type: string;
  operation: string[];
  sessionId: string;
  maxContextLength?: number;
  credentials?: Record<string, any>;
  integrationName: string;
  autoCreateTable?: boolean;
}

/**
 * Enhanced workflow definition with new node structure
 */
export interface EnhancedWorkflowDefinition {
  id: string;
  name: string;
  version?: string;
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
  agentId?: string;
  metadata?: Record<string, any>;
}

/**
 * Workflow edge definition
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

/**
 * Core workflow definition structure
 */
export interface WorkflowDefinition {
  id: string;
  agentId: string; // Maps to agentId in DB
  name: string;
  trigger: WorkflowTrigger; // Changed from WorkflowStep to WorkflowTrigger
  steps: WorkflowStep[]; // Added steps property
  actions: WorkflowStep[]; // Actions are also WorkflowSteps
  description?: string;
  version?: string;
  metadata?: Record<string, any>;
  nodes?: any[]; // Optional nodes array for canvas data
  edges?: any[]; // Optional edges array for canvas data
}

/**
 * Extended workflow definition with database-specific properties
 */
export interface ExtendedWorkflowDefinition extends WorkflowDefinition {
  status: string; // Maps to status in DB ('active', 'inactive', 'draft', etc.)
  createdAt: string; // Maps to created_at in DB
}

/**
 * Workflow execution context
 */
export interface WorkflowContext {
  workflowId: UUID;
  agentId: string;
  executionId: string;
  triggerData: Record<string, any>;
  variables: Record<string, any>;
  metadata: Record<string, any>;
}

/**
 * Workflow execution result
 */
export interface WorkflowExecutionResult {
  success: boolean;
  workflowId: string;
  executionId: string;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
  data?: Record<string, any>;
  duration?: number;
}

/**
 * Workflow query criteria
 */
export interface WorkflowQueryCriteria {
  triggerType?: string;
  triggerId?: string;
  agentId?: string;
  status?: string;
  includeInactive?: boolean;
}

/**
 * Workflow validation result
 */
export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Workflow statistics
 */
export interface WorkflowStats {
  totalWorkflows: number;
  activeWorkflows: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
}

/**
 * Workflow creation/update payload
 */
export interface WorkflowPayload {
  name: string;
  agentId: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  actions: WorkflowStep[];
  nodes?: any[];
  edges?: any[];
  description?: string;
  version?: string;
  metadata?: Record<string, any>;
  status?: string;
}

/**
 * Type guards for runtime type checking
 */
export function isWorkflowDefinition(obj: any): obj is WorkflowDefinition {
  return obj && 
    typeof obj.id === 'string' &&
    typeof obj.agentId === 'string' &&
    typeof obj.name === 'string' &&
    obj.trigger &&
    typeof obj.trigger.type === 'string' &&
    typeof obj.trigger.value === 'string' &&
    Array.isArray(obj.steps) &&
    Array.isArray(obj.actions);
}

export function isWorkflowStep(obj: any): obj is WorkflowStep {
  return obj &&
    typeof obj.type === 'string' &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.integration === 'string' &&
    typeof obj.function === 'string' &&
    typeof obj.config === 'object';
}

/**
 * Workflow status constants
 */
export const WorkflowStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  DRAFT: 'draft',
  ARCHIVED: 'archived',
  ERROR: 'error'
} as const;

export type WorkflowStatusType = typeof WorkflowStatus[keyof typeof WorkflowStatus];

/**
 * Common trigger types
 */
export const TriggerType = {
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
  EMAIL: 'email',
  API: 'api',
  DATABASE: 'database',
  FILE: 'file'
} as const;

export type TriggerTypeType = typeof TriggerType[keyof typeof TriggerType];

/**
 * Common step types
 */
export const StepType = {
  HTTP_REQUEST: 'http_request',
  EMAIL: 'email',
  SMS: 'sms',
  DATABASE: 'database',
  CONDITION: 'condition',
  LOOP: 'loop',
  DELAY: 'delay',
  TRANSFORM: 'transform',
  WEBHOOK: 'webhook'
} as const;

export type StepTypeType = typeof StepType[keyof typeof StepType];

/**
 * Helper function to create a workflow definition from database data
 */
export function createWorkflowDefinitionFromDb(dbWorkflow: DbWorkflow): ExtendedWorkflowDefinition {
  const workflowData = dbWorkflow.workflow_data || {};
  
  return {
    id: dbWorkflow.id,
    name: dbWorkflow.name || `Workflow-${dbWorkflow.id}`,
    agentId: dbWorkflow.agent_id,
    trigger: {
      type: 'none', // Triggers are managed separately now
      value: '',
      config: {}
    },
    steps: workflowData.steps || [],
    actions: workflowData.actions || [],
    description: workflowData.description || '',
    version: dbWorkflow.workflow_version || '1.0.0',
    status: dbWorkflow.status,
    createdAt: dbWorkflow.created_at,
    nodes: workflowData.nodes || [],
    edges: workflowData.edges || [],
    metadata: dbWorkflow.metadata || {}
  };
}

/**
 * Helper function to convert workflow definition to database format
 */
export function convertWorkflowToDbFormat(workflow: WorkflowDefinition | WorkflowPayload): Omit<DbWorkflow, 'id' | 'created_at'> {
  return {
    name: workflow.name,
    tenant_id: '', // This should be provided by the calling context
    agent_id: workflow.agentId,
    workflow_data: {
      name: workflow.name,
      description: workflow.description,
      steps: workflow.steps || [],
      actions: workflow.actions || [],
      nodes: workflow.nodes || [],
      edges: workflow.edges || [],
      metadata: workflow.metadata || {}
    },
    status: (workflow as any).status || 'draft',
    workflow_version: workflow.version || '1.0.0',
    settings: {},
    metadata: workflow.metadata || {},
    last_modified_at: new Date().toISOString(),
    last_modified_by: 'user'
  };
}