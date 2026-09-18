"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Github, Shield, Key, Bell, Loader2, CheckCircle } from "lucide-react";
import { githubApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Topbar } from "@/components/shared/Topbar";
import { cn } from "@/lib/utils";

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-sn-surface border border-sn-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-sn-border">
        <div className="text-violet-400">{icon}</div>
        <span className="text-[13px] font-semibold text-sn-text">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAppStore();
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const { setRepos } = useAppStore();

  const handleSync = async () => {
    setSyncing(true);
    try {
      const repos = await githubApi.syncRepos();
      setRepos(repos);
      setSynced(true);
      setTimeout(() => setSynced(false), 3000);
    } finally { setSyncing(false); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Settings" />
      <div className="flex-1 overflow-y-auto p-5 max-w-2xl mx-auto w-full space-y-4">

        {/* Account */}
        <Section title="Account" icon={<Shield size={15} />}>
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-sn-dim uppercase tracking-wider mb-1.5">Email</label>
              <div className="bg-sn-bg border border-sn-border rounded-lg px-3 py-2.5 text-[13px] text-sn-dim font-mono">
                {user?.email ?? "—"}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-sn-dim uppercase tracking-wider mb-1.5">Full Name</label>
              <div className="bg-sn-bg border border-sn-border rounded-lg px-3 py-2.5 text-[13px] text-sn-text">
                {user?.full_name ?? "—"}
              </div>
            </div>
          </div>
        </Section>

        {/* GitHub */}
        <Section title="GitHub Integration" icon={<Github size={15} />}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] text-sn-text font-medium">GitHub Account</div>
                <div className="text-[11px] text-sn-dim mt-0.5">
                  {user?.github_linked
                    ? `Connected as @${user.github_username}`
                    : "Not connected"}
                </div>
              </div>
              <div className={cn("flex items-center gap-1.5 text-[11px] font-medium",
                user?.github_linked ? "text-emerald-400" : "text-sn-dim")}>
                <div className={cn("w-2 h-2 rounded-full", user?.github_linked ? "bg-emerald-400 animate-pulse" : "bg-sn-muted")} />
                {user?.github_linked ? "Connected" : "Disconnected"}
              </div>
            </div>
            {user?.github_linked ? (
              <button onClick={handleSync} disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-sn-muted/20 border border-sn-border rounded-lg text-[12px] text-sn-text hover:border-violet-600 transition-colors disabled:opacity-50">
                {syncing ? <Loader2 size={13} className="animate-spin" /> : synced ? <CheckCircle size={13} className="text-emerald-400" /> : <Github size={13} />}
                {synced ? "Synced!" : "Sync Repositories"}
              </button>
            ) : (
              <button onClick={() => githubApi.triggerLogin()}
                className="flex items-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 rounded-lg text-white text-[12px] font-medium transition-colors">
                <Github size={13} /> Connect GitHub
              </button>
            )}
          </div>
        </Section>

        {/* Scanner config info */}
        <Section title="Scanner Configuration" icon={<Key size={15} />}>
          <div className="space-y-2 text-[12px]">
            <p className="text-sn-dim">Scanners are configured server-side via environment variables. The backend currently runs:</p>
            <div className="flex gap-2 flex-wrap mt-3">
              {["Semgrep", "Bandit", "Trivy", "Gitleaks"].map(s => (
                <span key={s} className="px-2.5 py-1 bg-violet-950/40 border border-violet-800/40 rounded text-[11px] text-violet-300 font-mono">
                  {s}
                </span>
              ))}
            </div>
            <div className="mt-3 p-3 bg-sn-bg border border-sn-border rounded-lg">
              <div className="text-[10px] text-sn-dim uppercase tracking-wider mb-2">AI Remediation</div>
              <p className="text-sn-dim">
                Set <code className="text-cyan-400">AI_PROVIDER=openrouter</code> and <code className="text-cyan-400">OPENROUTER_API_KEY</code> in <code className="text-cyan-400">backend/.env</code> to enable real AI remediation. Defaults to mock mode.
              </p>
            </div>
          </div>
        </Section>

      </div>
    </div>
  );
}
