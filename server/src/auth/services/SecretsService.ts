// auth/services/SecretsService.ts
import crypto from 'crypto';
import logger from '../../utils/logger';
import TenantSecretsRepository from '../../database/repositories/TenantSecretsRepository';

/**
 * SECURITY CRITICAL: Secrets Management Service
 * 
 * Manages encrypted secrets (LLM API keys, OAuth tokens, webhooks, integrations)
 * using Postgres as the single source of truth.
 * 
 * IMPORTANT DESIGN PRINCIPLES:
 * 1. ALL secrets stored encrypted in Postgres (tenant_secrets table)
 * 2. NEVER store raw API keys in memory or cache
 * 3. Decrypt keys only at runtime when needed
 * 4. NO key material in logs (not even masked previews)
 * 5. Support key rotation without downtime
 * 6. Fail closed - app won't start without encryption key in production
 * 
 * SECURITY GUARANTEES:
 * ✓ No in-memory storage (Redis or Map)
 * ✓ No key material in logs
 * ✓ AES-256-GCM encryption with exact 32-byte keys
 * ✓ Secrets persist across restarts
 * ✓ Multi-tenant isolation enforced by DB
 */

export interface SecretReference {
    secretId: string;
    vaultType: 'postgres'; // Using Postgres as our secure vault
    scope: 'tenant' | 'workspace' | 'agent';
    scopeId: string;
    provider: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom';
    createdAt: string;
    updatedAt: string;
}

export interface SecretMetadata {
    lastRotated?: string;
    expiresAt?: string;
    refreshToken?: string;
    tokenType?: string;
    provider: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom';
}

export interface StoreSecretParams {
    tenantId: string;
    scope: 'tenant' | 'workspace' | 'agent';
    scopeId: string;
    provider?: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom';
    metadata?: Partial<SecretMetadata>;
}

/**
 * SecretsService - Secure management of encrypted secrets
 * 
 * ALL secrets are encrypted with AES-256-GCM and stored in Postgres.
 * NO in-memory or Redis caching of secrets.
 */
class SecretsService {
    private readonly encryptionKeyBuffer: Buffer;
    private readonly ALGORITHM = 'aes-256-gcm';
    private readonly REQUIRED_KEY_LENGTH = 32; // 32 bytes = 256 bits for AES-256

    constructor() {
        const rawKey = process.env.SECRETS_ENCRYPTION_KEY;

        // CRITICAL: Fail in production if encryption key is missing
        if (!rawKey && process.env.NODE_ENV === 'production') {
            throw new Error(
                '🚨 SECURITY ERROR: SECRETS_ENCRYPTION_KEY environment variable is required in production. ' +
                'Application cannot start without it. ' +
                'Generate a key with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
            );
        }

        // Generate secure key for development only
        const encryptionKey = rawKey || (() => {
            logger.warn(
                '⚠️  SecretsService using generated encryption key for DEVELOPMENT ONLY. ' +
                'Set SECRETS_ENCRYPTION_KEY in production! ' +
                'Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
            );
            return crypto.randomBytes(32).toString('hex');
        })();

        // Validate key is exactly 32 bytes (64 hex characters)
        try {
            this.encryptionKeyBuffer = Buffer.from(encryptionKey, 'hex');
        } catch (error) {
            throw new Error(
                'SECRETS_ENCRYPTION_KEY must be a valid hex string. ' +
                'Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
            );
        }

        if (this.encryptionKeyBuffer.length !== this.REQUIRED_KEY_LENGTH) {
            throw new Error(
                `SECRETS_ENCRYPTION_KEY must be exactly ${this.REQUIRED_KEY_LENGTH} bytes (64 hex characters). ` +
                `Received: ${this.encryptionKeyBuffer.length} bytes. ` +
                'Generate a valid key with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"'
            );
        }

        logger.info('✓ SecretsService initialized with Postgres-backed AES-256-GCM encryption');
    }

    /**
     * Store a secret securely in the database
     * @param key - The plaintext secret to encrypt and store
     * @param params - Tenant, scope, and metadata information
     * @returns The secret ID for future retrieval
     */
    async storeSecret(key: string, params: StoreSecretParams): Promise<string> {
        try {
            if (!key || key.length < 10) {
                throw new Error('Invalid API key format: key too short');
            }

            // Detect provider from key format if not specified
            const provider = params.provider || this.detectProvider(key);

            // Validate key format for known providers
            if (!this.validateKeyFormat(key, provider)) {
                throw new Error(`Invalid key format for provider: ${provider}`);
            }

            // Encrypt the key
            const encrypted = this.encryptKey(key);

            // Prepare metadata
            const metadata: SecretMetadata = {
                provider,
                lastRotated: new Date().toISOString(),
                ...params.metadata,
            };

            // Store in database via repository
            const secret = await TenantSecretsRepository.createSecret({
                tenant_id: params.tenantId,
                scope: params.scope,
                scope_id: params.scopeId,
                provider,
                encrypted_value: encrypted,
                metadata,
            });

            // SECURITY: Log metadata only - NO key material
            logger.info('Secret stored successfully', {
                secretId: secret.id,
                tenantId: this.maskId(params.tenantId),
                scope: params.scope,
                scopeId: this.maskId(params.scopeId),
                provider,
            });

            return secret.id;
        } catch (error) {
            logger.error('Failed to store secret', {
                error: error instanceof Error ? error.message : 'Unknown error',
                tenantId: this.maskId(params.tenantId),
                scope: params.scope,
            });
            throw error;
        }
    }

    /**
     * Retrieve and decrypt a secret from the database
     * @param secretId - The ID of the secret to retrieve
     * @returns The decrypted secret, or null if not found
     */
    async getSecret(secretId: string): Promise<string | null> {
        try {
            // Fetch from database
            const secret = await TenantSecretsRepository.getSecretById(secretId);

            if (!secret) {
                logger.warn('Secret not found', {
                    secretId: this.maskId(secretId)
                });
                return null;
            }

            // Decrypt the value
            const decrypted = this.decryptKey(secret.encrypted_value);

            // SECURITY: Log metadata only - NO key material
            logger.info('Secret retrieved', {
                secretId: this.maskId(secretId),
                provider: secret.provider,
            });

            return decrypted;
        } catch (error) {
            logger.error('Failed to retrieve secret', {
                error: error instanceof Error ? error.message : 'Unknown error',
                secretId: this.maskId(secretId),
            });
            return null;
        }
    }

    /**
     * Rotate a secret by re-encrypting with a new value
     * @param secretId - The ID of the secret to rotate
     * @param newKey - The new plaintext secret value
     * @returns True if rotation succeeded
     */
    async rotateSecret(secretId: string, newKey: string): Promise<boolean> {
        try {
            // Fetch existing secret
            const existing = await TenantSecretsRepository.getSecretById(secretId);

            if (!existing) {
                logger.warn('Cannot rotate non-existent secret', {
                    secretId: this.maskId(secretId),
                });
                return false;
            }

            // Validate new key format
            if (!this.validateKeyFormat(newKey, existing.provider)) {
                throw new Error(`Invalid key format for provider: ${existing.provider}`);
            }

            // Encrypt new key
            const encrypted = this.encryptKey(newKey);

            // Update metadata with rotation timestamp
            const updatedMetadata: SecretMetadata = {
                ...(existing.metadata as SecretMetadata || {}),
                lastRotated: new Date().toISOString(),
            };

            // Update in database
            await TenantSecretsRepository.updateSecret(
                secretId,
                encrypted,
                updatedMetadata
            );

            logger.info('Secret rotated successfully', {
                secretId: this.maskId(secretId),
                provider: existing.provider,
            });

            return true;
        } catch (error) {
            logger.error('Failed to rotate secret', {
                error: error instanceof Error ? error.message : 'Unknown error',
                secretId: this.maskId(secretId),
            });
            return false;
        }
    }

    /**
     * Permanently delete a secret from the database
     * @param secretId - The ID of the secret to delete
     * @returns True if deletion succeeded
     */
    async deleteSecret(secretId: string): Promise<boolean> {
        try {
            const deleted = await TenantSecretsRepository.deleteSecret(secretId);

            if (deleted) {
                logger.info('Secret deleted', {
                    secretId: this.maskId(secretId)
                });
            } else {
                logger.warn('Attempted to delete non-existent secret', {
                    secretId: this.maskId(secretId),
                });
            }

            return deleted;
        } catch (error) {
            logger.error('Failed to delete secret', {
                error: error instanceof Error ? error.message : 'Unknown error',
                secretId: this.maskId(secretId),
            });
            return false;
        }
    }

    /**
     * Get secret ID for a specific scope and provider
     * Returns the MOST RECENT secret based on updated_at timestamp
     * 
     * @param scope - The scope level (tenant, workspace, agent)
     * @param scopeId - The ID of the scoped entity
     * @param provider - Optional provider filter
     * @returns The secret ID, or null if not found
     */
    async getSecretIdForScope(
        scope: 'tenant' | 'workspace' | 'agent',
        scopeId: string,
        provider?: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom'
    ): Promise<string | null> {
        try {
            // Get all secrets for scope (repository handles sorting by updated_at DESC)
            const secrets = await TenantSecretsRepository.getSecretsByScope(scope, scopeId);

            // Filter by provider if specified
            const filtered = provider
                ? secrets.filter(s => s.provider === provider)
                : secrets;

            // Return the ID of the most recent secret
            // Note: Repository MUST return secrets sorted by updated_at DESC
            const mostRecent = filtered[0];

            if (!mostRecent) {
                logger.debug('No secret found for scope', {
                    scope,
                    scopeId: this.maskId(scopeId),
                    provider: provider || 'any',
                });
                return null;
            }

            return mostRecent.id;
        } catch (error) {
            logger.error('Failed to get secret ID for scope', {
                error: error instanceof Error ? error.message : 'Unknown error',
                scope,
                scopeId: this.maskId(scopeId),
                provider: provider || 'any',
            });
            return null;
        }
    }

    /**
     * Encrypt a plaintext key using AES-256-GCM
     * @param plaintext - The plaintext secret to encrypt
     * @returns Encrypted string in format: iv:authTag:ciphertext
     */
    private encryptKey(plaintext: string): string {
        // Generate random IV (initialization vector)
        const iv = crypto.randomBytes(16);

        // Create cipher with our validated 32-byte key
        const cipher = crypto.createCipheriv(
            this.ALGORITHM,
            this.encryptionKeyBuffer,
            iv
        );

        // Encrypt the plaintext
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        // Get authentication tag for GCM mode
        const authTag = (cipher as any).getAuthTag().toString('hex');

        // Return in format: iv:authTag:ciphertext
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    /**
     * Decrypt an encrypted key using AES-256-GCM
     * @param encrypted - The encrypted string in format: iv:authTag:ciphertext
     * @returns The decrypted plaintext secret
     */
    private decryptKey(encrypted: string): string {
        const parts = encrypted.split(':');

        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
            throw new Error('Invalid encrypted key format: expected iv:authTag:ciphertext');
        }

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const ciphertext = parts[2];

        // Validate IV length
        if (iv.length !== 16) {
            throw new Error('Invalid IV length: expected 16 bytes');
        }

        // Create decipher with our validated 32-byte key
        const decipher = crypto.createDecipheriv(
            this.ALGORITHM,
            this.encryptionKeyBuffer,
            iv
        );

        // Set authentication tag
        (decipher as any).setAuthTag(authTag);

        // Decrypt the ciphertext
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Detect provider type from key format
     */
    private detectProvider(key: string): 'openai' | 'anthropic' | 'google' | 'custom' {
        if (key.startsWith('sk-') && !key.startsWith('sk-ant-')) return 'openai';
        if (key.startsWith('sk-ant-')) return 'anthropic';
        if (key.startsWith('AIza')) return 'google';
        return 'custom';
    }

    /**
     * Mask an ID for safe logging
     * Used for secretId, tenantId, scopeId - NOT for API keys
     */
    private maskId(id: string): string {
        if (!id) return '***';
        if (id.length < 16) {
            return id.slice(0, 8) + '...';
        }
        return id.slice(0, 8) + '...' + id.slice(-4);
    }

    /**
     * Validate key format for a specific provider
     */
    public validateKeyFormat(
        key: string,
        provider: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom'
    ): boolean {
        if (!key) return false;

        switch (provider) {
            case 'openai':
                // OpenAI keys: sk-... or sk-proj-... (legacy and new format)
                return (key.startsWith('sk-') || key.startsWith('sk-proj-')) &&
                    key.length > 20;
            case 'anthropic':
                // Anthropic keys: sk-ant-...
                return key.startsWith('sk-ant-') && key.length > 20;
            case 'google':
                // Google API keys: AIza...
                return key.startsWith('AIza') && key.length > 20;
            case 'slack':
                // Slack tokens: xoxb-... or xoxp-...
                return (key.startsWith('xoxb-') || key.startsWith('xoxp-')) &&
                    key.length > 20;
            case 'webhook':
                // Webhooks can be any URL or token format
                return key.length >= 10;
            case 'custom':
                // Custom keys must be at least 10 characters
                return key.length >= 10;
            default:
                return false;
        }
    }

    /**
     * Get encryption info for health checks (NO key material exposed)
     */
    public getEncryptionInfo(): {
        algorithm: string;
        keyLength: number;
        isProduction: boolean;
    } {
        return {
            algorithm: this.ALGORITHM,
            keyLength: this.encryptionKeyBuffer.length,
            isProduction: process.env.NODE_ENV === 'production',
        };
    }
}

export default new SecretsService();