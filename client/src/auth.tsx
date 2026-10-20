import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, tokenStore, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (path: 'login' | 'register', body: Record<string, string>) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }
    api<{ user: User }>('/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const navigate = useNavigate();

  // Always land on the role's home page: a stale URL from a previous session (e.g. /report) can be forbidden for the new role.
  const signIn = useCallback<AuthState['signIn']>(
    async (path, body) => {
      const r = await api<{ token: string; user: User }>(`/auth/${path}`, { method: 'POST', body });
      tokenStore.set(r.token);
      setUser(r.user);
      navigate('/', { replace: true });
    },
    [navigate],
  );

  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    navigate('/', { replace: true });
  }, [navigate]);

  return <Ctx.Provider value={{ user, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
