import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { api, AuthResponse, UserPublic, setToken, getToken } from "./api";

type AuthCtx = {
  user: UserPublic | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { email: string; password: string; username: string; display_name: string; bike_model?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) { setUser(null); setLoading(false); return; }
    try {
      const me = await api.get<UserPublic>("/auth/me");
      setUser(me);
    } catch {
      await setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const value = useMemo<AuthCtx>(() => ({
    user, loading,
    signIn: async (email, password) => {
      const res = await api.post<AuthResponse>("/auth/login", { email, password });
      await setToken(res.access_token);
      setUser(res.user);
    },
    signUp: async (input) => {
      const res = await api.post<AuthResponse>("/auth/signup", input);
      await setToken(res.access_token);
      setUser(res.user);
    },
    signOut: async () => {
      await setToken(null);
      setUser(null);
    },
    refresh: load,
  }), [user, loading, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
