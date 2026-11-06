'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import type { LoginPayload, RegisterPayload, User } from '@/lib/types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (payload: LoginPayload) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await authApi.getMe();
      setUser(me);
    } catch (error) {
      // 401 simply means "not logged in" — never surface it as an error.
      if (!(error instanceof ApiError && error.status === 401)) {
        // Any other failure also degrades to logged-out state, silently.
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
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
    return loggedIn;
  }, []);

  const register = useCallback(async (payload: RegisterPayload): Promise<User> => {
    const { user: created } = await authApi.register(payload);
    setUser(created);
    return created;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
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
