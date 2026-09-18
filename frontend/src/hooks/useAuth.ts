"use client";
import { useEffect, useState } from "react";
import { authApi, tokenStore } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export function useAuth() {
  const { user, setUser } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) { setLoading(false); return; }
    authApi.me().then(setUser).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, [setUser]);

  const logout = () => { authApi.logout(); setUser(null); window.location.href = "/"; };
  return { user, loading, logout, isAuthenticated: !!user };
}
