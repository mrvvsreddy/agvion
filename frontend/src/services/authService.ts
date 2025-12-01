// Authentication API Service
// Handles all authentication-related API calls to the backend
import Cookies from 'js-cookie';

// Get API base URL based on environment
const getApiBaseUrl = (): string => {
    const env = import.meta.env.VITE_ENV || 'development';
    if (env === 'production') {
        return import.meta.env.VITE_API_URL_PROD || 'https://api.agvion.com';
    }
    return import.meta.env.VITE_API_URL_DEV || 'http://localhost:3000';
};

const API_BASE_URL = getApiBaseUrl();

// Helper function to get session token from cookies
const getSessionToken = (): string | null => {
    return Cookies.get('sessionToken') || null;
};

// Helper function to make API requests
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
    const token = getSessionToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
        ...options,
        headers,
        credentials: 'include', // Ensure cookies are sent/received
    };

    try {
        const response = await fetch(url, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP error! status: ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// Types matching backend responses
export interface LoginResponse {
    success: boolean;
    user?: {
        id: string;
        email: string;
        firstName: string;
        lastName?: string;
        role: string;
        tenantId: string;
        emailVerified: boolean;
    };
    sessionToken?: string;
    message?: string;
    requiresEmailVerification?: boolean;
    workspaceId?: string;
}

export interface SignupResponse {
    success: boolean;
    message: string;
    requiresEmailVerification?: boolean;
    verificationCodeSent?: boolean;
    user?: {
        id: string;
        email: string;
        tenantId: string;
    };
    sessionToken?: string;
}

export interface VerificationResponse {
    success: boolean;
    message: string;
    name?: string;
    userId?: string;
}

export interface PasswordResetResponse {
    success: boolean;
    message: string;
    emailSent?: boolean;
}

export interface SessionValidationResponse {
    success: boolean;
    user?: {
        id: string;
        email: string;
        firstName: string;
        lastName?: string;
        tenantId: string;
        emailVerified: boolean;
    };
    message?: string;
}

// Authentication Service
export const authService = {
    /**
     * Step 1: Pre-signup - Send verification code to email
     */
    async preSignup(email: string, name: string): Promise<SignupResponse> {
        return apiRequest<SignupResponse>('/api/auth/pre-signup', {
            method: 'POST',
            body: JSON.stringify({ email, name }),
        });
    },

    /**
     * Step 2: Verify email code
     */
    async verifySignup(email: string, code: string): Promise<VerificationResponse> {
        return apiRequest<VerificationResponse>('/api/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ email, code }),
        });
    },

    /**
     * Step 3: Complete signup with password
     */
    async completeSignup(email: string, password: string): Promise<SignupResponse> {
        return apiRequest<SignupResponse>('/api/auth/complete-signup', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
    },

    /**
     * Login user
     */
    async login(email: string, password: string, rememberMe: boolean = false): Promise<LoginResponse> {
        return apiRequest<LoginResponse>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password, rememberMe }),
        });
    },

    /**
     * Logout user
     */
    async logout(): Promise<{ success: boolean; message: string }> {
        const token = getSessionToken();
        if (!token) {
            return { success: false, message: 'No session token found' };
        }

        const response = await apiRequest<{ success: boolean; message: string }>('/api/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ sessionToken: token }),
        });

        // Clear cookies and local storage
        Cookies.remove('sessionToken');
        localStorage.removeItem('user');

        return response;
    },

    /**
     * Request password reset
     */
    async requestPasswordReset(email: string): Promise<PasswordResetResponse> {
        return apiRequest<PasswordResetResponse>('/api/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
    },

    /**
     * Validate current session
     */
    async validateSession(): Promise<SessionValidationResponse> {
        const token = getSessionToken();
        if (!token) {
            return { success: false, message: 'No session token found' };
        }

        return apiRequest<SessionValidationResponse>('/api/auth/validate-session', {
            method: 'POST',
            body: JSON.stringify({ sessionToken: token }),
        });
    },

    /**
     * Store session token and user data
     */
    storeSession(sessionToken: string, user: any, workspaceId?: string): void {
        // Store token in cookie (expires in 7 days)
        Cookies.set('sessionToken', sessionToken, { expires: 7, secure: true, sameSite: 'strict', path: '/' });

        if (workspaceId) {
            Cookies.set('workspaceId', workspaceId, { expires: 7, secure: true, sameSite: 'strict', path: '/' });
        }

        // Keep user data in localStorage for easy access
        localStorage.setItem('user', JSON.stringify(user));
    },

    /**
     * Clear session
     */
    clearSession(): void {
        Cookies.remove('sessionToken', { path: '/' });
        Cookies.remove('workspaceId', { path: '/' });
        localStorage.removeItem('user');
    },

    /**
     * Save onboarding data
     */
    async saveOnboardingData(data: {
        workspace_name: string;
        workflow_type?: string;
        team_size?: string;
        experience_level?: string;
        referral_source?: string;
    }): Promise<{ success: boolean; message: string; workspaceId?: string }> {
        return apiRequest<{ success: boolean; message: string; workspaceId?: string }>('/api/auth/onboarding', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    /**
     * Get current user from localStorage
     */
    getCurrentUser(): any | null {
        const userStr = localStorage.getItem('user');
        if (!userStr) return null;
        try {
            return JSON.parse(userStr);
        } catch {
            return null;
        }
    },

    /**
     * Get current session token
     */
    getSessionToken(): string | null {
        return getSessionToken();
    }
};

export default authService;
