"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GitBranch, Lock, Unlock, RefreshCw, Play, Loader2, Github, Plus } from "lucide-react";
import { repoApi, githubApi, scanApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Topbar } from "@/components/shared/Topbar";
import { healthColor, cn } from "@/lib/utils";
import type { Repository } from "@/lib/api";

function RepoBadge({ repo, onScan }: { repo: Repository; onScan: (r: Repository) => void }) {
  const [scanning, setScanning] = useState(false);
  const [branch, setBranch] = useState(repo.default_branch);
  const [branches, setBranches] = useState<string[]>([repo.default_branch]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const loadBranches = async () => {
    setLoadingBranches(true);
    try {
      const [owner, name] = repo.full_name.split("/");
      const b = await githubApi.getBranches(owner, name);
      setBranches(b.length ? b : [repo.default_branch]);
    } catch { /* keep default */ }
    finally { setLoadingBranches(false); }
  };

  const handleScan = async () => {
    setScanning(true);
    try { await onScan({ ...repo, default_branch: branch }); }
    finally { setScanning(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-sn-surface border border-sn-border rounded-xl p-4 hover:border-sn-muted transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          {repo.is_private
            ? <Lock size={13} className="text-amber-400 shrink-0" />
            : <Unlock size={13} className="text-sn-dim shrink-0" />}
          <div>
            <div className="text-[13px] font-semibold text-sn-text">{repo.name}</div>
            <div className="text-[10px] text-sn-dim font-mono">{repo.full_name}</div>
          </div>
        </div>
        <div className={cn("text-[12px] font-bold font-mono", healthColor(repo.health_score))}>
          {repo.health_score.toFixed(0)}
        </div>
      </div>

      {repo.description && (
        <p className="text-[11px] text-sn-dim mb-3 line-clamp-2">{repo.description}</p>
      )}

      <div className="flex items-center gap-2 text-[10px] text-sn-dim mb-4">
        {repo.language && (
          <span className="px-2 py-0.5 bg-sn-muted/20 rounded border border-sn-border/50">{repo.language}</span>
        )}
        <span className="flex items-center gap-1">
          <GitBranch size={10} />{repo.default_branch}
        </span>
      </div>

      {/* Branch selector + scan */}
      <div className="flex items-center gap-2">
        <select
          value={branch}
          onChange={e => setBranch(e.target.value)}
          onFocus={loadBranches}
          className="flex-1 bg-sn-bg border border-sn-border rounded-lg px-2.5 py-1.5 text-[11px] text-sn-text focus:outline-none focus:border-violet-600 font-mono"
        >
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        {loadingBranches && <Loader2 size={12} className="animate-spin text-sn-dim" />}
        <button onClick={handleScan} disabled={scanning}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 hover:bg-violet-600 rounded-lg text-white text-[11px] font-medium transition-colors disabled:opacity-50">
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Scan
        </button>
      </div>
    </motion.div>
  );
}

export default function RepositoriesPage() {
  const { repos, setRepos, setScans, scans } = useAppStore();
  const [syncing, setSyncing] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlBranch, setUrlBranch] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => { repoApi.list().then(setRepos).catch(() => {}); }, [setRepos]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const synced = await githubApi.syncRepos();
      setRepos(synced);
      setSuccessMsg(`Synced ${synced.length} repositories from GitHub`);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch { /* not linked */ }
    finally { setSyncing(false); }
  };

  const handleScan = async (repo: Repository) => {
    const res = await scanApi.create(repo.id, repo.default_branch);
    const updated = await scanApi.list();
    setScans(updated);
    setSuccessMsg(`Scan queued: ${res.scan_id}`);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const handleUrlScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim()) return;
    setAddingUrl(true);
    try {
      const branchToSend = urlBranch.trim() || "main";
      const res = await scanApi.createByUrl(cloneUrl, branchToSend);
      const updated = await scanApi.list();
      setScans(updated);
      setCloneUrl(""); setUrlBranch("");
      setSuccessMsg(`Scan queued: ${res.scan_id}`);
      setTimeout(() => setSuccessMsg(""), 4000);
    } finally { setAddingUrl(false); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Repositories" />
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Success toast */}
        {successMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-emerald-950/60 border border-emerald-800/50 rounded-lg px-4 py-2.5 text-[12px] text-emerald-400">
            {successMsg}
          </motion.div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-sn-surface border border-sn-border rounded-lg text-[12px] text-sn-text hover:border-violet-600 transition-colors disabled:opacity-50">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <Github size={14} />}
            Sync from GitHub
          </button>
          <span className="text-[10px] text-sn-dim">{repos.length} repositories</span>
        </div>

        {/* Ad-hoc URL scan */}
        <div className="bg-sn-surface border border-sn-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Plus size={14} className="text-violet-400" />
            <span className="text-[12px] font-semibold text-sn-text">Scan by URL</span>
          </div>
          <form onSubmit={handleUrlScan} className="flex gap-2">
            <input type="url" value={cloneUrl} onChange={e => setCloneUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="flex-1 bg-sn-bg border border-sn-border rounded-lg px-3 py-2 text-[12px] text-sn-text placeholder:text-sn-muted focus:outline-none focus:border-violet-600 font-mono" />
            <input type="text" value={urlBranch} onChange={e => setUrlBranch(e.target.value)}
              placeholder="default branch (auto)"
              title="Leave blank to auto-detect the repo default branch (master/main/develop...). Only fill if you need a specific branch."
              className="w-40 bg-sn-bg border border-sn-border rounded-lg px-3 py-2 text-[12px] text-sn-text placeholder:text-sn-muted focus:outline-none focus:border-violet-600 font-mono" />
            <button type="submit" disabled={addingUrl || !cloneUrl.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-700 hover:bg-violet-600 rounded-lg text-white text-[12px] font-medium transition-colors disabled:opacity-50">
              {addingUrl ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Scan
            </button>
          </form>
        </div>

        {/* Repo grid */}
        {repos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-sn-dim">
            <Github size={40} className="opacity-20" />
            <div className="text-[13px] italic">No repositories yet. Sync from GitHub or scan by URL.</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            {repos.map(r => <RepoBadge key={r.id} repo={r} onScan={handleScan} />)}
          </div>
        )}
      </div>
    </div>
  );
}
