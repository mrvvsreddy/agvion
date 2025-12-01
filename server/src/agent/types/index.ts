
// agent/types/index.ts
export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  brain: any;
  goals: any;
  autonomy_mode: string;
  approval_required: boolean;
  tool_permissions: any;
  llm_provider: string | null;
  llm_secret_ref: string | null;
  created_by: string | null;
  updated_by: string | null;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
  system_prompt: string | null;
  llm_model: string | null;
  secret_id: string | null;
  temperature: number | null;
  max_tokens: number | null;
  response_timeout_ms: number | null;
  is_public: boolean | null;
  widget_enabled: boolean | null;
  api_enabled: boolean | null;
  total_messages: number | null;
  total_tokens: number | null;
  tools: any | null;
  memory_config: any | null;
  prompt?: string | null; // Extracted from main workflow system prompt
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
}

export interface CreateAgentResponse {
  success: boolean;
  agent?: Agent;
  message?: string;
}

export interface GetAgentsResponse {
  success: boolean;
  agents?: Agent[];
  message?: string;
}

export interface DeleteAgentResponse {
  success: boolean;
  message?: string;
}

export interface AgentStudioData {
  agent: Agent;
  workflows: any[];
  tables: any[];
  databaseConnections: any[];
  integrations: any[];
  conversations?: {
    totalConversations: number;
    activeConversations: number;
    totalMessages: number;
    recentActivity: {
      conversationsCreated: number;
      messagesSent: number;
      lastActivity: string;
    };
  } | undefined;
}

export interface GetAgentStudioDataResponse {
  success: boolean;
  data?: AgentStudioData;
  message?: string;
}

// Conversation-related types removed
/*export interface AgentConversationRequest {
  userId: string;
  channel: string;
  initialMessage?: {
    direction: string;
    type: string;
    payload: Record<string, any>;
    senderId: string;
  };
}

export interface AgentConversationResponse {
  success: boolean;
  conversation?: any;
  message?: string;
}

export interface AgentConversationsResponse {
  success: boolean;
  conversations?: any;
  message?: string;
}

export interface AgentConversationStatsResponse {
  success: boolean;
  stats?: {
    totalConversations: number;
    activeConversations: number;
    completedConversations: number;
    totalMessages: number;
    averageMessagesPerConversation: number;
    conversationsByChannel: Record<string, number>;
    conversationsByStatus: Record<string, number>;
    messagesByDirection: Record<string, number>;
    messagesByType: Record<string, number>;
    recentActivity: {
      conversationsCreated: number;
      messagesSent: number;
      lastActivity: string;
    };
  };
  message?: string;
}*/

export interface AgentMessageRequest {
  direction: string;
  type: string;
  payload: Record<string, any>;
  senderId: string;
  nodeId?: string;
  metadata?: Record<string, any>;
}

export interface AgentMessageResponse {
  success: boolean;
  message?: any;
  error?: string;
}