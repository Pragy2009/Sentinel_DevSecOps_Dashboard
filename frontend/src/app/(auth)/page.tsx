"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Shield, Github, Eye, EyeOff, Loader2 } from "lucide-react";
import { authApi, githubApi, tokenStore } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAppStore(s => s.setUser);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ghLoading, setGhLoading] = useState(false);
  const [error, setError] = useState("");

  // Already signed in? Skip login and go straight to the app.
  useEffect(() => {
    if (!tokenStore.get()) return;
    authApi.me()
      .then((u) => {
        setUser(u);
        router.replace("/dashboard");
      })
      .catch(() => tokenStore.clear());
  }, [router, setUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "register") {
        await authApi.register(email, password, name || undefined);
      } else {
        await authApi.login(email, password);
      }
      const user = await authApi.me();
      setUser(user);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGitHub = async () => {
    setGhLoading(true);
    setError("");
    try {
      await githubApi.triggerLogin();
    } catch {
      setError("Failed to initiate GitHub login. Is the backend running?");
      setGhLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-sn-surface border border-sn-border rounded-2xl p-8 shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-purple-900 flex items-center justify-center glow-purple">
          <Shield size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-sn-text">Sentinel</h1>
          <p className="text-[11px] text-sn-dim tracking-wider uppercase">DevSecOps Platform</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg border border-sn-border overflow-hidden mb-6">
        {(["login", "register"] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setError(""); }}
            className={cn("flex-1 py-2 text-[12px] font-medium transition-colors capitalize",
              mode === m ? "bg-violet-900/60 text-violet-300" : "text-sn-dim hover:text-sn-text")}>
            {m === "login" ? "Sign In" : "Create Account"}
          </button>
        ))}
      </div>

      {/* GitHub OAuth */}
      <button onClick={handleGitHub} disabled={ghLoading}
        className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg border border-sn-border bg-sn-muted/20 text-sn-text text-[13px] font-medium hover:bg-sn-muted/40 hover:border-sn-muted transition-all disabled:opacity-50 mb-5">
        {ghLoading ? <Loader2 size={16} className="animate-spin" /> : <Github size={16} />}
        Continue with GitHub
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-px bg-sn-border" />
        <span className="text-[10px] text-sn-dim uppercase tracking-widest">or</span>
        <div className="flex-1 h-px bg-sn-border" />
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "register" && (
          <div>
            <label className="block text-[11px] text-sn-dim mb-1.5 uppercase tracking-wider">Full Name</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Pragy Jha"
              className="w-full bg-sn-bg border border-sn-border rounded-lg px-3 py-2.5 text-[13px] text-sn-text placeholder:text-sn-muted focus:outline-none focus:border-violet-600 transition-colors"
            />
          </div>
        )}
        <div>
          <label className="block text-[11px] text-sn-dim mb-1.5 uppercase tracking-wider">Email</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            required placeholder="you@example.com"
            className="w-full bg-sn-bg border border-sn-border rounded-lg px-3 py-2.5 text-[13px] text-sn-text placeholder:text-sn-muted focus:outline-none focus:border-violet-600 transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] text-sn-dim mb-1.5 uppercase tracking-wider">Password</label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
              required placeholder="••••••••" minLength={8}
              className="w-full bg-sn-bg border border-sn-border rounded-lg px-3 py-2.5 pr-10 text-[13px] text-sn-text placeholder:text-sn-muted focus:outline-none focus:border-violet-600 transition-colors"
            />
            <button type="button" onClick={() => setShowPass(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sn-dim hover:text-sn-text transition-colors">
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="text-[11px] text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
            {error}
          </motion.div>
        )}

        <button type="submit" disabled={loading}
          className="w-full py-2.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-[13px] font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {loading && <Loader2 size={14} className="animate-spin" />}
          {mode === "login" ? "Sign In" : "Create Account"}
        </button>
      </form>
    </motion.div>
  );
}
