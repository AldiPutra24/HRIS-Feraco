export type AuthRole = 'admin' | 'hr_staff' | 'hr_lead' | 'employee' | 'management';

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: AuthRole | null;
};

export type LoginCredentials = {
  email: string;
  password: string;
  rememberMe?: boolean;
};

export type AuthError = {
  message: string;
  code?: string;
};

export type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
  error: AuthError | null;
};
