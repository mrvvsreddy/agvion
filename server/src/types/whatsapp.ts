// path: types/whatsapp.ts
export interface WhatsAppText {
  body: string;
}

export interface WebhookVerificationParams {
  mode: string;
  token: string;
  challenge: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  service: string;
  version?: string;
  environment: {
    nodeEnv: string;
    hasVerifyToken: boolean;
    memoryUsage: NodeJS.MemoryUsage;
    responseTimeMs: number;
  };
  dependencies: {
    workflowFinderService: unknown;
  };
}

export interface WhatsAppImage {
  id: string;
  mime_type?: string;
  caption?: string;
}

export interface WhatsAppAudio {
  id: string;
  mime_type?: string;
}

export interface WhatsAppDocument {
  id: string;
  mime_type?: string;
  filename?: string;
  caption?: string;
}

export interface WhatsAppLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export type WhatsAppMessageType = 
  | 'text' 
  | 'image' 
  | 'audio' 
  | 'document' 
  | 'location'
  | 'video' 
  | 'contacts' 
  | 'interactive' 
  | 'button' 
  | 'system'
  | 'unknown';

export interface WhatsAppMessage {
  id: string;
  from: string;
  to: string;
  timestamp: number;
  type: WhatsAppMessageType;
  text?: WhatsAppText;
  image?: WhatsAppImage;
  audio?: WhatsAppAudio;
  document?: WhatsAppDocument;
  location?: WhatsAppLocation;
  messageText: string;
}

export interface WhatsAppWebhookPayload {
  messages: boolean;
  metadata: any;
  contacts: boolean;
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        contacts: boolean;
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        messages?: WhatsAppMessage[];
        statuses?: any[];
      };
      field: string;
    }>;
  }>;
}

// New normalized WhatsApp message structure for execution
export interface NormalizedWhatsAppMessage {
  readonly id: string;
  readonly from: string;
  readonly to?: string;
  readonly timestamp: string;
  readonly type: WhatsAppMessageType;
  readonly text?: string;
  readonly caption?: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly mediaId?: string;
  readonly location?: {
    readonly latitude: number;
    readonly longitude: number;
    readonly name?: string;
    readonly address?: string;
  };
  readonly isVoiceNote?: boolean;
  readonly rawContent?: Record<string, unknown>;
}

// New execution data structure with whatsapp instead of webhook
export interface WhatsAppExecutionData {
  readonly whatsapp: {
    readonly phoneNumberId: string;
    readonly displayPhoneNumber?: string;
    readonly message: NormalizedWhatsAppMessage;
    readonly contacts?: readonly unknown[];
    readonly statuses?: readonly unknown[];
  };
  readonly workflow: {
    readonly id: string;
    readonly name?: string;
    readonly agentId: string;
    readonly isActive: boolean;
    readonly triggerType: string;
    readonly triggerValue?: string;
    readonly data?: unknown;
    readonly createdAt?: string;
    readonly updatedAt?: string;
  };
  readonly tenant: {
    readonly id: string;
    readonly name?: string;
  };
  readonly processing: {
    readonly uniqueId: string;
    readonly processedAt: string;
    readonly receivedAt?: string;
    readonly source: string;
    readonly version?: string;
  };
  readonly rawWebhook?: unknown;
}

export interface ProcessedMessage {
  messageId: string;
  from: string;
  timestamp: string;
  messageType: WhatsAppMessageType;
  content: {
    text?: string;
    caption?: string;
    filename?: string;
    mimeType?: string;
    location?: {
      latitude?: number;
      longitude?: number;
      name?: string;
      address?: string;
    };
    mediaId?: string;
    isVoiceNote?: boolean;
    rawContent?: any;
  };
  context?: any;
  rawMessage: any;
}

export interface WhatsAppTriggerContext {
  messageCount: number;
  messages: ProcessedMessage[];
  primaryMessage: {
    messageId: string;
    from: string;
    messageType: string;
    content: any;
    timestamp: string;
  } | undefined;
  phoneNumberId: string | undefined;
  displayPhoneNumber: string | undefined;
  contacts: any[] | undefined;
  autoReadResults?: {
    attempted: boolean;
    successful: Array<{messageId: string, success: boolean, error?: string}>;
  } | undefined;
  rawWebhookData: any;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  triggerType: string;
  triggerValue: string;
  isActive: boolean;
  workflowData: any;
  createdAt?: string;
  updatedAt?: string;
  tenantId: string;
}

export interface TenantConfig {
  tenantId: string;
  name: string;
  whatsappPhoneNumberId: string;
  workflows: WorkflowConfig[];
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
}

// Legacy interface - kept for backward compatibility
export interface WorkflowExecutionData {
  message: WhatsAppMessage;
  webhook: {
    object: string;
    entry: any[];
    metadata: any;
    phoneNumberId: string;
    displayPhoneNumber?: string;
    contacts?: any[];
    statuses?: any[];
    messages: any[];
    rawPayload: any;
  };
  workflow: {
    id: string;
    name: string;
    triggerType: string;
    triggerValue: string;
    tenantId: string;
    data: any;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
  };
  tenant: {
    id: string;
    name: string;
    whatsappPhoneNumberId: string;
    createdAt?: string;
    updatedAt?: string;
    isActive?: boolean;
  };
  processing: {
    receivedAt: string;
    processedAt: string;
    uniqueId: string;
    source: string;
    version: string;
  };
  rawWebhook: WhatsAppWebhookPayload;
}

export interface DbTenant {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DbWorkflow {
  id: string;
  name: string;
  tenant_id: string;
  agent_id: string;
  workflow_data: any;
  status: string;
  workflow_version: string;
  settings: any;
  metadata: any;
  created_at: string;
  last_modified_at: string;
  last_modified_by: string;
}