// database/repositories/TenantSecretsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type TenantSecret = Database['public']['Tables']['tenant_secrets']['Row'];
type TenantSecretInsert = Database['public']['Tables']['tenant_secrets']['Insert'];
type TenantSecretUpdate = Database['public']['Tables']['tenant_secrets']['Update'];

export interface CreateSecretParams {
    tenant_id: string;
    scope: 'tenant' | 'workspace' | 'agent';
    scope_id: string;
    provider: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom';
    encrypted_value: string;
    metadata?: any;
}

export class TenantSecretsRepository extends BaseRepository<TenantSecret, TenantSecretInsert, TenantSecretUpdate> {
    constructor() {
        super('tenant_secrets');
    }

    /**
     * Create a new encrypted secret
     * SECURITY: encrypted_value must already be encrypted before calling this method
     */
    async createSecret(params: CreateSecretParams): Promise<TenantSecret> {
        try {
            const payload: TenantSecretInsert = {
                tenant_id: params.tenant_id,
                scope: params.scope,
                scope_id: params.scope_id,
                provider: params.provider,
                encrypted_value: params.encrypted_value,
                metadata: params.metadata || {},
            };

            const secret = await this.create(payload);

            logger.info('Secret created in database', {
                secretId: secret.id,
                tenantId: params.tenant_id,
                scope: params.scope,
                provider: params.provider,
            });

            return secret;
        } catch (error) {
            logger.error('Failed to create secret', { error, params: { ...params, encrypted_value: '[REDACTED]' } });
            throw error;
        }
    }

    /**
     * Get a secret by its ID
     * SECURITY: Returns encrypted value - caller must decrypt
     */
    async getSecretById(secretId: string): Promise<TenantSecret | null> {
        try {
            const { data, error } = await this.client
                .from('tenant_secrets')
                .select('*')
                .eq('id', secretId)
                .maybeSingle();

            if (error) {
                logger.error('Failed to get secret by ID', { error, secretId });
                throw new Error(`Failed to get secret by ID: ${error.message}`);
            }

            return (data as TenantSecret) ?? null;
        } catch (error) {
            logger.error('Error getting secret by ID', { error, secretId });
            throw error;
        }
    }

    /**
     * Get all secrets for a specific scope
     * 
     * IMPORTANT: Results are sorted by updated_at DESC
     * to ensure the most recent secret is returned first.
     * 
     * SECURITY: Returns encrypted values - caller must decrypt each
     */
    async getSecretsByScope(scope: 'tenant' | 'workspace' | 'agent', scopeId: string): Promise<TenantSecret[]> {
        try {
            const { data, error } = await this.client
                .from('tenant_secrets')
                .select('*')
                .eq('scope', scope)
                .eq('scope_id', scopeId)
                .order('updated_at', { ascending: false });

            if (error) {
                logger.error('Failed to get secrets by scope', { error, scope, scopeId });
                throw new Error(`Failed to get secrets by scope: ${error.message}`);
            }

            return data as TenantSecret[];
        } catch (error) {
            logger.error('Error getting secrets by scope', { error, scope, scopeId });
            throw error;
        }
    }

    /**
     * Get a secret by tenant ID and provider type
     * SECURITY: Returns encrypted value - caller must decrypt
     */
    async getSecretByProvider(
        tenantId: string,
        provider: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom'
    ): Promise<TenantSecret | null> {
        try {
            const { data, error } = await this.client
                .from('tenant_secrets')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('provider', provider)
                .eq('scope', 'tenant') // Tenant-level secrets only
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) {
                logger.error('Failed to get secret by provider', { error, tenantId, provider });
                throw new Error(`Failed to get secret by provider: ${error.message}`);
            }

            return (data as TenantSecret) ?? null;
        } catch (error) {
            logger.error('Error getting secret by provider', { error, tenantId, provider });
            throw error;
        }
    }

    /**
     * Update a secret with new encrypted value and metadata
     * SECURITY: encrypted_value must already be encrypted before calling this method
     */
    async updateSecret(
        secretId: string,
        encrypted_value: string,
        metadata?: any
    ): Promise<TenantSecret> {
        try {
            const updatePayload: TenantSecretUpdate = {
                encrypted_value,
                ...(metadata && { metadata }),
            };

            const { data, error } = await this.client
                .from('tenant_secrets')
                .update(updatePayload)
                .eq('id', secretId)
                .select('*')
                .single();

            if (error) {
                logger.error('Failed to update secret', { error, secretId });
                throw new Error(`Failed to update secret: ${error.message}`);
            }

            logger.info('Secret updated in database', { secretId });

            return data as TenantSecret;
        } catch (error) {
            logger.error('Error updating secret', { error, secretId });
            throw error;
        }
    }

    /**
     * Delete a secret by ID (hard delete)
     * SECURITY: Permanent deletion - cannot be recovered
     */
    async deleteSecret(secretId: string): Promise<boolean> {
        try {
            const { error } = await this.client
                .from('tenant_secrets')
                .delete()
                .eq('id', secretId);

            if (error) {
                logger.error('Failed to delete secret', { error, secretId });
                throw new Error(`Failed to delete secret: ${error.message}`);
            }

            logger.info('Secret deleted from database', { secretId });
            return true;
        } catch (error) {
            logger.error('Error deleting secret', { error, secretId });
            throw error;
        }
    }

    /**
     * Get all secrets for a tenant (across all scopes)
     * SECURITY: Admin/debug function - use with caution
     */
    async getSecretsByTenant(tenantId: string): Promise<TenantSecret[]> {
        try {
            const { data, error } = await this.client
                .from('tenant_secrets')
                .select('*')
                .eq('tenant_id', tenantId)
                .order('created_at', { ascending: false });

            if (error) {
                logger.error('Failed to get secrets by tenant', { error, tenantId });
                throw new Error(`Failed to get secrets by tenant: ${error.message}`);
            }

            return data as TenantSecret[];
        } catch (error) {
            logger.error('Error getting secrets by tenant', { error, tenantId });
            throw error;
        }
    }
}

export default new TenantSecretsRepository();
