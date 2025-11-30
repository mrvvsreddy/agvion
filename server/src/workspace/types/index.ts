// workspace/types
export interface Agent {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMetadata {
  agentIds?: string[];
  settingsTableId?: string | null;
  usageTableId?: string | null;
  tenantId?: string;
  lastAgentUpdate?: string;
  version?: number;
  agentFetchError?: string; // For tracking agent fetch failures
  // Add other known properties here instead of using [key: string]: any
  customSettings?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  metadata?: WorkspaceMetadata;
  agents?: Agent[];
  agentCount?: number;
}

export interface CreateWorkspaceRequest {
  id: string; // uuid
  tenantId: string;
  email: string;
  name: string;
  slug: string;
  description?: string | null;
  status?: string;
  metadata?: WorkspaceMetadata;
}

export interface WorkspaceStats {
  totalAgents: number;
  activeAgents: number;
  totalConversations: number;
  totalErrors: number;
}

export interface WorkspaceData {
  workspace: Workspace | null;
  agents: Agent[];
  stats: WorkspaceStats;
}

export interface WorkspaceCacheKey {
  workspaceId: string;
  version?: number;
}

export interface UserWorkspaceAccess {
  userId: string;
  workspaceId: string;
  tenantId: string;
  hasAccess: boolean;
  accessLevel: 'owner' | 'admin' | 'member' | 'viewer';
}


