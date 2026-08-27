'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, login as authLogin, logout as authLogout, updateSelfAccount } from './auth-client';
import type { AuthError, AuthUser, LoginCredentials, SelfAccountInput } from './auth-types';

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  error: AuthError | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<AuthError | null>(null);

  const init = useCallback(async () => {
    try {
      const current = await getCurrentUser();
      setUser(current);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const authenticated = await authLogin(credentials);
      setUser(authenticated);
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
      setUser(null);
      setIsLoading(false);
    }
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
    () => ({ user, isLoading, error, login, logout, updateAccount, clearError }),
    [user, isLoading, error, login, logout, updateAccount, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
