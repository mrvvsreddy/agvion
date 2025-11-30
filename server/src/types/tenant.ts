// types/tenant.ts
export interface TenantConfig {
    tenantId: string;
    whatsappToken: string;
    whatsappPhoneNumberId: string;
    openaiApiKey: string;
    webhookVerifyToken: string;
    businessName?: string;
    businessDescription?: string;
    timezone?: string;
    language?: string;
    customFields?: Record<string, any>;
    integrations?: TenantIntegration[];
    settings?: TenantSettings;
    createdAt?: string;
    updatedAt?: string;
    isActive?: boolean;
  }
  
  export interface TenantIntegration {
    id: string;
    type: 'whatsapp' | 'openai' | 'webhook' | 'database' | 'email' | 'sms';
    name: string;
    config: Record<string, any>;
    isEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  }
  
  export interface TenantSettings {
    maxMessagesPerDay?: number;
    allowedMessageTypes?: ('text' | 'image' | 'document' | 'audio' | 'video')[];
    autoReply?: boolean;
    businessHours?: BusinessHours;
    rateLimiting?: RateLimitConfig;
    webhookRetries?: number;
    logLevel?: 'error' | 'warn' | 'info' | 'debug';
  }
  
  export interface BusinessHours {
    timezone: string;
    schedule: {
      [key in 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday']: {
        isOpen: boolean;
        openTime?: string; // HH:mm format
        closeTime?: string; // HH:mm format
      }
    };
  }
  
  export interface RateLimitConfig {
    messagesPerMinute: number;
    messagesPerHour: number;
    messagesPerDay: number;
    burstLimit: number;
  }
  
  export interface TenantStats {
    tenantId: string;
    messagesReceived: number;
    messagesSent: number;
    workflowsExecuted: number;
    errorsCount: number;
    lastActivity?: string;
    period: 'hour' | 'day' | 'week' | 'month';
  }
  
  // Type for tenant creation/update operations
  export interface CreateTenantRequest {
    tenantId: string;
    businessName: string;
    whatsappToken: string;
    whatsappPhoneNumberId: string;
    openaiApiKey?: string;
    webhookVerifyToken: string;
    businessDescription?: string;
    timezone?: string;
    language?: string;
    settings?: Partial<TenantSettings>;
  }
  
  export interface UpdateTenantRequest {
    businessName?: string;
    whatsappToken?: string;
    whatsappPhoneNumberId?: string;
    openaiApiKey?: string;
    webhookVerifyToken?: string;
    businessDescription?: string;
    timezone?: string;
    language?: string;
    settings?: Partial<TenantSettings>;
    isActive?: boolean;
  }