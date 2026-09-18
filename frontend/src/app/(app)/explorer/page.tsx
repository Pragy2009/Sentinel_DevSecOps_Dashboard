"use client";
import { useEffect, useState } from "react";
import { Loader2, FileCode } from "lucide-react";
import { scanApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Topbar } from "@/components/shared/Topbar";
import { CodeExplorer } from "@/components/scanner/CodeExplorer";
import { cn } from "@/lib/utils";
import type { Finding } from "@/lib/api";

export default function ExplorerPage() {
  const { scans, setScans } = useAppStore();
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(false);

  const completedScans = scans.filter(s => s.status === "completed" && s.total_findings > 0);

  useEffect(() => {
    scanApi.list().then(setScans).catch(() => {});
  }, [setScans]);

  const handleSelect = async (id: string) => {
    setSelectedScanId(id);
    setLoading(true);
    try {
      const detail = await scanApi.get(id);
      setFindings(detail.findings);
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Code Explorer" />
      <div className="flex flex-1 overflow-hidden p-5 gap-4">
        {/* Scan picker */}
        <div className="w-56 shrink-0 flex flex-col gap-2">
          <div className="text-[10px] text-sn-dim uppercase tracking-widest font-medium px-1">Select Scan</div>
          <div className="flex flex-col gap-1 overflow-y-auto">
            {completedScans.length === 0 ? (
              <div className="text-[11px] text-sn-dim italic px-1 py-4">No completed scans with findings.</div>
            ) : completedScans.map(s => (
              <button key={s.id} onClick={() => handleSelect(s.id)}
                className={cn("text-left px-3 py-2 rounded-lg border text-[11px] font-mono transition-colors",
                  selectedScanId === s.id
                    ? "bg-violet-950/60 border-violet-700 text-violet-300"
                    : "bg-sn-surface border-sn-border text-sn-dim hover:border-sn-muted hover:text-sn-text")}>
                <div className="text-[10px] font-bold mb-0.5">{s.id.split("-")[0].toUpperCase()}</div>
                <div className="text-[9px] text-sn-muted">{s.branch}</div>
                <div className="text-[9px] mt-1">
                  <span className="text-red-400">{s.critical_count}C</span>
                  <span className="text-orange-400 ml-1">{s.high_count}H</span>
                  <span className="text-amber-400 ml-1">{s.medium_count}M</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Explorer */}
        <div className="flex-1 overflow-hidden">
          {!selectedScanId ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sn-dim bg-sn-surface border border-sn-border rounded-xl">
              <FileCode size={40} className="opacity-20" />
              <div className="text-[13px] italic">Select a scan to explore its findings in code</div>
            </div>
          ) : loading ? (
            <div className="h-full flex items-center justify-center bg-sn-surface border border-sn-border rounded-xl">
              <Loader2 size={24} className="animate-spin text-violet-400" />
            </div>
          ) : (
            <CodeExplorer findings={findings} />
          )}
        </div>
      </div>
    </div>
  );
}
