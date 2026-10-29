import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  fullName: string;
  roleId?: number;
  role: string;
  roleName: string;
  mustChangePassword: boolean;
  departmentId?: number | null;
  departmentName?: string | null;
  teacherId?: number | null;
  teacherEmployeeCode?: string | null;
  teacherCode?: string | null;
  teacherDesignation?: string | null;
}

export interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  csrfToken: string | null;
  isLoginModalOpen: boolean;
  isPasswordModalOpen: boolean;
  sessionNotice: string | null;
  clearSessionNotice: () => void;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  openPasswordModal: () => void;
  closePasswordModal: () => void;
  login: (usernameOrEmail: string, password: string) => Promise<{ success: boolean; error?: string; code?: string }>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string; code?: string }>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(user);
  userRef.current = user;

  const fetchCsrfToken = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/csrf');
      if (res.ok) {
        const data = await res.json();
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
      }
    } catch {
      // Ignore background CSRF fetch failures
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setUser(null);
        if (data?.code === 'SESSION_SUPERSEDED') {
          setSessionNotice('Your session has ended because this account signed in from another device.');
        }
        await fetchCsrfToken();
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [fetchCsrfToken]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Periodic and focus-driven active session verification (detects remote logins, suspension, deactivation, or password reset)
  useEffect(() => {
    if (!user) return;

    let isChecking = false;

    const verifySessionActive = async () => {
      if (isChecking || !userRef.current) return;
      isChecking = true;
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setUser(null);
          setIsPasswordModalOpen(false);
          if (data?.code === 'SESSION_SUPERSEDED') {
            setSessionNotice('Your session has ended because this account signed in on another device or was reset.');
            setIsLoginModalOpen(true);
          } else if (data?.code === 'SESSION_EXPIRED') {
            setSessionNotice('Your session has expired due to 1 hour of inactivity. Please sign in again.');
            setIsLoginModalOpen(true);
          } else if (data?.code === 'ACCOUNT_SUSPENDED' || data?.code === 'ACCOUNT_DEACTIVATED') {
            setSessionNotice(data.error || 'Your session is no longer active.');
            setIsLoginModalOpen(true);
          }
        } else {
          const data = await res.json().catch(() => null);
          if (data?.user) {
            setUser(data.user);
          }
        }
      } catch {
        // Network fluctuation; do not drop session immediately
      } finally {
        isChecking = false;
      }
    };

    const intervalId = setInterval(verifySessionActive, 15000);
    const handleFocus = () => {
      verifySessionActive();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [user]);

  const login = async (usernameOrEmail: string, password: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({ usernameOrEmail, password }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let data: any;
      try {
        data = await res.json();
      } catch {
        return {
          success: false,
          error: 'The server returned an unrecognized response format. Please verify connection.',
          code: 'INVALID_RESPONSE',
        };
      }

      if (res.ok && data.user) {
        setUser(data.user);
        setSessionNotice(null);
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
        setIsLoginModalOpen(false);
        return { success: true };
      } else {
        return {
          success: false,
          error: data.error || 'Authentication failed',
          code: data.code || 'LOGIN_FAILED',
        };
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        return {
          success: false,
          error: 'Sign in request timed out after 15 seconds. Please check your network connection.',
          code: 'REQUEST_TIMEOUT',
        };
      }
      return {
        success: false,
        error: 'Unable to connect to KAMCH ERP server. Please verify Wi-Fi and server status.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (res.ok) {
        if (user) {
          setUser({ ...user, mustChangePassword: false });
        }
        setIsPasswordModalOpen(false);
        return { success: true };
      } else {
        return {
          success: false,
          error: data.error || 'Failed to update password',
          code: data.code,
        };
      }
    } catch {
      return {
        success: false,
        error: 'Network error while updating password.',
        code: 'NETWORK_ERROR',
      };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
      });
    } finally {
      setUser(null);
      setIsPasswordModalOpen(false);
      setSessionNotice(null);
      await fetchCsrfToken();
    }
  };

  const clearSessionNotice = useCallback(() => {
    setSessionNotice(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        csrfToken,
        isLoginModalOpen,
        isPasswordModalOpen,
        sessionNotice,
        clearSessionNotice,
        openLoginModal: () => {
          setSessionNotice(null);
          setIsLoginModalOpen(true);
        },
        closeLoginModal: () => {
          setSessionNotice(null);
          setIsLoginModalOpen(false);
        },
        openPasswordModal: () => {
          setIsPasswordModalOpen(true);
        },
        closePasswordModal: () => {
          setIsPasswordModalOpen(false);
        },
        login,
        logout,
        changePassword,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
