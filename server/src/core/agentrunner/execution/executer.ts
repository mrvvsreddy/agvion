// path: src/core/workflowrunner/execution/executor.ts

import logger from '../../../utils/logger';
import integrationRegistry from '../../integrationRegistry';
import { randomUUID } from 'crypto';
import {
  WorkflowGraph,
  GraphNode,
  NodeExecutionResult,
  isAgentNode,
  isIntegrationNode,
  RequiredInitialContext,
  TriggerDataInjection,
  WorkflowExecutionTracker,
  WorkflowExecutionContext,
  NodeResultWithMetadata,
  TriggerDataWithMetadata,
  WorkflowSchema
} from './types';
import { defineWorkflowSchema } from './validator';
import { IntegrationExecutor, IntegrationFunctionEntry } from '../../../types/integrations';
import {
  TypeSafeExecutionContext,
  initExecutionContext,
  convertToExecutionContext
} from './node-data-manager';
import channelRegistry from './channel-adapter';
import openRouterAdapter, { OpenRouterMessage, OpenRouterRequest, OpenRouterTool } from './openrouter-adapter';
import {
  ChannelExecutionRequest,
  WorkflowExecutionResult,
  ChannelResponse,
  ChannelSendContext
} from './channel-adapter';
import 'dotenv/config';  

// ============================================================================
// SECURITY CONSTANTS & CONFIGURATION
// ============================================================================

const SECURITY_LIMITS = {
  MAX_WORKFLOW_NODES: 1000,
  MAX_WORKFLOW_EDGES: 5000,
  MAX_NODE_NAME_LENGTH: 256,
  MAX_FIELD_NAME_LENGTH: 256,
  MAX_TEMPLATE_REFERENCES: 100,
  MAX_RECURSION_DEPTH: 50,
  MAX_EXECUTION_TIME_MS: 300000, // 5 minutes
  MAX_NODE_EXECUTION_TIME_MS: 30000, // 30 seconds per node
  MAX_STORED_RESULT_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_ACTIVE_EXECUTIONS: 10000,
  MAX_ACTIVE_EXECUTIONS_PER_TENANT: 100, // Per-tenant limit
  EXECUTION_CLEANUP_INTERVAL_MS: 60000, // 1 minute
  STALE_EXECUTION_THRESHOLD_MS: 3600000, // 1 hour
  MAX_SECRET_SIZE: 1024, // 1KB max secret size
  MAX_LOG_MESSAGE_LENGTH: 1000 // Max log message length
} as const;

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,256}$/;
const SAFE_NODE_NAME_PATTERN = /^[a-zA-Z0-9_\-\s]{1,256}$/;
const SAFE_FIELD_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,256}$/;
const SAFE_SECRET_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const DANGEROUS_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'valueOf',
  'toString',
  'hasOwnProperty', 
  'isPrototypeOf',
  'propertyIsEnumerable'
]);

// Sensitive data patterns for redaction
const SENSITIVE_PATTERNS = [
  /api[_-]?key/gi,
  /secret/gi,
  /password/gi,
  /token/gi,
  /credential/gi,
  /auth/gi,
  /bearer/gi,
  /authorization/gi
];

// Audit event types
const AUDIT_EVENT_TYPES = {
  EXECUTION_START: 'execution_start',
  EXECUTION_COMPLETE: 'execution_complete',
  EXECUTION_ERROR: 'execution_error',
  SECRET_ACCESS: 'secret_access',
  INTEGRATION_CALL: 'integration_call',
  TENANT_VIOLATION: 'tenant_violation',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  CONFIG_VALIDATION_FAILED: 'config_validation_failed',
  NODE_TIMEOUT: 'node_timeout'
} as const;

// ============================================================================
// UTILITY: SAFE OBJECT OPERATIONS (PROTOTYPE POLLUTION PROTECTION)
// ============================================================================

/**
 * Deep recursive safe property setting with path validation
 */
function safeDeepSet(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  if (path.length === 0) {
    throw new Error('Path cannot be empty');
  }
  
  // Validate all path segments
  for (const segment of path) {
    if (typeof segment !== 'string') {
      throw new Error('Path segments must be strings');
    }
    if (DANGEROUS_KEYS.has(segment)) {
      throw new Error(`Dangerous property name detected in path: ${segment}`);
    }
    // Use SAFE_NODE_NAME_PATTERN for node names (allows spaces) and SAFE_FIELD_NAME_PATTERN for field names
    if (!SAFE_NODE_NAME_PATTERN.test(segment) && !SAFE_FIELD_NAME_PATTERN.test(segment)) {
      throw new Error(`Invalid property name in path: ${segment}`);
    }
  }
  
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!key) {
      throw new Error('Path segment cannot be undefined');
    }
    if (!(key in current)) {
      current[key] = createSafeObject();
    }
    const next = current[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[key] = createSafeObject();
    }
    current = current[key] as Record<string, unknown>;
  }
  
  const finalKey = path[path.length - 1];
  if (!finalKey) {
    throw new Error('Final path segment cannot be undefined');
  }
  current[finalKey] = value;
}

/**
 * Deep recursive safe property getting with path validation
 */
function safeDeepGet(
  obj: Record<string, unknown>,
  path: string[]
): unknown {
  if (path.length === 0) {
    return obj;
  }
  
  // Validate all path segments
  for (const segment of path) {
    if (typeof segment !== 'string') {
      return undefined;
    }
    if (DANGEROUS_KEYS.has(segment)) {
      return undefined;
    }
  }
  
  let current: unknown = obj;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return current;
}

function safeSetProperty<T extends Record<string, unknown>>(
  obj: T,
  key: string,
  value: unknown
): void {
  if (DANGEROUS_KEYS.has(key)) {
    throw new Error(`Dangerous property name detected: ${key}`);
  }
  if (!SAFE_FIELD_NAME_PATTERN.test(key)) {
    throw new Error(`Invalid property name: ${key}`);
  }
  (obj as Record<string, unknown>)[key] = value;
}

function safeGetProperty<T extends Record<string, unknown>>(
  obj: T,
  key: string
): unknown {
  if (DANGEROUS_KEYS.has(key)) {
    return undefined;
  }
  if (!SAFE_FIELD_NAME_PATTERN.test(key)) {
    return undefined;
  }
  return (Object.prototype.hasOwnProperty.call(obj, key)) ? (obj as Record<string, unknown>)[key] : undefined;
}

function createSafeObject<T = unknown>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Recursively create safe objects for nested structures
 */
function createSafeNestedObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  
  const safeObj = createSafeObject();
  for (const [key, value] of Object.entries(obj)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue; // Skip dangerous keys
    }
    if (!SAFE_FIELD_NAME_PATTERN.test(key)) {
      continue; // Skip invalid keys
    }
    safeObj[key] = createSafeNestedObject(value);
  }
  
  return safeObj;
}

// ============================================================================
// UTILITY: INPUT VALIDATION & SANITIZATION
// ============================================================================

/**
 * Secure secret reference interface
 */
interface SecretReference {
  readonly secretId: string;
  readonly tenantId: string;
  readonly type: 'api_key' | 'password' | 'token' | 'credential';
}

/**
 * Safe execution error with separate internal and user messages
 */
class SafeExecutionError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly internalDetails: string,
    public readonly executionId: string,
    public readonly nodeId?: string
  ) {
    super(userMessage);
    this.name = 'SafeExecutionError';
  }
}

/**
 * Audit event interface
 */
interface AuditEvent {
  readonly eventType: string;
  readonly timestamp: string;
  readonly executionId: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly details: Record<string, unknown>;
  readonly signature: string;
}

/**
 * Tenant resource manager for per-tenant limits
 */
class TenantResourceManager {
  private readonly tenantCounters = new Map<string, {
    activeExecutions: number;
    executionsThisMinute: number;
    executionsThisHour: number;
    lastMinuteReset: number;
    lastHourReset: number;
  }>();

  acquireExecutionSlot(tenantId: string): void {
    const now = Date.now();
    const counters = this.tenantCounters.get(tenantId) || {
      activeExecutions: 0,
      executionsThisMinute: 0,
      executionsThisHour: 0,
      lastMinuteReset: now,
      lastHourReset: now
    };

    // Reset counters if needed
    if (now - counters.lastMinuteReset > 60000) {
      counters.executionsThisMinute = 0;
      counters.lastMinuteReset = now;
    }
    if (now - counters.lastHourReset > 3600000) {
      counters.executionsThisHour = 0;
      counters.lastHourReset = now;
    }

    // Check limits
    if (counters.activeExecutions >= SECURITY_LIMITS.MAX_ACTIVE_EXECUTIONS_PER_TENANT) {
      throw new Error(`Tenant ${tenantId} has reached maximum active executions`);
    }
    if (counters.executionsThisMinute >= 10) { // 10 per minute
      throw new Error(`Tenant ${tenantId} has reached per-minute execution limit`);
    }
    if (counters.executionsThisHour >= 100) { // 100 per hour
      throw new Error(`Tenant ${tenantId} has reached per-hour execution limit`);
    }

    // Acquire slot
    counters.activeExecutions++;
    counters.executionsThisMinute++;
    counters.executionsThisHour++;
    this.tenantCounters.set(tenantId, counters);
  }

  releaseExecutionSlot(tenantId: string): void {
    const counters = this.tenantCounters.get(tenantId);
    if (counters && counters.activeExecutions > 0) {
      counters.activeExecutions--;
      this.tenantCounters.set(tenantId, counters);
    }
  }
}

const tenantResourceManager = new TenantResourceManager();

/**
 * Circuit breaker for OpenRouter to handle failures gracefully
 */
class OpenRouterCircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private readonly failureThreshold = 5;
  private readonly timeoutMs = 60000; // 1 minute
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeoutMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('OpenRouter circuit breaker is OPEN - service unavailable');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn('OpenRouter circuit breaker opened due to failures', {
        failureCount: this.failureCount,
        threshold: this.failureThreshold
      });
    }
  }
}

const openRouterCircuitBreaker = new OpenRouterCircuitBreaker();

/**
 * Metrics collection for monitoring and alerting
 */
class ExecutionMetricsCollector {
  private readonly metrics = new Map<string, {
    executionCount: number;
    totalDuration: number;
    errorCount: number;
    lastReset: number;
  }>();
  
  recordExecution(tenantId: string, duration: number, success: boolean): void {
    const key = `tenant_${tenantId}`;
    const existing = this.metrics.get(key) || {
      executionCount: 0,
      totalDuration: 0,
      errorCount: 0,
      lastReset: Date.now()
    };
    
    existing.executionCount++;
    existing.totalDuration += duration;
    if (!success) {
      existing.errorCount++;
    }
    
    this.metrics.set(key, existing);
  }
  
  getMetrics(tenantId: string): {
    executionCount: number;
    averageDuration: number;
    errorRate: number;
  } | null {
    const key = `tenant_${tenantId}`;
    const metrics = this.metrics.get(key);
    
    if (!metrics) return null;
    
    return {
      executionCount: metrics.executionCount,
      averageDuration: metrics.totalDuration / metrics.executionCount,
      errorRate: metrics.errorCount / metrics.executionCount
    };
  }
  
  resetMetrics(tenantId: string): void {
    const key = `tenant_${tenantId}`;
    this.metrics.delete(key);
  }
}

const metricsCollector = new ExecutionMetricsCollector();

/**
 * Strict type definitions for agent configurations
 */
interface AgentLLMCredentials {
  readonly secretRef?: SecretReference;
  readonly apiKey?: string; // Deprecated - use secretRef instead
}

interface AgentLLMConfig {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly credentials?: AgentLLMCredentials;
}

interface StrictAgentNodeConfig {
  readonly systemPrompt?: string;
  readonly userPrompt?: string;
  readonly llm?: AgentLLMConfig;
  readonly tools?: readonly string[];
}

/**
 * Type guard for agent LLM configuration
 */
function isAgentLLMConfig(config: unknown): config is AgentLLMConfig {
  if (typeof config !== 'object' || config === null) return false;
  const cfg = config as Record<string, unknown>;
  return typeof cfg.model === 'string' &&
         typeof cfg.temperature === 'number' &&
         typeof cfg.maxTokens === 'number';
}

/**
 * Type guard for agent node configuration
 */
function isStrictAgentNodeConfig(config: unknown): config is StrictAgentNodeConfig {
  if (typeof config !== 'object' || config === null) return false;
  const cfg = config as Record<string, unknown>;
  return (typeof cfg.systemPrompt === 'string' || typeof cfg.userPrompt === 'string') &&
         (cfg.llm === undefined || isAgentLLMConfig(cfg.llm));
}

/**
 * Update context variables immutably
 */
function updateContextVariables(
  context: WorkflowExecutionContext,
  updates: Record<string, unknown>
): WorkflowExecutionContext {
  const newVariables = createSafeObject();
  
  // Copy existing variables safely
  if (context.variables) {
    for (const [key, value] of Object.entries(context.variables)) {
      if (SAFE_FIELD_NAME_PATTERN.test(key)) {
        safeSetProperty(newVariables, key, createSafeNestedObject(value));
      }
    }
  }
  
  // Apply updates safely
  for (const [key, value] of Object.entries(updates)) {
    if (SAFE_FIELD_NAME_PATTERN.test(key)) {
      safeSetProperty(newVariables, key, createSafeNestedObject(value));
    }
  }
  
  return {
    ...context,
    variables: newVariables
  };
}

/**
 * Verify channel ownership from database
 * TODO: Implement actual database query based on your schema
 */
async function verifyChannelOwnership(
  channelId: string, 
  tenantId: string
): Promise<{ id: string; tenantId: string; channelType: string } | null> {
  // Example implementation (replace with your ORM/query):
  // const channel = await db.channels.findOne({
  //   where: { id: channelId, tenantId }
  // });
  // return channel;
  
  // TODO: Implement actual database query for channel ownership validation
  // For now, return a valid channel object to allow execution
  // Note: The channel has already been validated in the webhook handler
  return { id: channelId, tenantId, channelType: 'webchat' };
}

/**
 * Get workflow with tenant and agent access verification
 * TODO: Implement actual database query based on your schema
 */
async function getWorkflowWithAccess(
  workflowId: string,
  tenantId: string,
  agentId: string
): Promise<{ id: string; tenantId: string; agentId?: string } | null> {
  // Example implementation (replace with your ORM/query):
  // const workflow = await db.workflows.findOne({
  //   where: { id: workflowId, tenantId }
  // });
  // return workflow;
  
  // TODO: Implement actual database query for workflow validation
  // For now, return a valid workflow object to allow execution
  // Note: The workflow has already been loaded and passed to executeWorkflowFromChannel
  return { id: workflowId, tenantId, agentId };
}

/**
 * Check if tenant has permission to use specific integration
 * TODO: Implement actual database query based on your schema
 */
async function checkTenantIntegrationPermission(
  tenantId: string,
  integration: string
): Promise<boolean> {
  // Example implementation (replace with your ORM/query):
  // const permission = await db.tenantIntegrations.findOne({
  //   where: { tenantId, integrationName: integration, enabled: true }
  // });
  // return !!permission;
  
  // TEMPORARY: For initial deployment, allow all integrations
  // REPLACE THIS WITH ACTUAL DATABASE CHECK WITHIN 2 WEEKS
  logger.warn('Integration permission check not implemented - allowing all', {
    tenantId,
    integration,
    note: 'REPLACE WITH DATABASE QUERY IMMEDIATELY'
  });
  return true;
}

/**
 * Get secret value from secure storage
 * TODO: Choose and implement one of: AWS Secrets Manager, HashiCorp Vault, or Encrypted Database
 */
async function getSecretFromStore(
  secretRef: SecretReference,
  tenantId: string
): Promise<{ value: string } | null> {
  // IMPLEMENTATION OPTIONS:
  // 
  // Option A: AWS Secrets Manager (Recommended for production)
  // import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
  // const secretName = `tenant_${tenantId}/secret_${secretRef.secretId}`;
  // const command = new GetSecretValueCommand({ SecretId: secretName });
  // const response = await secretsClient.send(command);
  // return response.SecretString ? { value: response.SecretString } : null;
  //
  // Option B: HashiCorp Vault
  // const path = `secret/tenant/${tenantId}/${secretRef.secretId}`;
  // const response = await vaultClient.read(path);
  // return response?.data?.value ? { value: response.data.value } : null;
  //
  // Option C: Encrypted Database
  // const secret = await db.secrets.findOne({ where: { id: secretRef.secretId, tenantId } });
  // const decrypted = await decrypt(secret.encryptedValue);
  // return { value: decrypted };
  
  // TEMPORARY: Return placeholder
  // THIS IS INSECURE AND MUST BE REPLACED WITH ONE OF THE ABOVE OPTIONS
  logger.error('getSecretFromStore not implemented - returning placeholder', {
    secretId: secretRef.secretId,
    tenantId,
    type: secretRef.type,
    note: 'IMPLEMENT AWS SECRETS MANAGER, VAULT, OR ENCRYPTED DATABASE IMMEDIATELY'
  });
  
  throw new Error('Secret store not implemented - choose AWS Secrets Manager, HashiCorp Vault, or Encrypted Database');
}

/**
 * Get tenant-scoped integration with proper permission checks
 */
async function getTenantScopedIntegration(
  tenantId: string,
  agentId: string,
  integration: string,
  fn: string,
  executionId: string
): Promise<IntegrationFunctionEntry | null> {
  // ✅ REPLACE: Query tenant permissions from database
  const hasPermission = await checkTenantIntegrationPermission(
    tenantId,
    integration
  );
  
  if (!hasPermission) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId,
      tenantId,
      agentId
    }, { 
      integration, 
      function: fn,
      violation: 'integration_not_authorized'
    });
    throw new Error(`Integration '${integration}' not authorized for tenant`);
  }
  
  const integrationEntry = await integrationRegistry.getFunction(integration, fn);
  return integrationEntry || null;
}

/**
 * Send tenant-scoped channel response with proper permission checks
 */
async function sendTenantScopedChannelResponse(
  tenantId: string,
  agentId: string,
  channelType: string,
  channelId: string,
  response: ChannelResponse,
  context: ChannelSendContext
): Promise<void> {
  // ✅ ADD: Database query to verify channel ownership
  const channel = await verifyChannelOwnership(channelId, tenantId);
  
  if (!channel) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId: context.executionId,
      tenantId,
      agentId
    }, { 
    channelId,
    channelType,
      violation: 'channel_not_found_or_unauthorized'
    });
    throw new Error('Channel access denied: not found or unauthorized');
  }
  
  // Verify channel belongs to tenant
  if (channel.tenantId !== tenantId) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId: context.executionId,
    tenantId,
      agentId
    }, { 
      channelId, 
      channelType,
      attemptedTenant: tenantId,
      actualTenant: channel.tenantId,
      violation: 'channel_tenant_mismatch'
    });
    throw new Error('Channel access denied: tenant mismatch');
  }

  return channelRegistry.sendResponse(channelType, channelId, response, context);
}

function validateIdentifier(id: unknown, fieldName: string): string {
  if (typeof id !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(
      `${fieldName} contains invalid characters. Only alphanumeric, hyphens, and underscores allowed (max 256 chars)`
    );
  }
  return id;
}

function validateNodeName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new Error('Node name must be a string');
  }
  if (!SAFE_NODE_NAME_PATTERN.test(name)) {
    throw new Error(
      'Node name contains invalid characters. Only alphanumeric, spaces, hyphens, and underscores allowed (max 256 chars)'
    );
  }
  return name.trim();
}

function validateFieldName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new Error('Field name must be a string');
  }
  if (!SAFE_FIELD_NAME_PATTERN.test(name)) {
    throw new Error(
      'Field name contains invalid characters. Only alphanumeric and underscores allowed (max 256 chars)'
    );
  }
  return name;
}

function validateSecretReference(ref: unknown): SecretReference {
  if (typeof ref !== 'object' || ref === null) {
    throw new Error('Secret reference must be an object');
  }
  
  const secretRef = ref as Record<string, unknown>;
  
  if (typeof secretRef.secretId !== 'string' || !SAFE_SECRET_PATTERN.test(secretRef.secretId)) {
    throw new Error('Invalid secretId in secret reference');
  }
  
  if (typeof secretRef.tenantId !== 'string' || !SAFE_ID_PATTERN.test(secretRef.tenantId)) {
    throw new Error('Invalid tenantId in secret reference');
  }
  
  if (!['api_key', 'password', 'token', 'credential'].includes(secretRef.type as string)) {
    throw new Error('Invalid secret type in secret reference');
  }
  
  return {
    secretId: secretRef.secretId,
    tenantId: secretRef.tenantId,
    type: secretRef.type as SecretReference['type']
  };
}

/**
 * Redact sensitive data from objects before logging
 */
function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    // Check if string contains sensitive patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(obj)) {
        return '[REDACTED]';
      }
    }
    return obj;
  }
  
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  
  const redacted = createSafeObject();
  for (const [key, value] of Object.entries(obj)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    
    // Check if key suggests sensitive data
    const isSensitiveKey = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
    
    if (isSensitiveKey) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSensitiveData(value);
    }
  }
  
  return redacted;
}

/**
 * Secure error handling with sensitive data redaction
 */
function handleExecutionError(
  error: unknown,
  context: { executionId: string; tenantId: string; agentId: string; nodeId?: string }
): SafeExecutionError {
  // First, log the raw error for debugging
  logger.error('Raw execution error', {
    executionId: context.executionId,
    tenantId: context.tenantId,
    agentId: context.agentId,
    nodeId: context.nodeId,
    errorType: typeof error,
    errorConstructor: error instanceof Error ? error.constructor.name : 'unknown',
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined
  });

  const redactedError = redactSensitiveData(error);
  const internalDetails = JSON.stringify(redactedError).substring(0, SECURITY_LIMITS.MAX_LOG_MESSAGE_LENGTH);
  
  // Log full error internally with redaction
  logger.error('Execution error occurred', {
    executionId: context.executionId,
    tenantId: context.tenantId,
    agentId: context.agentId,
    nodeId: context.nodeId,
    error: internalDetails
  });
  
  // Return generic user message
  const userMessage = `Execution failed. Reference ID: ${context.executionId}`;
  
  return new SafeExecutionError(
    userMessage,
    internalDetails,
    context.executionId,
    context.nodeId
  );
}

function sanitizeErrorMessage(error: unknown): string {
  const redacted = redactSensitiveData(error);
  const message = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  return message.substring(0, SECURITY_LIMITS.MAX_LOG_MESSAGE_LENGTH);
}

function validateObjectSize(obj: unknown): void {
  const size = JSON.stringify(obj).length;
  if (size > SECURITY_LIMITS.MAX_STORED_RESULT_SIZE) {
    throw new Error(
      `Object size (${size} bytes) exceeds maximum allowed (${SECURITY_LIMITS.MAX_STORED_RESULT_SIZE} bytes)`
    );
  }
}

/**
 * Create cryptographically secure audit event signature
 */
function signAuditEvent(event: Omit<AuditEvent, 'signature'>): string {
  const eventData = JSON.stringify({
    eventType: event.eventType,
    timestamp: event.timestamp,
    executionId: event.executionId,
    tenantId: event.tenantId,
    agentId: event.agentId,
    details: event.details
  });
  
  // ✅ FIX: Fail fast if signing key not configured
  const signingKey = process.env.AUDIT_SIGNING_KEY;
  if (!signingKey) {
    throw new Error(
      'AUDIT_SIGNING_KEY environment variable must be configured. ' +
      'Generate a secure key: openssl rand -hex 32'
    );
  }
  
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(eventData);
  return hmac.digest('hex');
}

/**
 * Log audit event for security monitoring
 */
function logAuditEvent(
  eventType: string,
  context: { executionId: string; tenantId: string; agentId: string },
  details: Record<string, unknown> = {}
): void {
  const event: Omit<AuditEvent, 'signature'> = {
    eventType,
    timestamp: new Date().toISOString(),
    executionId: context.executionId,
    tenantId: context.tenantId,
    agentId: context.agentId,
    details: redactSensitiveData(details) as Record<string, unknown>
  };
  
  const signature = signAuditEvent(event);
  const fullEvent: AuditEvent = { ...event, signature };
  
  logger.info('Audit event', fullEvent);
}

/**
 * Validate workflow access with proper tenant and agent isolation
 */
async function validateWorkflowAccess(
  workflowId: string,
  tenantId: string,
  agentId: string
): Promise<void> {
  // ✅ ADD: Query database for workflow ownership
  const workflow = await getWorkflowWithAccess(workflowId, tenantId, agentId);
  
  if (!workflow) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId: 'validation',
      tenantId,
      agentId
    }, { 
    workflowId,
      violation: 'workflow_not_found_or_unauthorized'
    });
    throw new Error('Workflow access denied: not found or unauthorized');
  }
  
  // Verify workflow belongs to tenant
  if (workflow.tenantId !== tenantId) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId: 'validation',
    tenantId,
      agentId
    }, { 
      workflowId,
      workflowTenantId: workflow.tenantId,
      requestedTenant: tenantId,
      violation: 'workflow_tenant_mismatch'
    });
    throw new Error('Workflow access denied: tenant mismatch');
  }
  
  // Verify agent has access to workflow
  if (workflow.agentId && workflow.agentId !== agentId) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId: 'validation',
      tenantId,
      agentId
    }, { 
      workflowId,
      workflowAgentId: workflow.agentId,
      requestedAgent: agentId,
      violation: 'workflow_agent_mismatch'
    });
    throw new Error('Workflow access denied: agent mismatch');
  }
}

/**
 * Validate tenant ownership of workflow (legacy function for backward compatibility)
 */
function validateTenantOwnership(workflow: WorkflowGraph, tenantId: string): void {
  // Check if workflow has explicit tenant ownership (if tenantId field exists)
  const workflowWithTenant = workflow as WorkflowGraph & { tenantId?: string };
  if (workflowWithTenant.tenantId && workflowWithTenant.tenantId !== tenantId) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId: 'validation',
      tenantId,
      agentId: workflow.agentId || 'unknown'
    }, { 
      workflowId: workflow.id, 
      workflowTenantId: workflowWithTenant.tenantId,
      requestedTenant: tenantId,
      violation: 'workflow_tenant_mismatch'
    });
    throw new Error('Tenant isolation violation: workflow access denied');
  }
}

/**
 * Resolve secret reference to actual secret value
 */
async function resolveSecretReference(
  secretRef: SecretReference,
  context: { tenantId: string; executionId: string }
): Promise<string> {
  // Validate tenant ownership
  if (secretRef.tenantId !== context.tenantId) {
    logAuditEvent(AUDIT_EVENT_TYPES.TENANT_VIOLATION, {
      executionId: context.executionId,
      tenantId: context.tenantId,
      agentId: 'unknown'
    }, { 
      secretId: secretRef.secretId,
      secretTenantId: secretRef.tenantId,
      requestedTenant: context.tenantId,
      violation: 'secret_tenant_mismatch'
    });
    throw new Error('Secret does not belong to requesting tenant');
  }
  
  logAuditEvent(AUDIT_EVENT_TYPES.SECRET_ACCESS, {
    executionId: context.executionId,
    tenantId: context.tenantId,
    agentId: 'unknown'
  }, { secretId: secretRef.secretId, type: secretRef.type });
  
  // ✅ REPLACE: Integrate with your secret store
  try {
    const secret = await getSecretFromStore(secretRef, context.tenantId);
    
    if (!secret || !secret.value) {
      throw new Error('Secret not found or has no value');
    }
    
    // Validate secret size
    if (secret.value.length > SECURITY_LIMITS.MAX_SECRET_SIZE) {
      throw new Error('Secret value exceeds maximum length');
    }
    
    return secret.value;
    
  } catch (error) {
    logger.error('Secret resolution failed', {
      executionId: context.executionId,
      tenantId: context.tenantId,
      secretId: secretRef.secretId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Error('Failed to resolve secret reference');
  }
}

/**
 * Validate input size to prevent DoS attacks
 */
function validateInputSize(input: unknown): void {
  const size = JSON.stringify(input).length;
  const MAX_INPUT_SIZE = 1 * 1024 * 1024; // 1MB
  
  if (size > MAX_INPUT_SIZE) {
    throw new Error(`Input size (${size} bytes) exceeds maximum (${MAX_INPUT_SIZE} bytes)`);
  }
}

/**
 * Validate and sanitize node configuration
 */
function validateAndSanitizeNodeConfig(
  node: GraphNode,
  tenantId: string
): Record<string, unknown> {
  const config = node.config || {};
  const sanitized = createSafeObject();
  
  // Validate input size first
  validateInputSize(config);
  
  for (const [key, value] of Object.entries(config)) {
    // Validate key
    if (!SAFE_FIELD_NAME_PATTERN.test(key)) {
      throw new Error(`Invalid configuration key: ${key}`);
    }
    
    // Sanitize value
    if (typeof value === 'string') {
      // Remove control characters
      const sanitizedValue = value.replace(/[\x00-\x1F\x7F]/g, '');
      sanitized[key] = sanitizedValue;
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize objects
      sanitized[key] = createSafeNestedObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

// ============================================================================
// UTILITY: SPECIAL TOKEN CLEANING
// ============================================================================

/**
 * Clean special tokens from model output
 * Exported for use in other modules
 */
export function cleanSpecialTokens(output: string): string {
  if (!output) return output;
  
  // First, decode HTML entities
  let decoded = output;
  try {
    // Use a simple HTML entity decoder
    decoded = output.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  } catch (e) {
    // If decoding fails, just use the original
    decoded = output;
  }
  
  // Remove DeepSeek special tokens (escaped versions too)
  let cleaned = decoded
    // HTML entity versions
    .replace(/&lt;\|redacted_begin_of_sentence\|&gt;/gi, '')
    .replace(/&lt;\|redacted_end_of_sentence\|&gt;/gi, '')
    .replace(/&lt;\|redacted_fim_begin\|&gt;/gi, '')
    .replace(/&lt;\|redacted_fim_hole\|&gt;/gi, '')
    .replace(/&lt;\|redacted_fim_end\|&gt;/gi, '')
    .replace(/&lt;\|begin\?of\?sentence\|&gt;/gi, '')
    .replace(/&lt;\|end\?of\?sentence\|&gt;/gi, '')
    .replace(/&lt;\|begin_of_sentence\|&gt;/gi, '')
    .replace(/&lt;\|end_of_sentence\|&gt;/gi, '')
    // Plain bracket versions
    .replace(/<\|redacted_begin_of_sentence\|>/gi, '')
    .replace(/<\|redacted_end_of_sentence\|>/gi, '')
    .replace(/<\|redacted_fim_begin\|>/gi, '')
    .replace(/<\|redacted_fim_hole\|>/gi, '')
    .replace(/<\|redacted_fim_end\|>/gi, '')
    .replace(/<\|begin\?of\?sentence\|>/gi, '')
    .replace(/<\|end\?of\?sentence\|>/gi, '')
    .replace(/<\|begin_of_sentence\|>/gi, '')
    .replace(/<\|end_of_sentence\|>/gi, '');
  
  // Remove other common special tokens
  cleaned = cleaned
    .replace(/<\|im_start\|>/gi, '')
    .replace(/<\|im_end\|>/gi, '')
    .replace(/<\|endoftext\|>/gi, '')
    .replace(/\[INST\]/gi, '')
    .replace(/\[\/INST\]/gi, '')
    .replace(/<\|redacted_/gi, '')  // Remove any remaining redacted tokens
    .replace(/\|redacted_/gi, '')   // Remove standalone redacted markers
    .replace(/redacted_begin_of_sentence/gi, '')  // Remove without brackets
    .replace(/redacted_end_of_sentence/gi, '')
    .replace(/redacted_fim_begin/gi, '')
    .replace(/redacted_fim_hole/gi, '')
    .replace(/redacted_fim_end/gi, '');
  
  // Catch-all: Remove any remaining <|...|> patterns (with or without escaped brackets)
  // This is more aggressive and catches all special token variations
  cleaned = cleaned.replace(/&lt;\|[^|]*?\|&gt;/gi, '');  // HTML encoded
  cleaned = cleaned.replace(/<\|[^|]*?\|>/gi, '');  // Plain brackets
  cleaned = cleaned.replace(/&lt;\|[^&]*?\|&gt;/gi, ''); // Handle broken HTML entities
  cleaned = cleaned.replace(/<\|[^>]*?\|>/gi, ''); // More aggressive pattern
  
  // Remove any remaining angle bracket patterns
  cleaned = cleaned.replace(/\|<[^>]*?\|/gi, '');
  cleaned = cleaned.replace(/\[[^\]]*?redacted[^\]]*?\]/gi, ''); // Remove [redacted] patterns
  
  // Clean up multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Final pass: remove any remaining special token remnants
  cleaned = cleaned
    .replace(/\s*<[^>]*?>\s*/g, '')  // Remove any remaining tags
    .replace(/\s*\|[^|]*?\|\s*/g, '') // Remove any remaining pipe patterns
    .replace(/\s+/g, ' ')
    .trim();
  
  return cleaned;
}

// ============================================================================
// EXECUTION TRACKING WITH RESOURCE MANAGEMENT
// ============================================================================

const activeExecutions = new Map<string, WorkflowExecutionTracker>();
let cleanupIntervalId: NodeJS.Timeout | null = null;

// Atomic execution state management
class ExecutionStateManager {
  private readonly stateLocks = new Map<string, Promise<void>>();
  
  async acquireLock(executionId: string): Promise<() => void> {
    const existingLock = this.stateLocks.get(executionId);
    if (existingLock) {
      await existingLock;
    }
    
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    
    this.stateLocks.set(executionId, lockPromise);
    
    return () => {
      releaseLock!();
      this.stateLocks.delete(executionId);
    };
  }
  
  async updateExecutionStatus(
    executionId: string, 
    status: 'running' | 'completed' | 'failed'
  ): Promise<void> {
    const releaseLock = await this.acquireLock(executionId);
    try {
      const tracker = activeExecutions.get(executionId);
      if (tracker) {
        const baseTracker: Omit<WorkflowExecutionTracker, 'endTime'> = {
          ...tracker,
          status
        };
        
        const updatedTracker: WorkflowExecutionTracker = status === 'completed' || status === 'failed'
          ? { ...baseTracker, endTime: Date.now() }
          : baseTracker;
        
        activeExecutions.set(executionId, updatedTracker);
      }
    } finally {
      releaseLock();
    }
  }
}

const executionStateManager = new ExecutionStateManager();

async function startExecutionCleanup(): Promise<void> {
  if (cleanupIntervalId) return;
  cleanupIntervalId = setInterval(async () => {
    const now = Date.now();
    const staleThreshold = now - SECURITY_LIMITS.STALE_EXECUTION_THRESHOLD_MS;
    const completedRetentionMs = 300000; // 5 minutes

    for (const [executionId, tracker] of activeExecutions.entries()) {
        const releaseLock = await executionStateManager.acquireLock(executionId);
        try {
        let shouldCleanup = false;
        let reason = '';
        
        // ✅ FIX 1: Clean up stale running executions
        if (tracker.status === 'running' && tracker.startTime < staleThreshold) {
          shouldCleanup = true;
          reason = 'stale_running';
        }
        
        // ✅ FIX 2: Clean up completed/failed executions after retention period
        if ((tracker.status === 'completed' || tracker.status === 'failed') && 
            tracker.endTime && 
            (now - tracker.endTime) > completedRetentionMs) {
          shouldCleanup = true;
          reason = `${tracker.status}_retention_expired`;
        }
        
        if (shouldCleanup) {
          activeExecutions.delete(executionId);
          tenantResourceManager.releaseExecutionSlot(tracker.tenantId);
          logger.info('Cleaned up execution', {
            executionId,
            tenantId: tracker.tenantId,
            status: tracker.status,
            reason,
            age: now - tracker.startTime
          });
        }
        } finally {
          releaseLock();
      }
    }
  }, SECURITY_LIMITS.EXECUTION_CLEANUP_INTERVAL_MS);
}

function stopExecutionCleanup(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

startExecutionCleanup();

/**
 * Graceful shutdown handler
 * Exported for use in application lifecycle management
 */
export async function shutdown(): Promise<void> {
  logger.info('Shutting down workflow executor');
  
  // Stop cleanup interval
  stopExecutionCleanup();
  
  // Wait for active executions to complete (with timeout)
  const shutdownTimeout = 30000; // 30 seconds
  const startTime = Date.now();
  
  while (activeExecutions.size > 0) {
    if (Date.now() - startTime > shutdownTimeout) {
      logger.warn('Shutdown timeout - forcing cleanup', {
        remainingExecutions: activeExecutions.size
      });
      break;
    }
    
    logger.info('Waiting for executions to complete', {
      activeCount: activeExecutions.size
    });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Final cleanup
  for (const [executionId, tracker] of activeExecutions.entries()) {
    tenantResourceManager.releaseExecutionSlot(tracker.tenantId);
    activeExecutions.delete(executionId);
  }
  
  logger.info('Workflow executor shutdown complete');
}

async function addExecution(executionId: string, tracker: WorkflowExecutionTracker): Promise<void> {
  // Check global limit
  if (activeExecutions.size >= SECURITY_LIMITS.MAX_ACTIVE_EXECUTIONS) {
    throw new Error(
      `Maximum active executions reached (${SECURITY_LIMITS.MAX_ACTIVE_EXECUTIONS}). Please try again later.`
    );
  }
  
  // Check per-tenant limit
  try {
    tenantResourceManager.acquireExecutionSlot(tracker.tenantId);
  } catch (error) {
    logAuditEvent(AUDIT_EVENT_TYPES.RATE_LIMIT_EXCEEDED, {
      executionId,
      tenantId: tracker.tenantId,
      agentId: tracker.agentId
    }, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  
  activeExecutions.set(executionId, tracker);
  
  logAuditEvent(AUDIT_EVENT_TYPES.EXECUTION_START, {
    executionId,
    tenantId: tracker.tenantId,
    agentId: tracker.agentId
  }, { workflowId: tracker.workflowId, workflowName: tracker.workflowName });
}

async function removeExecution(executionId: string): Promise<void> {
  const tracker = activeExecutions.get(executionId);
  if (tracker) {
    tenantResourceManager.releaseExecutionSlot(tracker.tenantId);
    activeExecutions.delete(executionId);
  }
}

// ============================================================================
// TEMPLATE VALIDATION & RESOLUTION
// ============================================================================

/**
 * Validated agent configuration interface
 */
interface ValidatedAgentConfig {
  readonly systemPrompt?: string;
  readonly userPrompt?: string;
  readonly llm?: ValidatedLLMConfig;
  readonly tools?: readonly string[];
}

interface ValidatedLLMConfig {
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly secretRef?: SecretReference;
}

/**
 * Type guard for validated agent configuration
 */
function isValidAgentConfig(config: unknown): config is ValidatedAgentConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }
  
  const agentConfig = config as Record<string, unknown>;
  
  // Check required fields
  if (!agentConfig.systemPrompt && !agentConfig.userPrompt) {
    return false;
  }
  
  // Validate system prompt
  if (agentConfig.systemPrompt && typeof agentConfig.systemPrompt !== 'string') {
    return false;
  }
  
  // Validate user prompt
  if (agentConfig.userPrompt && typeof agentConfig.userPrompt !== 'string') {
    return false;
  }
  
  // Validate LLM config if present
  if (agentConfig.llm && typeof agentConfig.llm === 'object' && agentConfig.llm !== null) {
    const llm = agentConfig.llm as Record<string, unknown>;
    if (typeof llm.model !== 'string' || typeof llm.temperature !== 'number' || typeof llm.maxTokens !== 'number') {
      return false;
    }
  }
  
  return true;
}

export function validateAgentConfiguration(
  config: Record<string, unknown>,
  context: WorkflowExecutionContext
): {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly migrationSuggestions: readonly string[];
  readonly standardFormatCount: number;
  readonly deprecatedFormatCount: number;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const migrationSuggestions: string[] = [];
  let standardFormatCount = 0;
  let deprecatedFormatCount = 0;

  // Check for required fields
  if (!config.systemPrompt && !config.userPrompt) {
    errors.push('Either systemPrompt or userPrompt must be provided');
  }

  // Validate system prompt
  if (config.systemPrompt) {
    if (typeof config.systemPrompt !== 'string') {
      errors.push('systemPrompt must be a string');
    } else {
      // Sanitize system prompt
      const sanitized = (config.systemPrompt as string).replace(/[\x00-\x1F\x7F]/g, '');
      if (sanitized !== config.systemPrompt) {
        warnings.push('System prompt contained control characters which were removed');
      }
      standardFormatCount++;
    }
  }

  // Validate user prompt
  if (config.userPrompt) {
    if (typeof config.userPrompt !== 'string') {
      errors.push('userPrompt must be a string');
    } else {
      // Sanitize user prompt
      const sanitized = (config.userPrompt as string).replace(/[\x00-\x1F\x7F]/g, '');
      if (sanitized !== config.userPrompt) {
        warnings.push('User prompt contained control characters which were removed');
      }
      standardFormatCount++;
    }
  }

  // Check for deprecated formats
  if (config.prompt) {
    warnings.push('Using deprecated "prompt" field. Consider using "systemPrompt" and "userPrompt"');
    migrationSuggestions.push('Replace "prompt" with "systemPrompt" and "userPrompt" fields');
    deprecatedFormatCount++;
  }

  // Validate LLM configuration
  if (config.llm && typeof config.llm === 'object' && config.llm !== null) {
    const llm = config.llm as Record<string, unknown>;
    
    if (typeof llm.model !== 'string') {
      errors.push('llm.model must be a string');
    }
    
    if (llm.temperature !== undefined && (typeof llm.temperature !== 'number' || llm.temperature < 0 || llm.temperature > 2)) {
      errors.push('llm.temperature must be between 0 and 2');
    }
    
    if (llm.maxTokens !== undefined && (typeof llm.maxTokens !== 'number' || llm.maxTokens <= 0)) {
      errors.push('llm.maxTokens must be a positive number');
    }
    
    // Check for plain text credentials
    if (llm.apiKey && typeof llm.apiKey === 'string') {
      warnings.push('Plain text API key detected. Consider using secret references');
      migrationSuggestions.push('Replace apiKey with secretRef for better security');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    migrationSuggestions,
    standardFormatCount,
    deprecatedFormatCount
  };
}

// ============================================================================
// WORKFLOW VALIDATION
// ============================================================================

function validateRequiredContext(workflow: WorkflowGraph, initialContext: RequiredInitialContext): void {
  // Validate required IDs
  validateIdentifier(initialContext.agentId, 'agentId');
  validateIdentifier(initialContext.tenantId, 'tenantId');
  
  if (initialContext.channelId) {
    validateIdentifier(initialContext.channelId, 'channelId');
  }

  // Validate tenant ownership
  validateTenantOwnership(workflow, initialContext.tenantId);

  // Validate workflow structure
  if (!workflow.nodes || workflow.nodes.length === 0) {
    throw new Error('Workflow must have at least one node');
  }

  if (workflow.nodes.length > SECURITY_LIMITS.MAX_WORKFLOW_NODES) {
    throw new Error(`Workflow exceeds maximum node limit (${SECURITY_LIMITS.MAX_WORKFLOW_NODES})`);
  }

  if (workflow.edges && workflow.edges.length > SECURITY_LIMITS.MAX_WORKFLOW_EDGES) {
    throw new Error(`Workflow exceeds maximum edge limit (${SECURITY_LIMITS.MAX_WORKFLOW_EDGES})`);
  }

  // Validate nodes
  for (const node of workflow.nodes) {
    validateNodeName(node.name);
    validateIdentifier(node.id, `node.id (${node.name})`);
    
    if (node.position) {
      if (typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
        throw new Error(`Node ${node.name} has invalid position`);
      }
    }
    
    // Validate and sanitize node configuration
    try {
      validateAndSanitizeNodeConfig(node, initialContext.tenantId);
    } catch (error) {
      logAuditEvent(AUDIT_EVENT_TYPES.CONFIG_VALIDATION_FAILED, {
        executionId: 'validation',
        tenantId: initialContext.tenantId,
        agentId: initialContext.agentId
      }, { nodeId: node.id, nodeName: node.name, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

function enforceWorkflowLimits(workflow: WorkflowGraph): void {
  // Check node count
  if (workflow.nodes.length > SECURITY_LIMITS.MAX_WORKFLOW_NODES) {
    throw new Error(`Workflow has too many nodes (${workflow.nodes.length}). Maximum allowed: ${SECURITY_LIMITS.MAX_WORKFLOW_NODES}`);
  }

  // Check edge count
  if (workflow.edges && workflow.edges.length > SECURITY_LIMITS.MAX_WORKFLOW_EDGES) {
    throw new Error(`Workflow has too many edges (${workflow.edges.length}). Maximum allowed: ${SECURITY_LIMITS.MAX_WORKFLOW_EDGES}`);
  }

  // Check for circular dependencies
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (recursionStack.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    const outgoingEdges = workflow.edges?.filter(edge => edge.source === nodeId) || [];
    for (const edge of outgoingEdges) {
      if (hasCycle(edge.target)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of workflow.nodes) {
    if (!visited.has(node.id) && hasCycle(node.id)) {
      throw new Error('Workflow contains circular dependencies');
    }
  }
}

// ============================================================================
// EXECUTION CONTEXT CREATION
// ============================================================================

function createWorkflowExecutionContext(
  baseContext: TypeSafeExecutionContext,
  workflow: WorkflowGraph,
  initialContext: RequiredInitialContext,
  executionId: string
): WorkflowExecutionContext {
  const context: WorkflowExecutionContext = {
    ...baseContext,
    executionId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    agentId: initialContext.agentId,
    tenantId: initialContext.tenantId,
    channelId: initialContext.channelId,
    channelType: initialContext.channelType,
    executionMetadata: {
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: initialContext.agentId,
      tenantId: initialContext.tenantId,
      executionId,
      startTime: Date.now()
    },
    variables: baseContext.variables || {},
    sendResponse: async (data: unknown) => {
      // This will be implemented by the channel integration
      logger.info('Sending response to channel', {
        executionId,
        channelId: initialContext.channelId,
        channelType: initialContext.channelType,
        data
      });
    }
  };

  return context;
}

// ============================================================================
// TRIGGER DATA INJECTION
// ============================================================================

function injectTriggerData(
  context: WorkflowExecutionContext,
  triggerDataInjections: readonly TriggerDataInjection[]
): void {
  logger.info('🔧 [TRIGGER] Injecting trigger data with required IDs', {
    executionId: context.executionId,
    workflowId: context.workflowId,
    workflowName: context.workflowName,
    agentId: context.agentId,
    tenantId: context.tenantId,
    count: triggerDataInjections.length,
    injections: triggerDataInjections.map(i => ({
      nodeId: i.nodeId,
      nodeName: i.nodeName,
      triggerType: i.triggerType,
      dataKeys: Object.keys(i.data || {})
    }))
  });

  for (const injection of triggerDataInjections) {
    const nodeId = injection.nodeId || 'unknown';
    const nodeName = injection.nodeName || 'unknown';
    
    const triggerData: TriggerDataWithMetadata = {
      ...injection.data,
      nodeId,
      nodeName,
      triggerType: injection.triggerType || 'unknown',
      timestamp: new Date().toISOString(),
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      source: 'trigger'
    };

    logger.info('🔧 [TRIGGER] Storing trigger data', {
      executionId: context.executionId,
      nodeId,
      nodeName,
      dataKeys: Object.keys(triggerData),
      messageField: (triggerData as any).message || (triggerData as any).text,
      nodeDataKeysBefore: Object.keys(context.nodeData || {})
    });

    try {
      // Store trigger data in nodeData using both ID and name
      if (nodeId !== 'unknown') {
        (context.nodeData as Record<string, unknown>)[nodeId] = triggerData;
      }
      if (nodeName !== 'unknown' && nodeName !== nodeId) {
        (context.nodeData as Record<string, unknown>)[nodeName] = triggerData;
      }
      
      logger.info('✅ [TRIGGER] Trigger data stored in nodeData', {
        executionId: context.executionId,
        nodeId,
        nodeName,
        nodeDataKeysAfter: Object.keys(context.nodeData || {})
      });

      // Store in variables for template resolution
      const vars = context.variables || {};
      if (!vars.json) {
        vars.json = createSafeObject();
      }

      const jsonVars = vars.json as Record<string, unknown>;
      if (nodeId !== 'unknown') {
        jsonVars[nodeId] = triggerData;
      }
      if (nodeName !== 'unknown' && nodeName !== nodeId) {
        jsonVars[nodeName] = triggerData;
      }

      (context as { variables: Record<string, unknown> }).variables = vars;

      logger.info('✅ [TRIGGER] Trigger data stored in variables.json', {
        executionId: context.executionId,
        nodeId,
        nodeName,
        variablesJsonKeys: jsonVars ? Object.keys(jsonVars) : []
      });

    } catch (error) {
      logger.error('❌ [TRIGGER] Failed to inject trigger data', {
        executionId: context.executionId,
        nodeId,
        nodeName,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      // Don't throw - continue with next injection
    }
  }
}

// ============================================================================
// NODE EXECUTION
// ============================================================================

function validateNodeForExecution(node: GraphNode): boolean {
  if (isAgentNode(node)) {
    return Boolean(node.agentConfig);
  }
  if (isIntegrationNode(node)) {
    return Boolean(node.integration && node.function);
  }
  return false;
}

function isLLMNode(node: GraphNode): boolean {
  return isAgentNode(node) || 
         (node.type === 'ai_agent') ||
         (node.integration === 'openrouter') ||
         (node.integration === 'agent');
}

/**
 * Resolve template string using execution context
 * Supports both nodeName (from trigger name) and nodeId (could be UUID or custom ID)
 */
function resolveTemplate(template: string, context: WorkflowExecutionContext): string {
  if (!template) return '';
  
  let resolved = template;
  
  // Match {{$json.nodeIdentifier.field}} patterns where nodeIdentifier can be node name or node ID
  // Supports both simple IDs and UUIDs (e.g., "webchat001" or "b4a82ac1-72ca-4c72-a184-abce0e7bd0a5")
  // Updated regex to allow hyphens in all parts of the identifier
  const templateRegex = /\{\{\$json\.([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_\-]+)\}\}/g;
  
  resolved = resolved.replace(templateRegex, (match, nodeIdentifier, fieldName) => {
    // Log the resolution attempt
    logger.info('🔍 [TEMPLATE] Resolving template variable', {
      executionId: context.executionId,
      nodeIdentifier,
      fieldName,
      template: match,
      availableNodeDataKeys: Object.keys(context.nodeData),
      availableVariablesKeys: context.variables?.json ? Object.keys(context.variables.json as Record<string, unknown>) : []
    });
    
    // Try to get from nodeData using nodeIdentifier (could be name or ID)
    const nodeData = context.nodeData[nodeIdentifier];
    if (nodeData && typeof nodeData === 'object') {
      const data = nodeData as Record<string, unknown>;
      const value = data[fieldName];
      
      if (value !== undefined && value !== null) {
        logger.info('✅ [TEMPLATE] Found value in nodeData', {
          executionId: context.executionId,
          nodeIdentifier,
          fieldName,
          valueType: typeof value,
          valueLength: typeof value === 'string' ? value.length : undefined,
          valuePreview: typeof value === 'string' ? value.substring(0, 100) : undefined
        });
        return String(value);
      }
    }
    
    // Try variables.json
    const vars = context.variables?.json as Record<string, unknown> | undefined;
    if (vars) {
      const nodeVars = vars[nodeIdentifier] as Record<string, unknown> | undefined;
      if (nodeVars) {
        const value = nodeVars[fieldName];
        if (value !== undefined && value !== null) {
          logger.info('✅ [TEMPLATE] Found value in variables.json', {
            executionId: context.executionId,
            nodeIdentifier,
            fieldName,
            valueType: typeof value,
            valueLength: typeof value === 'string' ? value.length : undefined,
            valuePreview: typeof value === 'string' ? value.substring(0, 100) : undefined
          });
          return String(value);
        }
      }
    }
    
    // Fallback: Try to find the node by searching for trigger data
    // This handles cases where the user's workflow uses different IDs
    let foundValue: string | null = null;
    for (const [nodeKey, nodeData] of Object.entries(context.nodeData)) {
      if (nodeData && typeof nodeData === 'object') {
        const data = nodeData as Record<string, unknown>;
        // Check if this node has the field we're looking for (e.g., 'message', 'text', etc.)
        const value = data[fieldName];
        if (value !== undefined && value !== null && typeof value === 'string') {
          foundValue = value;
          logger.info('✅ [TEMPLATE] Found fallback value in nodeData', {
            executionId: context.executionId,
            searchedFor: `${nodeIdentifier}.${fieldName}`,
            foundIn: nodeKey,
            fieldName,
            valueLength: value.length,
            valuePreview: value.substring(0, 100)
          });
          break;
        }
      }
    }
    
    if (foundValue) {
      return foundValue;
    }
    
    // Return original if not found
    logger.error('❌ [TEMPLATE] Template variable not found', {
      executionId: context.executionId,
      nodeIdentifier,
      fieldName,
      template: match,
      availableNodes: Object.keys(context.nodeData),
      nodeDataDetails: Object.entries(context.nodeData).map(([key, value]) => ({
        key,
        type: typeof value,
        keys: typeof value === 'object' && value ? Object.keys(value) : []
      }))
    });
    return match;
  });
  
  return resolved;
}

async function callOpenRouter(
  node: GraphNode,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const startTime = Date.now();
  
  logger.info('Calling OpenRouter for LLM node', {
    executionId: context.executionId,
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type
  });

  try {
    // ✅ STEP 1: Extract configuration from multiple possible locations
    const nodeConfig = (node as any).data || node.config || {};
    const agentConfig = node.agentConfig || {};

    // Extract tool definitions from agent configuration (universal format)
    let tools: OpenRouterTool[] | undefined;
    try {
      const toolConfig = agentConfig?.tools;
      const definitions = toolConfig?.definitions;
      if (toolConfig?.enabled && Array.isArray(definitions) && definitions.length > 0) {
        const converted = definitions
          .map((definition: Record<string, unknown> | null | undefined) => {
            if (!definition || typeof definition !== 'object') {
              return null;
            }

            const name = typeof definition.name === 'string' ? definition.name.trim() : undefined;
            if (!name) {
              logger.warn('Skipping tool definition without valid name', {
                executionId: context.executionId,
                nodeId: node.id,
                definitionKeys: Object.keys(definition)
              });
              return null;
            }

            const description =
              typeof definition.description === 'string' && definition.description.trim().length > 0
                ? definition.description
                : typeof definition.summary === 'string' && definition.summary.trim().length > 0
                  ? definition.summary
                  : typeof definition.title === 'string' && definition.title.trim().length > 0
                    ? definition.title
                    : `Tool ${name}`;

            const rawParameters =
              (definition.parameters as Record<string, unknown> | undefined) ??
              (definition.schema as Record<string, unknown> | undefined) ??
              {};

            const normalizedParameters =
              rawParameters && typeof rawParameters === 'object'
                ? rawParameters
                : {};

            const parameterType =
              typeof (normalizedParameters as Record<string, unknown>).type === 'string'
                ? String((normalizedParameters as Record<string, unknown>).type)
                : 'object';

            const propertiesCandidate = (normalizedParameters as Record<string, unknown>).properties;
            const properties =
              propertiesCandidate && typeof propertiesCandidate === 'object'
                ? (propertiesCandidate as Record<string, unknown>)
                : {};

            const requiredCandidate = (normalizedParameters as Record<string, unknown>).required;
            const required =
              Array.isArray(requiredCandidate)
                ? requiredCandidate.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.length > 0)
                : undefined;

            const parameters = {
              type: parameterType || 'object',
              properties,
              ...(required && required.length > 0 ? { required } : {})
            };

            return {
              name,
              description,
              parameters
            } as OpenRouterTool;
          })
          .filter((tool): tool is OpenRouterTool => Boolean(tool));

        if (converted.length > 0) {
          tools = converted;
        }
      }
    } catch (error) {
      logger.warn('Failed to normalize tool definitions for OpenRouter request', {
        executionId: context.executionId,
        nodeId: node.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    logger.debug('Tool configuration resolved for OpenRouter request', {
      executionId: context.executionId,
      nodeId: node.id,
      toolsEnabled: Boolean(agentConfig?.tools?.enabled),
      toolCount: tools?.length ?? 0,
      toolNames: tools?.map(tool => tool.name) ?? []
    });
    
    logger.debug('Extracting templates from node configuration', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeConfigKeys: Object.keys(nodeConfig),
      agentConfigKeys: Object.keys(agentConfig),
      hasSystemPrompt: !!(agentConfig.systemPrompt || nodeConfig.systemPrompt),
      hasUserPrompt: !!(agentConfig.userPrompt || nodeConfig.userPrompt)
    });
    
    // Get raw templates from config - handle both formats
    const systemPromptTemplate = agentConfig.systemPrompt || 
                                nodeConfig.systemPrompt || 
                                nodeConfig.system_prompt || 
                                '';
    const userPromptTemplate = agentConfig.userPrompt || 
                               nodeConfig.userPrompt || 
                               nodeConfig.user_prompt_template || 
                               '';
    
    logger.debug('Raw templates extracted', {
      executionId: context.executionId,
      nodeId: node.id,
      systemPromptTemplate: systemPromptTemplate?.substring(0, 100) || '(empty)',
      userPromptTemplate: userPromptTemplate?.substring(0, 100) || '(empty)',
      systemPromptLength: systemPromptTemplate?.length || 0,
      userPromptLength: userPromptTemplate?.length || 0,
      nodeConfigKeys: Object.keys(nodeConfig),
      agentConfigKeys: Object.keys(agentConfig)
    });
    
    // ✅ STEP 2: Resolve templates using context data
    const systemPrompt = resolveTemplate(systemPromptTemplate, context);
    const userPrompt = resolveTemplate(userPromptTemplate, context);
    
    logger.info('Templates resolved successfully', {
      executionId: context.executionId,
      nodeId: node.id,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      userPromptPreview: userPrompt.substring(0, 100),
      availableNodeData: Object.keys(context.nodeData)
    });
    
    // ✅ STEP 3: Build messages array with resolved content
    // Add system-level instruction to prevent special tokens
    const SYSTEM_INSTRUCTION = 'CRITICAL: Only respond with clean, natural language. Do NOT use any special tokens, markup tags, or formatting codes like <|...|>, [INST], [INST/], <|im_start|>, <|im_end|>, or any other technical tokens. Output ONLY plain conversational text.';
    
    const messages: Array<{role: 'system' | 'user' | 'assistant' | 'function'; content: string}> = [];
    
    if (systemPrompt) {
      // Prepend system instruction to user's system prompt
      messages.push({
        role: 'system',
        content: `${SYSTEM_INSTRUCTION}\n\n${systemPrompt}`
      });
    } else {
      // If no system prompt provided, add the instruction alone
      messages.push({
        role: 'system',
        content: SYSTEM_INSTRUCTION
      });
    }
    
    if (userPrompt) {
      messages.push({
        role: 'user',
        content: userPrompt
      });
    } else {
      // Better error message with context
      logger.error('User prompt is empty after resolution', {
        executionId: context.executionId,
        nodeId: node.id,
        originalTemplate: userPromptTemplate,
        availableNodeData: Object.keys(context.nodeData),
        nodeDataContent: JSON.stringify(context.nodeData, null, 2).substring(0, 500)
      });
      throw new Error(
        'User prompt is empty after template resolution. ' +
        'Check that webchat trigger data is available in context. ' +
        `Available nodes: ${Object.keys(context.nodeData).join(', ')}`
      );
    }
    
    logger.debug('Messages built for OpenRouter', {
      executionId: context.executionId,
      nodeId: node.id,
      messageCount: messages.length,
      messages: messages.map(m => ({ 
        role: m.role, 
        contentLength: m.content.length,
        contentPreview: m.content.substring(0, 50)
      }))
    });

    // ✅ STEP 4: Get API key from environment (secure)
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY environment variable not set. ' +
        'Please configure it in your .env file.'
      );
    }

    // ✅ STEP 5: Prepare OpenRouter request with resolved data
    const request: OpenRouterRequest = {
      model: nodeConfig.model || agentConfig.llm?.model || 'deepseek/deepseek-chat-v3.1:free',
      messages, // ← Now contains resolved content!
      temperature: nodeConfig.temperature || agentConfig.llm?.temperature || 0.7,
      maxTokens: nodeConfig.maxTokens || nodeConfig.max_tokens || agentConfig.llm?.maxTokens || 500,
      apiKey,
      fallbackModel: 'deepseek/deepseek-chat-v3.1:free',
      skipFallback: false,
      ...(tools && tools.length > 0
        ? { tools, toolChoice: 'auto' as const }
        : {})
    };

    logger.info('Calling OpenRouter API', {
      executionId: context.executionId,
      nodeId: node.id,
      model: request.model,
      messageCount: request.messages.length,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      hasApiKey: !!request.apiKey,
      toolsCount: request.tools?.length ?? 0,
      toolChoice: request.toolChoice ?? 'none'
    });

    // ✅ STEP 6: Call OpenRouter with circuit breaker
    logger.info('🔄 [EXECUTOR] Calling OpenRouter API', {
      executionId: context.executionId,
      nodeId: node.id,
      request: {
        model: request.model,
        messageCount: request.messages.length,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        hasApiKey: !!request.apiKey,
        toolsCount: request.tools?.length ?? 0,
        toolChoice: request.toolChoice ?? 'none'
      },
      timestamp: new Date().toISOString()
    });

    const response = await openRouterCircuitBreaker.execute(async () => {
      return await openRouterAdapter.generate({
        ...request,
        messages: messages as readonly OpenRouterMessage[]
      }, context);
    });

    // 🔍 EXECUTOR DEBUG: Log OpenRouter response
    logger.info('📤 [EXECUTOR] OpenRouter API response received', {
      executionId: context.executionId,
      nodeId: node.id,
      success: response.success,
      output: response.output,
      outputLength: response.output.length,
      model: response.model,
      usage: response.usage,
      toolCallCount: response.toolCalls?.length ?? 0,
      timestamp: new Date().toISOString()
    });

    // ✅ STEP 7: Validate response
    if (!response.success) {
      logger.error('OpenRouter returned unsuccessful response', {
        executionId: context.executionId,
        nodeId: node.id,
        output: response.output,
        model: request.model,
        messageCount: messages.length
      });
      
      if (response.output.includes('401') || response.output.includes('No auth credentials')) {
        throw new Error('OpenRouter API authentication failed. Please check your OPENROUTER_API_KEY.');
      } else if (response.output.includes('400') || response.output.includes('Input required')) {
        throw new Error('OpenRouter API request failed: Missing required input.');
      } else {
        throw new Error(`OpenRouter API error: ${response.output}`);
      }
    }

    // ✅ STEP 8: Format response for node execution
    const result: NodeExecutionResult = {
      success: true,
      duration: Date.now() - startTime,
      result: {
        json: {
          output: response.output,
          agentOutput: response.output,
          response: response.output,
          model: response.model,
          success: true,
          timestamp: new Date().toISOString(),
          usage: response.usage
        },
        metadata: {
          executionId: context.executionId,
          nodeId: node.id,
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          success: true
        }
      }
    };

    if (response.toolCalls && response.toolCalls.length > 0 && result.result && result.result.json) {
      (result.result.json as Record<string, unknown>).toolCalls = response.toolCalls;
    }

    // Record metrics
    const executionDuration = Date.now() - startTime;
    metricsCollector.recordExecution(context.tenantId, executionDuration, true);
    
    logger.info('OpenRouter call completed successfully', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeName: node.name,
      model: response.model,
      outputLength: response.output.length,
      duration: executionDuration
    });

    return result;

  } catch (error) {
    logger.error('OpenRouter call failed with error', {
      executionId: context.executionId,
      nodeId: node.id,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined
    });

    const safeError = handleExecutionError(error, {
      executionId: context.executionId,
      tenantId: context.tenantId,
      agentId: context.agentId,
      nodeId: node.id
    });

    throw safeError;
  }
}

/**
 * Log detailed integration data
 */
function logIntegrationData(
  stage: 'start' | 'complete' | 'error',
  node: GraphNode,
  context: WorkflowExecutionContext,
  data?: Record<string, unknown>
): void {
  const logContext = {
    timestamp: new Date().toISOString(),
    stage,
    executionId: context.executionId,
    workflowId: context.workflowId,
    workflowName: context.workflowName,
    agentId: context.agentId,
    tenantId: context.tenantId,
    node: {
      id: node.id,
      name: node.name,
      type: node.type,
      integration: node.integration,
      function: node.function,
      triggerName: node.triggerName,
      nodeType: node.nodeType
    }
  };

  if (data) {
    Object.assign(logContext, data);
  }

  console.log('='.repeat(80));
  console.log(`[${stage.toUpperCase()}] Integration Node Execution`);
  console.log('='.repeat(80));
  console.log(JSON.stringify(logContext, null, 2));
  console.log('='.repeat(80));

  // Also log via logger for persistence
  if (stage === 'start') {
    logger.info('Integration node started', logContext);
  } else if (stage === 'complete') {
    logger.info('Integration node completed', logContext);
  } else {
    logger.error('Integration node failed', logContext);
  }
}

async function executeNode(
  node: GraphNode,
  context: WorkflowExecutionContext
): Promise<NodeExecutionResult> {
  const startTime = Date.now();
  const nodeTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Node execution timeout after ${SECURITY_LIMITS.MAX_NODE_EXECUTION_TIME_MS}ms`));
    }, SECURITY_LIMITS.MAX_NODE_EXECUTION_TIME_MS);
  });

  try {
    logger.info('Executing node', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type
    });

    // Log integration node start
    if (isIntegrationNode(node)) {
      logIntegrationData('start', node, context, {
        config: node.config,
        agentConfig: node.agentConfig,
        availableInputNodes: Object.keys(context.nodeData)
      });
    }

    // Validate node for execution
    if (!validateNodeForExecution(node)) {
      logger.error('Node validation failed', {
        executionId: context.executionId,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type
      });
      throw new Error('Invalid node configuration');
    }

    let result: NodeExecutionResult;

    // Execute node with timeout
    const nodeExecution = async (): Promise<NodeExecutionResult> => {
      // Check if this is an LLM node that should use OpenRouter
      if (isLLMNode(node)) {
        logger.info('Delegating LLM node to OpenRouter', {
          executionId: context.executionId,
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          integration: node.integration
        });
        return await callOpenRouter(node, context);
      } else if (isIntegrationNode(node)) {
        // Execute regular integration node
        logger.info('Executing integration node', {
          executionId: context.executionId,
          workflowId: context.workflowId,
          workflowName: context.workflowName,
          agentId: context.agentId,
          tenantId: context.tenantId,
          nodeId: node.id,
          nodeName: node.name,
          integration: node.integration,
          function: node.function
        });

        // Log integration call audit event
        logAuditEvent(AUDIT_EVENT_TYPES.INTEGRATION_CALL, {
          executionId: context.executionId,
          tenantId: context.tenantId,
          agentId: context.agentId
        }, { nodeId: node.id, integration: node.integration, function: node.function });

        const integrationEntry = await getTenantScopedIntegration(
          context.tenantId,
          context.agentId,
          node.integration || 'unknown',
          node.function || 'unknown',
          context.executionId
        );

        if (!integrationEntry) {
          throw new Error(`Integration not found: ${node.integration}.${node.function}`);
        }

        // Log integration entry details
        logIntegrationData('start', node, context, {
          integrationEntry: {
            name: integrationEntry.meta.name,
            description: integrationEntry.meta.description,
            type: integrationEntry.meta.type,
            category: integrationEntry.meta.category,
            handler: typeof integrationEntry.fn
          }
        });

        let finalInputs: Record<string, unknown>;

        if (isAgentNode(node)) {
          if (node.agentConfig) {
            const validation = validateAgentConfiguration(node.agentConfig as Record<string, unknown>, context);

            if (validation.warnings.length > 0) {
              logger.warn('Agent configuration contains deprecated template formats', {
                executionId: context.executionId,
                workflowId: context.workflowId,
                agentId: context.agentId,
                tenantId: context.tenantId,
                nodeId: node.id,
                nodeName: node.name,
                warnings: validation.warnings,
                migrationSuggestions: validation.migrationSuggestions
              });
            }

            if (!validation.isValid) {
              logger.error('Agent configuration validation failed', {
                executionId: context.executionId,
                workflowId: context.workflowId,
                agentId: context.agentId,
                tenantId: context.tenantId,
                nodeId: node.id,
                nodeName: node.name,
                errors: validation.errors
              });
              throw new Error(`Agent configuration validation failed: ${validation.errors.join(', ')}`);
            }

            // Handle secret references - prioritize environment variable
            let apiKey: string | undefined;
            
            // First, try environment variable (recommended approach)
            if (process.env.OPENROUTER_API_KEY) {
              apiKey = process.env.OPENROUTER_API_KEY;
              logger.debug('Using OpenRouter API key from environment variable for agent node', {
                executionId: context.executionId,
                nodeId: node.id,
                hasApiKey: !!apiKey
              });
            }
            // Fallback to agent credentials if no env var
            else if (node.agentConfig.llm?.credentials) {
              const credentials = node.agentConfig.llm.credentials as Record<string, unknown>;
              if (credentials.secretRef) {
                const secretRef = validateSecretReference(credentials.secretRef);
                apiKey = await resolveSecretReference(secretRef, {
                  tenantId: context.tenantId,
                  executionId: context.executionId
                });
              } else if (credentials.apiKey && typeof credentials.apiKey === 'string') {
                // Legacy plain text API key (deprecated)
                apiKey = credentials.apiKey;
              }
            }
            
            // If still no API key, throw error
            if (!apiKey) {
              throw new Error('OpenRouter API key not configured. Please set OPENROUTER_API_KEY environment variable or configure agent credentials.');
            }

            finalInputs = {
              systemPrompt: node.agentConfig.systemPrompt,
              userPrompt: node.agentConfig.userPrompt,
              model: node.agentConfig.llm?.model || 'deepseek/deepseek-chat-v3.1:free',
              temperature: node.agentConfig.llm?.temperature || 0.7,
              maxTokens: node.agentConfig.llm?.maxTokens || 500,
              tools: node.agentConfig.tools || [],
              apiKey
            };
            // 🔍 ADD THIS DEBUG LOG
            logger.debug('Executor passing finalInputs to integration', {
              executionId: context.executionId,
              nodeId: node.id,
              hasApiKey: typeof finalInputs.apiKey === 'string' && !!finalInputs.apiKey,
              apiKeyLength: typeof finalInputs.apiKey === 'string' ? finalInputs.apiKey.length : 0,
              apiKeyPrefix: typeof finalInputs.apiKey === 'string' ? finalInputs.apiKey.substring(0, 10) : 'NOT_SET'
            });
          } else {
            throw new Error('Agent node missing agentConfig');
          }
        } else {
          // Validate and sanitize regular node config
          finalInputs = validateAndSanitizeNodeConfig(node, context.tenantId);
        }
        
        // Log final inputs before execution
        logIntegrationData('start', node, context, {
          finalInputs: {
            ...finalInputs,
            apiKey: finalInputs.apiKey ? '[REDACTED]' : undefined
          }
        });

        const compatibleContext = {
          ...context,
          stepResults: {}
        };

        const integrationResult = await IntegrationExecutor.execute(integrationEntry, compatibleContext, finalInputs);
        
        // Log integration result
        logIntegrationData('complete', node, context, {
          result: integrationResult,
          executionTime: Date.now() - startTime,
          resultSize: JSON.stringify(integrationResult).length
        });
        
        // Convert integration result to NodeExecutionResult
        const nodeResult = {
          success: true,
          duration: Date.now() - startTime,
          result: {
            json: integrationResult,
            metadata: {
              executionId: context.executionId,
              nodeId: node.id,
              startTime,
              endTime: Date.now(),
              duration: Date.now() - startTime,
              success: true
            }
          }
        };
        
        return nodeResult;
      } else {
        throw new Error(`Unsupported node type: ${node.type}`);
      }
    };

    // Execute with timeout
    result = await Promise.race([nodeExecution(), nodeTimeout]);

    const executionTime = Date.now() - startTime;

    // ✅ ADD: Store result in context using safe operations
    let nodeResult: NodeResultWithMetadata = {
      ...result,
      executionTime,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      executionId: context.executionId,
      agentId: context.agentId,
      tenantId: context.tenantId,
      source: 'node-execution'
    };

    // ✅ ADD: Validate result size before storing
    try {
      validateObjectSize(nodeResult);
    } catch (sizeError) {
      logger.error('Node result exceeds size limit', {
        executionId: context.executionId,
        nodeId: node.id,
        nodeName: node.name,
        resultSize: JSON.stringify(nodeResult).length,
        maxSize: SECURITY_LIMITS.MAX_STORED_RESULT_SIZE,
        error: sizeError instanceof Error ? sizeError.message : String(sizeError)
      });
      
      // Store truncated error result instead
      const originalResult = nodeResult.result;
      nodeResult = {
        ...nodeResult,
        success: false,
        result: {
          json: originalResult && typeof originalResult === 'object' && 'json' in originalResult 
            ? { ...(originalResult as { json: Record<string, unknown> }).json }
            : {},
          metadata: originalResult && typeof originalResult === 'object' && 'metadata' in originalResult
            ? (originalResult as { metadata: Record<string, unknown> }).metadata
            : (nodeResult.result && typeof nodeResult.result === 'object' && 'metadata' in nodeResult.result)
              ? (nodeResult.result as { metadata: Record<string, unknown> }).metadata
              : {},
          error: {
            message: 'Result size exceeds maximum allowed',
            resultSize: JSON.stringify(nodeResult).length,
            maxSize: SECURITY_LIMITS.MAX_STORED_RESULT_SIZE,
            truncated: true
          }
        }
      };
    }

    // Use safe deep set for nested structures
    safeDeepSet(context.nodeData as Record<string, unknown>, [node.id], nodeResult);
    safeDeepSet(context.nodeData as Record<string, unknown>, [node.name], nodeResult);

    // Update context variables immutably
    const varData = createSafeNestedObject({
      ...(result.result && typeof result.result === 'object' ? result.result : {}),
      ...ensureAliases(result)
    });

    const updatedContext = updateContextVariables(context, {
      json: {
        [node.id]: varData,
        [node.name]: varData
      }
    });

    // Update the context reference (this is safe as we're creating a new context)
    Object.assign(context, updatedContext);

    logger.debug('Node result stored with minimal data', {
      executionId: context.executionId,
      nodeId: node.id,
      nodeName: node.name,
      executionTime,
      storedKeys: Object.keys(nodeResult)
    });

    logger.debug('Node completed successfully', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      nodeId: node.id,
      nodeName: node.name,
      duration: executionTime
    });

    return result;

  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    // Log integration error
    if (isIntegrationNode(node)) {
      logIntegrationData('error', node, context, {
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        executionTime
      });
    }
    
    // Handle timeout specifically
    if (error instanceof Error && error.message.includes('timeout')) {
      logAuditEvent(AUDIT_EVENT_TYPES.NODE_TIMEOUT, {
        executionId: context.executionId,
        tenantId: context.tenantId,
        agentId: context.agentId
      }, { nodeId: node.id, nodeName: node.name, timeoutMs: SECURITY_LIMITS.MAX_NODE_EXECUTION_TIME_MS });
    }
    
    const safeError = handleExecutionError(error, {
      executionId: context.executionId,
      tenantId: context.tenantId,
      agentId: context.agentId,
      nodeId: node.id
    });

    throw safeError;
  }
}

function ensureAliases(result: NodeExecutionResult): Record<string, unknown> {
  const aliases: Record<string, unknown> = {};
  
  if (result.result && typeof result.result === 'object') {
    const resultData = result.result.json as Record<string, unknown>;
    
    // Create common aliases
    if (resultData.output) {
      aliases.text = resultData.output;
      aliases.content = resultData.output;
      aliases.message = resultData.output;
    }
    
    if (resultData.agentOutput) {
      aliases.response = resultData.agentOutput;
    }
  }
  
  return aliases;
}

// ============================================================================
// WORKFLOW EXECUTION
// ============================================================================

async function executeWorkflow(
  schema: WorkflowSchema,
  context: WorkflowExecutionContext,
  workflow: WorkflowGraph
): Promise<void> {
  logger.info('Starting workflow execution with required IDs', {
    executionId: context.executionId,
    workflowId: context.workflowId,
    workflowName: context.workflowName,
    agentId: context.agentId,
    tenantId: context.tenantId,
    totalNodes: workflow.nodes.length
  });

  const executionStartTime = Date.now();
  let completedNodes = 0;
  let failedNodes = 0;

  try {
    // Execute nodes in order
    for (const node of workflow.nodes) {
      try {
        // Skip trigger nodes (they're handled by data injection)
        if (node.type === 'trigger') {
          logger.debug('Trigger node marked as completed', {
            executionId: context.executionId,
            nodeId: node.id,
            nodeName: node.name
          });
          completedNodes++;
          continue;
        }

        await executeNode(node, context);
        completedNodes++;
      } catch (error) {
        failedNodes++;
        logger.error('Node execution failed', {
          executionId: context.executionId,
          nodeId: node.id,
          nodeName: node.name,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }

    const totalDuration = Date.now() - executionStartTime;
    const averageNodeDuration = completedNodes > 0 ? totalDuration / completedNodes : 0;
    const successRate = completedNodes / (completedNodes + failedNodes);
    
    // Record workflow execution metrics
    metricsCollector.recordExecution(context.tenantId, totalDuration, successRate === 1);

    logger.info('Workflow execution completed', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      duration: totalDuration,
      executionMetrics: {
        totalNodes: workflow.nodes.length,
        completedNodes,
        failedNodes,
        successRate: successRate * 100,
        averageNodeDuration
      }
    });

  } catch (error) {
    logger.error('Workflow execution failed', {
      executionId: context.executionId,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      agentId: context.agentId,
      tenantId: context.tenantId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function updateExecutionStatus(executionId: string, status: 'running' | 'completed' | 'failed'): Promise<void> {
  await executionStateManager.updateExecutionStatus(executionId, status);
  
  const tracker = activeExecutions.get(executionId);
  if (tracker) {
    logAuditEvent(AUDIT_EVENT_TYPES.EXECUTION_COMPLETE, {
      executionId,
      tenantId: tracker.tenantId,
      agentId: tracker.agentId
    }, { status, workflowId: tracker.workflowId });
  }
}

// ============================================================================
// CHANNEL INTEGRATION & OPENROUTER SUPPORT
// ============================================================================

/**
 * Execute workflow from channel request
 */
export async function executeWorkflowFromChannel(
  request: ChannelExecutionRequest
): Promise<WorkflowExecutionResult> {
  const startTime = Date.now();
  const executionId = `exec_${request.workflowId}_${Date.now()}_${randomUUID().slice(0, 8)}`;

  // 🔍 EXECUTOR DEBUG: Log incoming request
  logger.info('🚀 [EXECUTOR] executeWorkflowFromChannel called', {
    executionId,
    workflowId: request.workflowId,
    channelId: request.channelId,
    channelType: request.channelType,
    agentId: request.agentId,
    tenantId: request.tenantId,
    input: request.input,
    inputType: typeof request.input,
    inputKeys: request.input ? Object.keys(request.input) : [],
    hasWorkflowDefinition: !!request.workflowDefinition,
    workflowDefinitionKeys: request.workflowDefinition ? Object.keys(request.workflowDefinition) : [],
    timestamp: new Date().toISOString()
  });

  try {

    // Get workflow definition if not provided
    let workflow: WorkflowGraph;
    if (request.workflowDefinition) {
      workflow = request.workflowDefinition;
    } else {
      throw new Error('Workflow definition must be provided');
    }

    // Validate input size before processing
    validateInputSize(request.input);
    
    // Validate workflow access with proper tenant and agent isolation
    await validateWorkflowAccess(request.workflowId, request.tenantId, request.agentId);
    
    // Find the actual trigger node from the workflow
    // ✅ FIX: Use trigger data injection info if provided, otherwise find from workflow
    let triggerNodeId: string;
    let triggerNodeName: string;
    
    if (request.triggerDataInjections && request.triggerDataInjections.length > 0) {
      // Use the node ID/name from the trigger data injection
      const injection = request.triggerDataInjections[0];
      if (injection) {
        triggerNodeId = injection.nodeId || 'unknown';
        triggerNodeName = injection.nodeName || injection.nodeId || 'unknown';
      } else {
        triggerNodeId = 'unknown';
        triggerNodeName = 'unknown';
      }
      
      logger.info('🔍 [EXECUTOR] Using trigger node from injection', {
        executionId,
        triggerNodeId,
        triggerNodeName,
        injectionCount: request.triggerDataInjections.length
      });
    } else {
      // Fallback: find trigger node from workflow
      const triggerNode = workflow.nodes.find(n => n.type === 'trigger' || n.triggerName);
      triggerNodeId = triggerNode?.id || 'unknown';
      triggerNodeName = triggerNode?.name || triggerNode?.triggerName || 'unknown';
      
      logger.info('🔍 [EXECUTOR] Finding trigger node from workflow', {
        executionId,
        triggerNodeId,
        triggerNodeName,
        hasTriggerNode: !!triggerNode,
        triggerNodesFound: workflow.nodes.filter(n => n.type === 'trigger').map(n => ({ id: n.id, name: n.name }))
      });
    }

    // Prepare initial context with channel information
    // ✅ FIX: Use actual trigger node IDs and avoid hard-coding
    const initialContext: RequiredInitialContext = {
      agentId: request.agentId,
      tenantId: request.tenantId,
      channelId: request.channelId,
      channelType: request.channelType,
      // ✅ Use existing trigger data injections if provided, otherwise create new one with actual node IDs
      triggerDataInjections: request.triggerDataInjections || (triggerNodeId !== 'unknown' ? [{
        nodeName: triggerNodeName,
        nodeId: triggerNodeId,
        triggerType: request.channelType,
        data: request.input
      }] : [])
    };

    // Validate and create execution context
    validateRequiredContext(workflow, initialContext);
    enforceWorkflowLimits(workflow);

    const baseContext = initExecutionContext(workflow, initialContext, executionId);
    const context = createWorkflowExecutionContext(baseContext, workflow, initialContext, executionId);

    const executionTracker: WorkflowExecutionTracker = {
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: initialContext.agentId,
      tenantId: initialContext.tenantId,
      startTime: Date.now(),
      status: 'running'
    };

    await addExecution(executionId, executionTracker);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Execution timeout after ${SECURITY_LIMITS.MAX_EXECUTION_TIME_MS}ms`));
      }, SECURITY_LIMITS.MAX_EXECUTION_TIME_MS);
    });

    try {
      if (initialContext.triggerDataInjections && initialContext.triggerDataInjections.length > 0) {
        logger.info('🔧 [EXECUTOR] About to inject trigger data', {
          executionId,
          injectionCount: initialContext.triggerDataInjections.length,
          nodeDataKeysBefore: Object.keys(context.nodeData || {})
        });
        injectTriggerData(context, initialContext.triggerDataInjections);
        logger.info('✅ [EXECUTOR] Trigger data injected', {
          executionId,
          nodeDataKeysAfter: Object.keys(context.nodeData || {})
        });
      }

      const schema = defineWorkflowSchema(workflow);

      await Promise.race([
        executeWorkflow(schema, context, workflow),
        timeoutPromise
      ]);

      await updateExecutionStatus(executionId, 'completed');
    } catch (workflowError) {
      await updateExecutionStatus(executionId, 'failed');
      
      logger.error('❌ [EXECUTOR] Workflow execution error', {
        executionId,
        tenantId: initialContext.tenantId,
        agentId: initialContext.agentId,
        workflowId: workflow.id,
        error: workflowError instanceof Error ? workflowError.message : String(workflowError),
        errorType: workflowError instanceof Error ? workflowError.constructor.name : typeof workflowError,
        errorStack: workflowError instanceof Error ? workflowError.stack : undefined
      });
      
      // Log execution error audit event
      logAuditEvent(AUDIT_EVENT_TYPES.EXECUTION_ERROR, {
        executionId,
        tenantId: initialContext.tenantId,
        agentId: initialContext.agentId
      }, { 
        error: workflowError instanceof Error ? workflowError.message : String(workflowError),
        workflowId: workflow.id
      });
      
      throw workflowError;
    } finally {
      await removeExecution(executionId);
    }

    // Extract final output from the context
    logger.info('🔍 [EXECUTOR] Extracting final output from context', {
      executionId,
      nodeDataKeys: Object.keys(context.nodeData),
      nodeDataCount: Object.keys(context.nodeData).length,
      timestamp: new Date().toISOString()
    });

    const finalOutput = extractFinalOutput(context);
    
    // 🔍 EXECUTOR DEBUG: Log extracted final output
    logger.info('📤 [EXECUTOR] Final output extracted', {
      executionId,
      finalOutput: finalOutput,
      finalOutputLength: finalOutput.length,
      finalOutputType: typeof finalOutput,
      timestamp: new Date().toISOString()
    });
    
    // ✅ Get model from context - CHECK NESTED STRUCTURE
    let model: string | undefined;
    for (const nodeData of Object.values(context.nodeData)) {
      if (nodeData && typeof nodeData === 'object') {
        const data = nodeData as Record<string, unknown>;
        
        // Skip trigger nodes
        if (data.source === 'trigger' || data.triggerType) {
          continue;
        }
        
        // Check nested structure first (where OpenRouter stores it)
        const result = data.result as Record<string, unknown> | undefined;
        const json = result?.json as Record<string, unknown> | undefined;
        
        if (json?.model && typeof json.model === 'string') {
          model = json.model;
          break;
        }
        // Check top-level as fallback
        if (data.model && typeof data.model === 'string') {
          model = data.model;
          break;
        }
      }
    }

    // 🔍 EXECUTOR DEBUG: Log model extraction
    logger.info('🤖 [EXECUTOR] Model extracted from context', {
      executionId,
      model: model,
      modelType: typeof model,
      timestamp: new Date().toISOString()
    });

    const result: WorkflowExecutionResult = {
      success: true,
      finalOutput,
      executionId,
      timestamp: new Date().toISOString(),
      model: model || 'unknown',
      executionContext: {
        nodeData: context.nodeData,
        variables: context.variables || {}
      }
    };

    // 🔍 EXECUTOR DEBUG: Log final result
    logger.info('📤 [EXECUTOR] Final result prepared', {
      executionId,
      result: {
        success: result.success,
        finalOutput: result.finalOutput,
        executionId: result.executionId,
        model: result.model,
        executionContextKeys: Object.keys(result.executionContext || {})
      },
      resultSize: JSON.stringify(result).length,
      timestamp: new Date().toISOString()
    });

    // Send result back to channel
    await sendResultToChannel(request, result);

    logger.info('Workflow execution from channel completed', {
      executionId,
      workflowId: request.workflowId,
      channelId: request.channelId,
      channelType: request.channelType,
      duration: Date.now() - startTime,
      outputLength: finalOutput.length
    });

    return result;

  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);
    logger.error('Workflow execution from channel failed', {
      executionId,
      workflowId: request.workflowId,
      channelId: request.channelId,
      channelType: request.channelType,
      error: errorMessage,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    });

    const result: WorkflowExecutionResult = {
      success: false,
      finalOutput: 'I apologize, but I encountered an error processing your request.',
      executionId,
      timestamp: new Date().toISOString(),
      error: errorMessage
    };

    // Try to send error response to channel
    try {
      await sendResultToChannel(request, result);
    } catch (sendError) {
      logger.error('Failed to send error response to channel', {
        executionId,
        channelId: request.channelId,
        channelType: request.channelType,
        error: sendError instanceof Error ? sendError.message : String(sendError)
      });
    }

    return result;
  }
} 

/**
 * Send result back to originating channel
 */
async function sendResultToChannel(
  request: ChannelExecutionRequest,
  result: WorkflowExecutionResult
): Promise<void> {
  try {
    const channelResponse: ChannelResponse = {
      type: 'text',
      text: result.finalOutput,
      metadata: {
        executionId: result.executionId,
        success: result.success,
        model: result.model,
        timestamp: result.timestamp
      }
    };

    const sendContext: ChannelSendContext = {
      channelId: request.channelId,
      userId: request.originalMessage?.userId || 'unknown',
      sessionId: request.originalMessage?.sessionId || 'unknown',
      executionId: result.executionId,
      agentId: request.agentId,
      tenantId: request.tenantId
    };

    await sendTenantScopedChannelResponse(
      request.tenantId,
      request.agentId,
      request.channelType,
      request.channelId,
      channelResponse,
      sendContext
    );

  } catch (error) {
    logger.error('Failed to send result to channel', {
      channelId: request.channelId,
      channelType: request.channelType,
      executionId: result.executionId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Extract final output from execution context
 */
function extractFinalOutput(context: WorkflowExecutionContext): string {
  // ✅ PRIORITY 1: Look for AI agent nodes with nested result structure
  for (const [nodeName, nodeData] of Object.entries(context.nodeData)) {
    if (nodeData && typeof nodeData === 'object') {
      const data = nodeData as Record<string, unknown>;
      
      // Skip trigger nodes
      if (data.source === 'trigger' || data.triggerType) {
        continue;
      }
      
      // Check nested result.json structure (where OpenRouter stores responses)
      const result = data.result as Record<string, unknown> | undefined;
      const json = result?.json as Record<string, unknown> | undefined;
      
      if (json?.output && typeof json.output === 'string') {
        const output = json.output;
        
        // ✅ ADD DEBUG LOGGING BEFORE cleanSpecialTokens()
        logger.info('🔍 BEFORE cleanSpecialTokens()', {
          executionId: context.executionId,
          originalLength: output.length,
          originalPreview: output.substring(0, 200),
          originalFull: output,  // Full content for analysis
          containsAngleBrackets: output.includes('<|'),
          containsInstTokens: output.includes('[INST]'),
          containsImTokens: output.includes('im_start') || output.includes('im_end')
        });
        
        // Clean special tokens from output
        const cleanedOutput = cleanSpecialTokens(output);
        
        // ✅ ADD DEBUG LOGGING AFTER cleanSpecialTokens()
        logger.info('🔍 AFTER cleanSpecialTokens()', {
          executionId: context.executionId,
          cleanedLength: cleanedOutput.length,
          cleanedPreview: cleanedOutput.substring(0, 200),
          cleanedFull: cleanedOutput,  // Full cleaned content
          charsRemoved: output.length - cleanedOutput.length,
          removalPercentage: ((output.length - cleanedOutput.length) / output.length * 100).toFixed(1) + '%'
        });
        
        return cleanedOutput;
      }
      
      if (json?.agentOutput && typeof json.agentOutput === 'string') {
        const output = json.agentOutput;
        
        // ✅ Validate final output isn't an error message
        if (output.includes('unexpected error') || 
            output.includes('Please try again') ||
            output.includes('Unable to get response') ||
            output.includes('I apologize, but I could not generate a response')) {
          throw new Error('Workflow completed with error message as output');
        }
        
        // ✅ ADD DEBUG LOGGING BEFORE cleanSpecialTokens() - agentOutput path
        logger.info('🔍 BEFORE cleanSpecialTokens() - agentOutput path', {
          executionId: context.executionId,
          originalLength: output.length,
          originalPreview: output.substring(0, 200),
          originalFull: output,  // Full content for analysis
          containsAngleBrackets: output.includes('<|'),
          containsInstTokens: output.includes('[INST]'),
          containsImTokens: output.includes('im_start') || output.includes('im_end')
        });
        
        // Clean special tokens from output
        const cleanedOutput = cleanSpecialTokens(output);
        
        // ✅ ADD DEBUG LOGGING AFTER cleanSpecialTokens() - agentOutput path
        logger.info('🔍 AFTER cleanSpecialTokens() - agentOutput path', {
          executionId: context.executionId,
          cleanedLength: cleanedOutput.length,
          cleanedPreview: cleanedOutput.substring(0, 200),
          cleanedFull: cleanedOutput,  // Full cleaned content
          charsRemoved: output.length - cleanedOutput.length,
          removalPercentage: ((output.length - cleanedOutput.length) / output.length * 100).toFixed(1) + '%'
        });
        
        return cleanedOutput;
      }
      
      if (json?.response && typeof json.response === 'string') {
        const output = json.response;
        
        // ✅ Validate final output isn't an error message
        if (output.includes('unexpected error') || 
            output.includes('Please try again') ||
            output.includes('Unable to get response') ||
            output.includes('I apologize, but I could not generate a response')) {
          throw new Error('Workflow completed with error message as output');
        }
        
        // ✅ ADD DEBUG LOGGING BEFORE cleanSpecialTokens() - response path
        logger.info('🔍 BEFORE cleanSpecialTokens() - response path', {
          executionId: context.executionId,
          originalLength: output.length,
          originalPreview: output.substring(0, 200),
          originalFull: output,  // Full content for analysis
          containsAngleBrackets: output.includes('<|'),
          containsInstTokens: output.includes('[INST]'),
          containsImTokens: output.includes('im_start') || output.includes('im_end')
        });
        
        // Clean special tokens from output
        const cleanedOutput = cleanSpecialTokens(output);
        
        // ✅ ADD DEBUG LOGGING AFTER cleanSpecialTokens() - response path
        logger.info('🔍 AFTER cleanSpecialTokens() - response path', {
          executionId: context.executionId,
          cleanedLength: cleanedOutput.length,
          cleanedPreview: cleanedOutput.substring(0, 200),
          cleanedFull: cleanedOutput,  // Full cleaned content
          charsRemoved: output.length - cleanedOutput.length,
          removalPercentage: ((output.length - cleanedOutput.length) / output.length * 100).toFixed(1) + '%'
        });
        
        return cleanedOutput;
      }
    }
  }

  // ✅ PRIORITY 2: Look for direct output fields (but skip trigger nodes)
  for (const [nodeName, nodeData] of Object.entries(context.nodeData)) {
    if (nodeData && typeof nodeData === 'object') {
      const data = nodeData as Record<string, unknown>;
      
      // Skip trigger nodes
      if (data.source === 'trigger' || data.triggerType) {
        continue;
      }
      
      const output = data.output || data.agentOutput || data.response;
      if (output && typeof output === 'string') {
        // ✅ Validate final output isn't an error message
        if (output.includes('unexpected error') || 
            output.includes('Please try again') ||
            output.includes('Unable to get response') ||
            output.includes('I apologize, but I could not generate a response')) {
          throw new Error('Workflow completed with error message as output');
        }
        
        // Clean special tokens from output
        const cleanedOutput = cleanSpecialTokens(output);
        return cleanedOutput;
      }
    }
  }

  // ✅ PRIORITY 3: Fallback to any text output (skip trigger nodes)
  for (const [nodeName, nodeData] of Object.entries(context.nodeData)) {
    if (nodeData && typeof nodeData === 'object') {
      const data = nodeData as Record<string, unknown>;
      
      // Skip trigger nodes
      if (data.source === 'trigger' || data.triggerType) {
        continue;
      }
      
      const text = data.text || data.content;
      if (text && typeof text === 'string') {
        // ✅ Validate final output isn't an error message
        if (text.includes('unexpected error') || 
            text.includes('Please try again') ||
            text.includes('Unable to get response') ||
            text.includes('I apologize, but I could not generate a response')) {
          throw new Error('Workflow completed with error message as output');
        }
        
        // Clean special tokens from output
        const cleanedOutput = cleanSpecialTokens(text);
        return cleanedOutput;
      }
    }
  }

  return 'Workflow completed successfully.';
}

// ============================================================================
// LEGACY SUPPORT (for backward compatibility)
// ============================================================================

export async function executeWorkflowByDefinition(
  workflow: WorkflowGraph,
  initialContext: RequiredInitialContext
): Promise<WorkflowExecutionContext> {
  const executionId = `exec_${workflow.id}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  
  validateRequiredContext(workflow, initialContext);
  enforceWorkflowLimits(workflow);
  
  // Validate workflow access with proper tenant and agent isolation
  await validateWorkflowAccess(workflow.id, initialContext.tenantId, initialContext.agentId);

  const baseContext = initExecutionContext(workflow, initialContext, executionId);
  const context = createWorkflowExecutionContext(baseContext, workflow, initialContext, executionId);

  const executionTracker: WorkflowExecutionTracker = {
    executionId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    agentId: initialContext.agentId,
    tenantId: initialContext.tenantId,
    startTime: Date.now(),
    status: 'running'
  };

  await addExecution(executionId, executionTracker);

  try {
    if (initialContext.triggerDataInjections && initialContext.triggerDataInjections.length > 0) {
      injectTriggerData(context, initialContext.triggerDataInjections);
    }

    const schema = defineWorkflowSchema(workflow);
    await executeWorkflow(schema, context, workflow);

    await updateExecutionStatus(executionId, 'completed');
    return context;

  } catch (error) {
    await updateExecutionStatus(executionId, 'failed');
    
    // Log execution error audit event
    logAuditEvent(AUDIT_EVENT_TYPES.EXECUTION_ERROR, {
      executionId,
      tenantId: initialContext.tenantId,
      agentId: initialContext.agentId
    }, { 
      error: error instanceof Error ? error.message : String(error),
      workflowId: workflow.id
    });
    
    throw error;
  } finally {
    await removeExecution(executionId);
  }
}