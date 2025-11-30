// agent/types/index.ts
export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  workspace_id: string | null;
  status: string;
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