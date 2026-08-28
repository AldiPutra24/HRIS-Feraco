'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onSessionExpired } from '@/lib/session-events';
import { getCurrentUser, login as authLogin, logout as authLogout, updateSelfAccount } from './auth-client';
import type { AuthError, AuthUser, LoginCredentials, SelfAccountInput } from './auth-types';

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: AuthError | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateAccount: (data: SelfAccountInput) => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<AuthError | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const init = useCallback(async () => {
    try {
      const current = await getCurrentUser();
      setUser(current);
      setIsAuthenticated(current !== null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void init();
    onSessionExpired(clearSession);
    return () => onSessionExpired(null);
  }, [init, clearSession]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const authenticated = await authLogin(credentials);
      setUser(authenticated);
      setIsAuthenticated(true);
    } catch (err) {
      const authError = err instanceof Error ? { message: err.message } : { message: 'Unknown error' };
      setError(authError);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authLogout();
    } finally {
      clearSession();
      setIsLoading(false);
    }
  }, [clearSession]);

  const refresh = useCallback(async () => {
    const current = await getCurrentUser();
    setUser(current);
    setIsAuthenticated(current !== null);
  }, []);

  const updateAccount = useCallback(async (data: SelfAccountInput) => {
    setError(null);
    try {
      const updated = await updateSelfAccount(data);
      setUser(updated);
    } catch (err) {
      const authError = err instanceof Error ? { message: err.message } : { message: 'Unknown error' };
      setError(authError);
      throw err;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({ user, isAuthenticated, isLoading, error, login, logout, refresh, updateAccount, clearError }),
    [user, isAuthenticated, isLoading, error, login, logout, refresh, updateAccount, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
