"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, FileJson, FileText, FileType2,
  GitCompare, ChevronDown, Loader2, TrendingDown,
  TrendingUp, Minus, AlertCircle, CheckCircle2,
} from "lucide-react";
import { scanApi, reportApi, type Scan, type ScanDiff, type ReportFormat } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Topbar } from "@/components/shared/Topbar";
import { cn, fmtDate, healthColor } from "@/lib/utils";

// ── Format button ─────────────────────────────────────────────────────────────
const FORMAT_CONFIG = {
  json:     { label: "JSON",     icon: FileJson,  color: "text-cyan-400",    border: "border-cyan-800/40",   bg: "bg-cyan-950/30"   },
  markdown: { label: "Markdown", icon: FileText,  color: "text-violet-400",  border: "border-violet-800/40", bg: "bg-violet-950/30" },
  pdf:      { label: "PDF",      icon: FileType2, color: "text-emerald-400", border: "border-emerald-800/40",bg: "bg-emerald-950/30"},
} as const;

function FormatButtons({
  scanId,
  disabled,
}: {
  scanId: string;
  disabled?: boolean;
}) {
  const [downloading, setDownloading] = useState<ReportFormat | null>(null);
  const [error, setError] = useState("");

  const handleDownload = async (fmt: ReportFormat) => {
    setDownloading(fmt);
    setError("");
    try {
      await reportApi.download(scanId, fmt);
    } catch (e) {
      // Backend returns 503 when WeasyPrint is unavailable — never a corrupt PDF.
      const status = (e as { status?: number; response?: { status?: number } })?.status
        ?? (e as { response?: { status?: number } })?.response?.status;
      setError(status === 503
        ? "PDF engine unavailable in this build — use Markdown or JSON."
        : "Download failed — is the backend running?");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        {(["json", "markdown", "pdf"] as ReportFormat[]).map((fmt) => {
          const cfg = FORMAT_CONFIG[fmt];
          const Icon = cfg.icon;
          const isLoading = downloading === fmt;
          return (
            <button
              key={fmt}
              onClick={() => handleDownload(fmt)}
              disabled={!!downloading || disabled}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40",
                cfg.bg, cfg.border, cfg.color,
                "hover:brightness-125"
              )}
            >
              {isLoading
                ? <Loader2 size={12} className="animate-spin" />
                : <Icon size={12} />}
              {cfg.label}
            </button>
          );
        })}
      </div>
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}

// ── Diff panel ────────────────────────────────────────────────────────────────
function DiffSummary({ diff }: { diff: ScanDiff }) {
  const [expanded, setExpanded] = useState<"new" | "resolved" | "persisting" | null>("new");

  const sections = [
    {
      key: "new" as const,
      label: "New Findings",
      findings: diff.new_findings,
      icon: TrendingUp,
      color: "text-red-400",
      bg: "bg-red-950/20",
      border: "border-red-900/40",
    },
    {
      key: "resolved" as const,
      label: "Resolved",
      findings: diff.resolved_findings,
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-950/20",
      border: "border-emerald-900/40",
    },
    {
      key: "persisting" as const,
      label: "Persisting",
      findings: diff.persisting_findings,
      icon: Minus,
      color: "text-amber-400",
      bg: "bg-amber-950/20",
      border: "border-amber-900/40",
    },
  ];

  return (
    <div className="space-y-2">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 mb-2">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.key} className={cn("rounded-lg border p-3 flex items-center gap-2", s.bg, s.border)}>
              <Icon size={14} className={s.color} />
              <div>
                <div className={cn("text-xl font-bold font-mono", s.color)}>{s.findings.length}</div>
                <div className="text-[9px] text-sn-dim uppercase tracking-wider">{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expandable sections */}
      {sections.map((s) => {
        const Icon = s.icon;
        const isOpen = expanded === s.key;
        return (
          <div key={s.key} className={cn("rounded-lg border overflow-hidden", s.border)}>
            <button
              onClick={() => setExpanded(isOpen ? null : s.key)}
              className={cn("w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium transition-colors", s.bg, "hover:brightness-110")}
            >
              <div className="flex items-center gap-2">
                <Icon size={13} className={s.color} />
                <span className={s.color}>{s.label}</span>
                <span className="text-sn-dim">({s.findings.length})</span>
              </div>
              <ChevronDown size={13} className={cn("text-sn-dim transition-transform", isOpen && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && s.findings.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="divide-y divide-sn-border/30 max-h-72 overflow-y-auto">
                    {s.findings.map((f) => (
                      <div key={f.id} className="px-4 py-2.5 flex items-start gap-2.5">
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border mt-0.5", {
                          "bg-red-950/60 text-red-400 border-red-800": f.severity === "critical",
                          "bg-orange-950/60 text-orange-400 border-orange-800": f.severity === "high",
                          "bg-amber-950/60 text-amber-400 border-amber-800": f.severity === "medium",
                          "bg-blue-950/60 text-blue-400 border-blue-800": f.severity === "low",
                          "bg-slate-900 text-slate-400 border-slate-700": f.severity === "info",
                        })}>
                          {f.severity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-sn-text truncate">{f.title}</div>
                          {f.file_path && (
                            <div className="text-[10px] text-sn-dim font-mono truncate">
                              {f.file_path}{f.line_start ? `:${f.line_start}` : ""}
                            </div>
                          )}
                        </div>
                        <span className="text-[9px] text-sn-dim shrink-0">{f.scanner}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
              {isOpen && s.findings.length === 0 && (
                <motion.div
                  initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                  className="px-4 py-3 text-[11px] text-sn-dim italic overflow-hidden"
                >
                  None.
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ── Scan selector ─────────────────────────────────────────────────────────────
function ScanPicker({
  scans,
  selected,
  onSelect,
  label,
}: {
  scans: Scan[];
  selected: string | null;
  onSelect: (id: string) => void;
  label: string;
}) {
  const completed = scans.filter((s) => s.status === "completed");
  return (
    <div className="flex-1">
      <label className="block text-[10px] text-sn-dim uppercase tracking-widest mb-1.5">{label}</label>
      <select
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full bg-sn-bg border border-sn-border rounded-lg px-3 py-2 text-[12px] text-sn-text font-mono focus:outline-none focus:border-violet-600 transition-colors"
      >
        <option value="" disabled>Select scan…</option>
        {completed.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id.split("-")[0].toUpperCase()} — {s.branch} — {s.total_findings} findings — {fmtDate(s.created_at)}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { scans, setScans } = useAppStore();
  const [loading, setLoading] = useState(true);

  // Diff state
  const [baseId, setBaseId] = useState<string | null>(null);
  const [headId, setHeadId] = useState<string | null>(null);
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [diffDownloading, setDiffDownloading] = useState<"json" | "markdown" | null>(null);

  useEffect(() => {
    scanApi.list()
      .then(setScans)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setScans]);

  const completedScans = scans.filter((s) => s.status === "completed");

  const handleCompareDiff = async () => {
    if (!baseId || !headId) return;
    if (baseId === headId) {
      setDiffError("Select two different scans to compare.");
      return;
    }
    setDiffLoading(true);
    setDiffError("");
    setDiff(null);
    try {
      const result = await scanApi.diff(baseId, headId);
      setDiff(result);
    } catch {
      setDiffError("Failed to fetch diff. Ensure both scans are completed.");
    } finally {
      setDiffLoading(false);
    }
  };

  const handleDiffDownload = async (fmt: "json" | "markdown") => {
    if (!baseId || !headId) return;
    setDiffDownloading(fmt);
    try {
      await reportApi.downloadDiff(baseId, headId, fmt);
    } catch {
      setDiffError("Diff download failed.");
    } finally {
      setDiffDownloading(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Reports" />
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* ── Scan History & Export ─────────────────────────────────────── */}
        <div className="bg-sn-surface border border-sn-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-sn-border">
            <div className="flex items-center gap-2.5">
              <Download size={15} className="text-violet-400" />
              <span className="text-[13px] font-semibold text-sn-text">Scan History & Export</span>
            </div>
            <span className="text-[11px] text-sn-dim">{completedScans.length} completed scans</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-violet-400" />
            </div>
          ) : completedScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-sn-dim">
              <AlertCircle size={32} className="opacity-20" />
              <div className="text-[12px] italic">No completed scans yet. Run a scan first.</div>
            </div>
          ) : (
            <div className="divide-y divide-sn-border/50">
              {completedScans.map((scan, i) => (
                <motion.div
                  key={scan.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-sn-muted/10 transition-colors"
                >
                  {/* Left: scan info */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-mono text-violet-400 font-bold">
                          {scan.id.split("-")[0].toUpperCase()}
                        </span>
                        <span className="text-[10px] text-sn-dim font-mono">{scan.branch}</span>
                        {scan.commit_sha && (
                          <span className="text-[10px] text-cyan-500 font-mono">{scan.commit_sha.slice(0, 7)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-sn-dim">{fmtDate(scan.created_at)}</span>
                        <div className="flex gap-1.5 text-[10px]">
                          {scan.critical_count > 0 && <span className="text-red-400">{scan.critical_count}C</span>}
                          {scan.high_count > 0 && <span className="text-orange-400">{scan.high_count}H</span>}
                          {scan.medium_count > 0 && <span className="text-amber-400">{scan.medium_count}M</span>}
                          {scan.low_count > 0 && <span className="text-blue-400">{scan.low_count}L</span>}
                          {scan.total_findings === 0 && <span className="text-emerald-400">Clean</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: export buttons */}
                  <FormatButtons scanId={scan.id} />
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* ── Scan Diff ─────────────────────────────────────────────────── */}
        <div className="bg-sn-surface border border-sn-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-sn-border">
            <GitCompare size={15} className="text-cyan-400" />
            <span className="text-[13px] font-semibold text-sn-text">Scan Comparison</span>
          </div>

          <div className="p-5 space-y-4">
            {/* Picker row */}
            <div className="flex items-end gap-3">
              <ScanPicker scans={scans} selected={baseId} onSelect={setBaseId} label="Base Scan (older)" />
              <div className="mb-2 text-sn-dim text-[18px] shrink-0">→</div>
              <ScanPicker scans={scans} selected={headId} onSelect={setHeadId} label="Head Scan (newer)" />
              <button
                onClick={handleCompareDiff}
                disabled={!baseId || !headId || diffLoading}
                className="mb-0 flex items-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 rounded-lg text-white text-[12px] font-medium transition-colors disabled:opacity-40"
              >
                {diffLoading
                  ? <Loader2 size={13} className="animate-spin" />
                  : <GitCompare size={13} />}
                Compare
              </button>
            </div>

            {diffError && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
                {diffError}
              </motion.div>
            )}
            <div className="text-[10px] text-sn-dim">
              Note: scans taken before the fingerprint-v2 update show full churn vs newer scans (v1 vs v2 fingerprints aren&apos;t comparable).
            </div>

            {/* Diff results */}
            <AnimatePresence>
              {diff && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* Diff export */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-sn-dim">
                      Comparing <span className="text-violet-400 font-mono">{diff.base_scan_id.split("-")[0].toUpperCase()}</span>
                      {" → "}
                      <span className="text-violet-400 font-mono">{diff.head_scan_id.split("-")[0].toUpperCase()}</span>
                    </span>
                    <div className="flex gap-2">
                      {(["markdown", "json"] as const).map((fmt) => {
                        const isLoading = diffDownloading === fmt;
                        return (
                          <button
                            key={fmt}
                            onClick={() => handleDiffDownload(fmt)}
                            disabled={!!diffDownloading}
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-40",
                              fmt === "markdown"
                                ? "bg-violet-950/30 border-violet-800/40 text-violet-400"
                                : "bg-cyan-950/30 border-cyan-800/40 text-cyan-400",
                              "hover:brightness-125"
                            )}
                          >
                            {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                            {fmt === "markdown" ? "Markdown" : "JSON"}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <DiffSummary diff={diff} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>
    </div>
  );
}
