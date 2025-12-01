import { authService } from './authService';

// Get API base URL based on environment
const getApiBaseUrl = (): string => {
    const env = import.meta.env.VITE_ENV || 'development';
    if (env === 'production') {
        return import.meta.env.VITE_API_URL_PROD || 'https://api.agvion.com';
    }
    return import.meta.env.VITE_API_URL_DEV || 'http://localhost:3000';
};

const API_BASE_URL = getApiBaseUrl();

// Helper function to make API requests (similar to authService but reuses logic if possible)
// For now, duplicating simple fetch logic to avoid circular dependencies or complex refactors
async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    // Add session token if available
    const token = localStorage.getItem('sessionToken');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
        ...options,
        headers,
        credentials: 'include',
    };

    try {
        const response = await fetch(url, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || data.error || `HTTP error! status: ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

export interface WorkspaceMetadata {
    agentIds?: string[];
    settingsTableId?: string | null;
    usageTableId?: string | null;
    tenantId?: string;
    lastAgentUpdate?: string;
    version?: number;
    customSettings?: Record<string, unknown>;
}

export const workspaceService = {
    /**
     * Update workspace metadata
     */
    async updateMetadata(metadata: WorkspaceMetadata): Promise<any> {
        return apiRequest('/api/workspace/metadata', {
            method: 'PUT',
            body: JSON.stringify({ metadata }),
        });
    },

    /**
     * Get workspace data
     */
    async getWorkspaceData(): Promise<any> {
        return apiRequest('/api/workspace/data', {
            method: 'GET',
        });
    }
};

export default workspaceService;
