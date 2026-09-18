"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shield } from "lucide-react";
import { authApi, tokenStore, type TokenPair } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export default function AuthCallbackPage() {
  const router = useRouter();
  const setUser = useAppStore(s => s.setUser);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const access = params.get("access_token");
    const refresh = params.get("refresh_token");

    if (!access || !refresh) {
      router.push("/?error=oauth_failed");
      return;
    }

    tokenStore.setTokenPair({ access_token: access, refresh_token: refresh, token_type: "bearer" } as TokenPair);

    authApi.me()
      .then(user => {
        setUser(user);
        router.push("/dashboard");
      })
      .catch(() => {
        tokenStore.clear();
        router.push("/?error=auth_failed");
      });
  }, [router, setUser]);

  return (
    <div className="min-h-screen bg-sn-bg flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-900 flex items-center justify-center">
        <Shield size={24} className="text-white" />
      </div>
      <div className="flex items-center gap-2 text-sn-dim text-[13px]">
        <Loader2 size={16} className="animate-spin text-violet-400" />
        Completing sign-in…
      </div>
    </div>
  );
}
