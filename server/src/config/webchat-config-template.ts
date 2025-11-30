// webchat-config-template.ts
// Template for webchat widget configuration files uploaded to R2
// Updated to match new security requirements (UUID-only, no base URL)

export interface WebchatConfigParams {
  agentName: string;
  agentSubtitle: string;
  companyLogo: string;
  companyInitials: string;
  hideWatermark: boolean;
  greeting: string;
  welcomeMessage: string;
  placeholder: string;
  autoResponseMessage: string;
  autoResponse: boolean;
  autoResponseDelay: number;
  persistMessages: boolean;
  waitForAgent: boolean;
  backendEnabled: boolean;
  webhookUuid: string;
  timeout: number;
  widgetId: string;
}

/**
 * Generate webchat config JavaScript file content
 * Uses the exact template format matching the reference config.js
 * Produces minified output matching the original template exactly
 * 
 * SECURITY NOTE: Only includes webhookUuid, not the full base URL
 * The base URL is stored securely in the widget file itself
 */
export function generateWebchatConfig(params: WebchatConfigParams): string {
  // Build config object matching the exact template structure
  const configObj = {
    colors: {
      primary: '#00C896',
      primaryDark: '#00A070',
      background: '#FFFFFF',
      text: '#1F1F1F',
      textLight: '#86868B',
      border: '#E5E5E5',
      inputBg: '#F5F5F7',
      botBubble: '#FFFFFF',
      userBubble: '#00C896'
    },
    branding: {
      agentName: params.agentName,
      agentSubtitle: params.agentSubtitle,
      companyLogo: params.companyLogo,
      companyInitials: params.companyInitials,
      hideWatermark: params.hideWatermark
    },
    content: {
      greeting: params.greeting,
      welcomeMessage: params.welcomeMessage,
      placeholder: params.placeholder,
      autoResponseMessage: params.autoResponseMessage
    },
    behavior: {
      autoResponse: params.autoResponse,
      autoResponseDelay: params.autoResponseDelay,
      persistMessages: params.persistMessages,
      waitForAgent: params.waitForAgent
    },
    backend: {
      enabled: params.backendEnabled,
      webhookUuid: params.webhookUuid,
      timeout: params.timeout,
      customHeaders: {
        'X-Client-Version': '1.0.0',
        'X-Widget-ID': params.widgetId
      }
    }
  };

  // Convert to JSON string and replace booleans with !0/!1, remove all whitespace
  let configJson = JSON.stringify(configObj)
    .replace(/":true/g, '":!0')      // Replace true with !0
    .replace(/":false/g, '":!1')     // Replace false with !1
    .replace(/\s+/g, '');            // Remove all whitespace
  
  // Build the complete JavaScript content matching the exact template format
  // Template format: window.ChatWidgetConfig={...},document.addEventListener(...)
  const configJs = 
    `window.ChatWidgetConfig=${configJson},` +
    `document.addEventListener("DOMContentLoaded",function(){setTimeout(function(){window.ChatWidget&&window.ChatWidget.setAPIHeaders({"X-Session-ID":"session-"+Date.now(),"X-User-Agent":navigator.userAgent})},200)});`;

  return configJs;
}

/**
 * Validate webhook UUID format
 */
export function validateWebhookUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Extract UUID from full webhook URL (for migration/backwards compatibility)
 */
export function extractUuidFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    
    if (lastPart && validateWebhookUuid(lastPart)) {
      return lastPart;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Default webchat config parameters
 */
export const defaultWebchatConfig: Partial<WebchatConfigParams> = {
  agentName: 'Support Bot',
  agentSubtitle: 'Always here to help',
  companyLogo: 'https://i.pinimg.com/736x/b1/13/0a/b1130aa0f3dfd15de57c93e38613dd84.jpg',
  companyInitials: 'SB',
  hideWatermark: false,
  greeting: 'Hello! How can I assist you today?',
  welcomeMessage: 'Welcome to our support chat!',
  placeholder: 'Type your message...',
  autoResponseMessage: 'Thanks for reaching out! I will get back to you shortly.',
  autoResponse: false,
  autoResponseDelay: 1500,
  persistMessages: false,
  waitForAgent: false,
  backendEnabled: true,
  webhookUuid: '',
  timeout: 30000
};

/**
 * Generate config from webhook data
 * Automatically extracts UUID if full URL is provided
 */
export function generateConfigFromWebhook(
  webhookData: {
    id: string;
    name?: string;
    url?: string;
  },
  customParams?: Partial<WebchatConfigParams>
): string {
  // Extract UUID from webhook ID or URL
  let webhookUuid = '';
  
  if (webhookData.url) {
    // Try to extract UUID from URL
    const extractedUuid = extractUuidFromUrl(webhookData.url);
    if (extractedUuid) {
      webhookUuid = extractedUuid;
    }
  }
  
  // Fallback to ID if it's a valid UUID
  if (!webhookUuid && validateWebhookUuid(webhookData.id)) {
    webhookUuid = webhookData.id;
  }

  if (!webhookUuid) {
    throw new Error('Invalid webhook UUID: Unable to extract valid UUID from webhook data');
  }

  const params: WebchatConfigParams = {
    ...defaultWebchatConfig,
    ...customParams,
    webhookUuid: webhookUuid,
    widgetId: customParams?.widgetId || webhookData.id,
    backendEnabled: true,
    // Ensure all required fields are present
    agentName: customParams?.agentName || defaultWebchatConfig.agentName || 'Support Bot',
    agentSubtitle: customParams?.agentSubtitle || defaultWebchatConfig.agentSubtitle || 'Always here to help',
    companyLogo: customParams?.companyLogo || defaultWebchatConfig.companyLogo || '',
    companyInitials: customParams?.companyInitials || defaultWebchatConfig.companyInitials || 'SB',
    hideWatermark: customParams?.hideWatermark ?? defaultWebchatConfig.hideWatermark ?? false,
    greeting: customParams?.greeting || defaultWebchatConfig.greeting || 'Hello! How can I assist you today?',
    welcomeMessage: customParams?.welcomeMessage || defaultWebchatConfig.welcomeMessage || 'Welcome to our support chat!',
    placeholder: customParams?.placeholder || defaultWebchatConfig.placeholder || 'Type your message...',
    autoResponseMessage: customParams?.autoResponseMessage || defaultWebchatConfig.autoResponseMessage || 'Thanks for reaching out!',
    autoResponse: customParams?.autoResponse ?? defaultWebchatConfig.autoResponse ?? false,
    autoResponseDelay: customParams?.autoResponseDelay || defaultWebchatConfig.autoResponseDelay || 1500,
    persistMessages: customParams?.persistMessages ?? defaultWebchatConfig.persistMessages ?? false,
    waitForAgent: customParams?.waitForAgent ?? defaultWebchatConfig.waitForAgent ?? false,
    timeout: customParams?.timeout || defaultWebchatConfig.timeout || 30000
  };

  return generateWebchatConfig(params);
}

/**
 * Example usage for integration with database
 */
export function generateConfigFromIntegration(
  integration: {
    id: string;
    channel: string;
    config: any;
    metadata?: any;
  },
  webhookUuid: string,
  widgetId: string
): string {
  const params: WebchatConfigParams = {
    agentName: integration.config?.name || 'Support Agent',
    agentSubtitle: 'Always here to help',
    companyLogo: integration.metadata?.icon || '',
    companyInitials: integration.config?.name?.substring(0, 2).toUpperCase() || 'SA',
    hideWatermark: false,
    greeting: 'Hello! How can I assist you today?',
    welcomeMessage: 'Welcome to our support chat!',
    placeholder: 'Type your message...',
    autoResponseMessage: 'Thanks for reaching out! I will get back to you shortly.',
    autoResponse: integration.metadata?.configuration_schema?.auto_respond || false,
    autoResponseDelay: 1500,
    persistMessages: false,
    waitForAgent: integration.metadata?.configuration_schema?.wait_for_agent || false,
    backendEnabled: true,
    webhookUuid: webhookUuid,
    timeout: 30000,
    widgetId: widgetId
  };

  return generateWebchatConfig(params);
}

/**
 * Example: Generate config for the provided integration
 */
export function generateConfigForWebchatIntegration(
  webhookUuid: string,
  widgetId: string
): string {
  const integration = {
    id: 'int_4943e14429694a3e9a286b75aaa47049',
    channel: 'webchat',
    config: {
      name: 'Webchat',
      author: 'System',
      version: '1.0.0',
      category: 'messaging'
    },
    metadata: {
      icon: '<svg viewBox="0 0 576 512" xmlns="http://www.w3.org/2000/svg"><path fill="#0088cc" d="M416 192c0-88.4-93.1-160-208-160S0 103.6 0 192c0 34.3 14.1 65.9 38 92-13.4 30.2-35.5 54.2-35.8 54.5-2.2 2.3-2.8 5.7-1.5 8.7S4.8 352 8 352c36.6 0 66.9-12.3 88.7-25 32.2 15.7 70.3 25 111.3 25 114.9 0 208-71.6 208-160zm122 220c23.9-26 38-57.7 38-92 0-66.9-53.5-124.2-129.3-148.1.9 6.6 1.3 13.3 1.3 20.1 0 105.9-107.7 192-240 192-10.8 0-21.3-.8-31.7-1.9C207.8 439.6 281.8 480 368 480c41 0 79.1-9.2 111.3-25 21.8 12.7 52.1 25 88.7 25 3.2 0 6.1-1.9 7.3-4.8 1.3-2.9.7-6.3-1.5-8.7-.3-.3-22.4-24.2-35.8-54.5z"/></svg>',
      description: 'Web chat integration',
      configuration_schema: {
        auto_respond: false,
        wait_for_agent: false
      }
    }
  };

  return generateConfigFromIntegration(integration, webhookUuid, widgetId);
}