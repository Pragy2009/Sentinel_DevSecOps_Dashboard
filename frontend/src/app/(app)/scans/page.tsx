"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Search, Filter, Loader2, Trash2 } from "lucide-react";
import { scanApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useScanStream } from "@/hooks/useScanStream";
import { Topbar } from "@/components/shared/Topbar";
import { FindingList } from "@/components/scanner/FindingList";
import { LiveTerminal } from "@/components/dashboard/LiveTerminal";
import { cn, fmtDate, healthColor } from "@/lib/utils";
import type { ScanDetail, Severity } from "@/lib/api";

const STATUS_PILL: Record<string, string> = {
  queued:      "bg-slate-800/60 text-slate-400 border-slate-700",
  cloning:     "bg-blue-950/60 text-blue-400 border-blue-800",
  scanning:    "bg-violet-950/60 text-violet-400 border-violet-800",
  aggregating: "bg-cyan-950/60 text-cyan-400 border-cyan-800",
  ai_analysis: "bg-purple-950/60 text-purple-300 border-purple-800",
  completed:   "bg-emerald-950/60 text-emerald-400 border-emerald-800",
  failed:      "bg-red-950/60 text-red-400 border-red-800",
};

export default function ScansPage() {
  const { scans, setScans, activeScan, setActiveScan } = useAppStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sevFilter, setSevFilter] = useState<Severity | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");

  useScanStream(selectedId);

  useEffect(() => {
    scanApi.list().then(setScans).catch(() => {}).finally(() => setLoading(false));
  }, [setScans]);

  // Auto-refresh running scans
  useEffect(() => {
    const running = scans.some(s => !["completed","failed"].includes(s.status));
    if (!running) return;
    const id = setInterval(() => scanApi.list().then(setScans).catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [scans, setScans]);

  const handleSelect = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const detail = await scanApi.get(id);
      setActiveScan(detail);
    } catch {
      setActiveScan(null);
    } finally { setDetailLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this scan and all its findings? This cannot be undone.")) return;
    try {
      await scanApi.remove(id);
    } catch { /* row may already be gone */ }
    setScans(scans.filter(s => s.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setActiveScan(null);
    }
  };

  const filteredFindings = (activeScan?.findings ?? []).filter(f => {
    if (sevFilter !== "all" && f.severity !== sevFilter) return false;
    if (searchTerm && !f.title.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !(f.file_path ?? "").toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const activeIsRunning = selectedId
    ? !["completed","failed"].includes(scans.find(s => s.id === selectedId)?.status ?? "")
    : false;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Scans" />
      <div className="flex flex-1 overflow-hidden">

        {/* Scan list sidebar */}
        <div className="w-72 min-w-72 border-r border-sn-border flex flex-col bg-sn-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-sn-border">
            <span className="text-[11px] font-semibold text-sn-text uppercase tracking-wider">
              {scans.length} Scans
            </span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-sn-border/40">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={18} className="animate-spin text-sn-dim" />
              </div>
            ) : scans.length === 0 ? (
              <div className="px-4 py-8 text-[11px] text-sn-dim italic text-center">No scans yet.</div>
            ) : scans.map(scan => (
              <motion.button key={scan.id} onClick={() => handleSelect(scan.id)}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className={cn("w-full text-left px-4 py-3 transition-colors hover:bg-sn-muted/10",
                  selectedId === scan.id && "bg-violet-950/30 border-r-2 border-violet-500")}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-mono text-violet-400">{scan.id.split("-")[0].toUpperCase()}</span>
                  <span className="flex items-center gap-1">
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-medium", STATUS_PILL[scan.status])}>
                      {scan.status}
                    </span>
                    <span
                      role="button" title="Delete scan"
                      onClick={(e) => { e.stopPropagation(); handleDelete(scan.id); }}
                      className="p-1 rounded text-sn-muted hover:text-red-400 hover:bg-red-950/30 transition-colors">
                      <Trash2 size={12} />
                    </span>
                  </span>
                </div>
                <div className="text-[10px] text-sn-dim mb-1.5 font-mono">{scan.branch}</div>
                {scan.status === "scanning" || scan.status === "cloning" || scan.status === "aggregating" || scan.status === "ai_analysis" ? (
                  <div className="w-full h-1 bg-sn-border rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${scan.progress}%` }} />
                  </div>
                ) : scan.total_findings > 0 ? (
                  <div className="flex gap-1.5 text-[9px]">
                    {scan.critical_count > 0 && <span className="text-red-400">{scan.critical_count}C</span>}
                    {scan.high_count > 0 && <span className="text-orange-400">{scan.high_count}H</span>}
                    {scan.medium_count > 0 && <span className="text-amber-400">{scan.medium_count}M</span>}
                    {scan.low_count > 0 && <span className="text-blue-400">{scan.low_count}L</span>}
                  </div>
                ) : null}
                <div className="text-[9px] text-sn-muted mt-1">{fmtDate(scan.created_at)}</div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Detail pane */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sn-dim">
              <ChevronRight size={40} className="opacity-20" />
              <div className="text-[13px] italic">Select a scan to view results</div>
            </div>
          ) : activeIsRunning ? (
            <div className="flex-1 p-5">
              <LiveTerminal activeScanId={selectedId} />
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-violet-400" />
            </div>
          ) : activeScan ? (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Scan meta */}
              <div className="bg-sn-surface border border-sn-border rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[14px] font-bold text-sn-text font-mono mb-1">
                      {activeScan.id.split("-")[0].toUpperCase()}
                    </div>
                    <div className="text-[11px] text-sn-dim">Branch: <span className="text-sn-text font-mono">{activeScan.branch}</span></div>
                    {activeScan.commit_sha && (
                      <div className="text-[11px] text-sn-dim">Commit: <span className="text-cyan-400 font-mono">{activeScan.commit_sha.slice(0,8)}</span></div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={cn("text-[10px] px-2 py-1 rounded border uppercase tracking-wider font-medium", STATUS_PILL[activeScan.status])}>
                      {activeScan.status}
                    </span>
                    <button
                      onClick={() => handleDelete(activeScan.id)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded border border-sn-border text-[10px] text-sn-dim hover:text-red-400 hover:border-red-800 transition-colors">
                      <Trash2 size={11} /> Delete scan
                    </button>
                    {activeScan.completed_at && (
                      <span className="text-[10px] text-sn-dim">{fmtDate(activeScan.completed_at)}</span>
                    )}
                  </div>
                </div>
                {activeScan.scanners_run && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {Object.entries(activeScan.scanners_run).map(([scanner, status]) => (
                      <span key={scanner}
                        className={cn("px-2 py-0.5 rounded text-[9px] font-mono border", status === "ok"
                          ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/40"
                          : "bg-red-950/40 text-red-400 border-red-800/40")}>
                        {scanner}: {status === "ok" ? "✔" : "✘"}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Findings filters */}
              {activeScan.findings.length > 0 && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-xs">
                      <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-sn-dim" />
                      <input
                        type="text" placeholder="Filter findings…" value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full bg-sn-surface border border-sn-border rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-sn-text placeholder:text-sn-muted focus:outline-none focus:border-violet-600"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      {(["all","critical","high","medium","low"] as const).map(s => (
                        <button key={s} onClick={() => setSevFilter(s)}
                          className={cn("px-2.5 py-1 rounded text-[10px] border font-medium transition-colors capitalize",
                            sevFilter === s
                              ? "bg-violet-900/60 text-violet-300 border-violet-700"
                              : "bg-sn-surface text-sn-dim border-sn-border hover:border-sn-muted")}>
                          {s}
                        </button>
                      ))}
                    </div>
                    <span className="text-[10px] text-sn-dim">{filteredFindings.length} shown</span>
                  </div>
                  <FindingList findings={filteredFindings} />
                </>
              )}

              {activeScan.findings.length === 0 && activeScan.status === "completed" && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-sn-dim">
                  <div className="text-4xl">🎉</div>
                  <div className="text-[13px]">No findings — clean scan!</div>
                </div>
              )}

              {activeScan.error_message && (
                <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-[12px] text-red-400">
                  <div className="font-semibold mb-1">Scan Error</div>
                  <div className="font-mono text-[11px]">{activeScan.error_message}</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
