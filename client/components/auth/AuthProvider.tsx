'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { authApi } from '@/lib/api/auth';
import { refreshSession, type RefreshResult } from '@/lib/auth/refresh-session';
import type { LoginPayload, RegisterPayload, User } from '@/lib/types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (payload: LoginPayload) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  /** Google sign-in/sign-up with a Google Identity Services credential. */
  loginWithGoogle: (credential: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<RefreshResult<User>>;
  refreshError: string | null;
  updateUser: (update: (current: User) => User) => void;
  invalidateSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshRequest = useRef<Promise<RefreshResult<User>> | null>(null);

  const refresh = useCallback((): Promise<RefreshResult<User>> => {
    if (refreshRequest.current) return refreshRequest.current;
    const request = refreshSession(authApi.getMe, setUser).then((result) => {
      setRefreshError(result.status === 'error' ? 'Could not refresh your account. Please retry.' : null);
      return result;
    }).finally(() => {
      setLoading(false);
      refreshRequest.current = null;
    });
    refreshRequest.current = request;
    return request;
  }, []);

  const updateUser = useCallback((update: (current: User) => User) => {
    setUser((current) => current ? update(current) : current);
  }, []);
  const invalidateSession = useCallback(() => {
    setUser(null);
    setRefreshError(null);
  }, []);

  useEffect(() => {
    // Deferred into an async task (react-hooks/set-state-in-effect).
    void (async () => {
      await Promise.resolve();
      await refresh();
    })();
  }, [refresh]);

  const login = useCallback(async (payload: LoginPayload): Promise<User> => {
    const { user: loggedIn } = await authApi.login(payload);
    setUser(loggedIn);
    setRefreshError(null);
    return loggedIn;
  }, []);

  const register = useCallback(async (payload: RegisterPayload): Promise<User> => {
    const { user: created } = await authApi.register(payload);
    setUser(created);
    setRefreshError(null);
    return created;
  }, []);

  const loginWithGoogle = useCallback(async (credential: string): Promise<User> => {
    const { user: loggedIn } = await authApi.loginWithGoogle({ credential });
    setUser(loggedIn);
    setRefreshError(null);
    return loggedIn;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setRefreshError(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, loginWithGoogle, logout, refresh, refreshError, updateUser, invalidateSession }),
    [user, loading, login, register, loginWithGoogle, logout, refresh, refreshError, updateUser, invalidateSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
