"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Activity, AlertOctagon, GitBranch, ShieldCheck } from "lucide-react";
import { dashboardApi, scanApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useScanStream } from "@/hooks/useScanStream";
import { Topbar } from "@/components/shared/Topbar";
import { StatCard } from "@/components/dashboard/StatCard";
import { SeverityBarChart, PostureRadar } from "@/components/dashboard/SeverityChart";
import { LiveTerminal } from "@/components/dashboard/LiveTerminal";
import { ScanTable } from "@/components/dashboard/ScanTable";
import { healthColor } from "@/lib/utils";

export default function DashboardPage() {
  const { stats, scans, setStats, setScans, activeScan, setActiveScan } = useAppStore();
  const [activeScanId, setActiveScanId] = useState<string | null>(null);

  // Re-fetch detail + stats when the active scan reaches a terminal state,
  // so the table counts and Scan Results panel update without another click.
  const handleTerminal = useCallback(async () => {
    try {
      const [statsData, scansData] = await Promise.all([dashboardApi.stats(), scanApi.list()]);
      setStats(statsData);
      setScans(scansData);
    } catch { /* backend may not be up */ }
    if (activeScanId) {
      try {
        const detail = await scanApi.get(activeScanId);
        setActiveScan(detail);
      } catch { /* scan may have been deleted */ }
    }
  }, [activeScanId, setStats, setScans, setActiveScan]);

  useScanStream(activeScanId, handleTerminal);

  const loadData = useCallback(async () => {
    try {
      const [statsData, scansData] = await Promise.all([dashboardApi.stats(), scanApi.list()]);
      setStats(statsData);
      setScans(scansData);
    } catch { /* backend may not be up */ }
  }, [setStats, setScans]);

  useEffect(() => { loadData(); }, [loadData]);

  // Fetch full detail (with findings) whenever the selection changes.
  useEffect(() => {
    if (!activeScanId) return;
    scanApi.get(activeScanId).then(setActiveScan).catch(() => {});
  }, [activeScanId, setActiveScan]);

  // Auto-refresh while a scan is running
  useEffect(() => {
    const running = scans.some(s => !["completed", "failed"].includes(s.status));
    if (!running) return;
    const id = setInterval(loadData, 5000);
    return () => clearInterval(id);
  }, [scans, loadData]);

  const handleRefresh = async () => {
    await loadData();
  };

  const handleSelectScan = (id: string) => {
    setActiveScanId(id);
  };

  const handleDeleteScan = async (id: string) => {
    if (!window.confirm("Delete this scan and all its findings? This cannot be undone.")) return;
    try {
      await scanApi.remove(id);
    } catch {
      // Fall through to refetch — row may already be gone.
    }
    setScans(scans.filter(s => s.id !== id));
    if (activeScanId === id) {
      setActiveScanId(null);
      setActiveScan(null);
    }
    loadData().catch(() => {});
  };

  const dist = stats?.severity_distribution ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const totalFindings = Object.values(dist).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Dashboard" onRefresh={handleRefresh} />
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Active Scans" accent="purple" delay={0}
            value={scans.filter(s => !["completed","failed"].includes(s.status)).length}
            sub={`${scans.length} total scans`}
            icon={<Activity size={15} />} />
          <StatCard label="Critical Findings" accent="red" delay={0.05}
            value={dist.critical}
            delta={dist.critical > 0 ? "Immediate action" : "All clear"}
            deltaPositive={dist.critical === 0}
            icon={<AlertOctagon size={15} />} />
          <StatCard label="Repositories" accent="blue" delay={0.1}
            value={stats?.total_repositories ?? 0}
            sub="Connected via GitHub"
            icon={<GitBranch size={15} />} />
          <StatCard label="Avg Health Score" accent="green" delay={0.15}
            value={<span className={healthColor(stats?.avg_health_score ?? 100)}>{stats?.avg_health_score ?? 100}</span>}
            sub="Out of 100"
            icon={<ShieldCheck size={15} />} />
        </div>

        {/* Mid row */}
        <div className="grid grid-cols-[1fr_280px] gap-4">
          {/* Severity chart */}
          <div className="bg-sn-surface border border-sn-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-semibold text-sn-text">Severity Distribution</span>
              <span className="text-[10px] text-sn-dim">{totalFindings} total findings</span>
            </div>
            <SeverityBarChart distribution={dist} />
          </div>

          {/* Health score + posture radar (axes from real category counts) */}
          <div className="bg-sn-surface border border-sn-border rounded-xl p-4 flex flex-col items-center justify-center">
            <span className="text-[12px] font-semibold text-sn-text mb-2">Security Posture</span>
            <span className={`text-2xl font-bold font-mono ${healthColor(stats?.avg_health_score ?? 100)}`}>
              {stats?.avg_health_score ?? 100}
            </span>
            <span className="text-[11px] text-sn-dim">/ 100</span>
            <span className="text-[10px] text-sn-dim mt-2 text-center">Overall health across scanned repos</span>
            <div className="w-full mt-1">
              <PostureRadar distribution={stats?.category_distribution ?? {}} />
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-[1fr_380px] gap-4" style={{ minHeight: "320px" }}>
          {/* Scan table */}
          <ScanTable scans={scans} onSelect={handleSelectScan} onDelete={handleDeleteScan} activeScanId={activeScanId} />

          {/* Live terminal */}
          <LiveTerminal activeScanId={activeScanId} />
        </div>

        {/* Active scan findings summary */}
        {activeScan && activeScan.status === "completed" && activeScan.findings.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-sn-surface border border-sn-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-semibold text-sn-text">
                Scan Results — {activeScan.id.split("-")[0].toUpperCase()}
              </span>
              <span className="text-[10px] text-sn-dim">{activeScan.findings.length} findings</span>
            </div>
            <div className="grid grid-cols-5 gap-3">
              {(["critical","high","medium","low","info"] as const).map(s => (
                <div key={s} className="text-center">
                  <div className={`text-2xl font-bold font-mono ${
                    s==="critical"?"text-red-400":s==="high"?"text-orange-400":s==="medium"?"text-amber-400":s==="low"?"text-blue-400":"text-sn-dim"
                  }`}>
                    {activeScan[`${s}_count` as keyof typeof activeScan] as number ?? 0}
                  </div>
                  <div className="text-[9px] text-sn-dim uppercase tracking-wider mt-0.5">{s}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
