"use client";
import { Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn, fmtDate, statusColor } from "@/lib/utils";
import type { Scan } from "@/lib/api";

interface Props {
  scans: Scan[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  activeScanId: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-slate-800 text-slate-400", cloning: "bg-blue-950 text-blue-400",
  scanning: "bg-violet-950 text-violet-400", aggregating: "bg-cyan-950 text-cyan-400",
  ai_analysis: "bg-purple-950 text-purple-300", completed: "bg-emerald-950 text-emerald-400",
  failed: "bg-red-950 text-red-400",
};

export function ScanTable({ scans, onSelect, onDelete, activeScanId }: Props) {
  return (
    <div className="bg-sn-surface border border-sn-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-sn-border flex items-center justify-between">
        <span className="text-[12px] font-semibold text-sn-text tracking-wide">Recent Scans</span>
        <span className="text-[10px] text-sn-dim">{scans.length} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="border-b border-sn-border">
              {["Scan ID","Branch","Status","Progress","Findings","Date",""].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] text-sn-dim uppercase tracking-wider font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scans.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sn-dim italic text-[11px]">No scans yet. Start one from Repositories.</td></tr>
            ) : scans.map((scan, i) => (
              <motion.tr key={scan.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                onClick={() => onSelect(scan.id)}
                className={cn("border-b border-sn-border/50 cursor-pointer transition-colors",
                  scan.id === activeScanId ? "bg-violet-950/20" : "hover:bg-sn-muted/10")}>
                <td className="px-4 py-3 text-violet-400">{scan.id.split("-")[0].toUpperCase()}</td>
                <td className="px-4 py-3 text-sn-dim">{scan.branch}</td>
                <td className="px-4 py-3">
                  <span className={cn("px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider", STATUS_BADGE[scan.status])}>
                    {scan.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-sn-border rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${scan.progress}%` }} />
                    </div>
                    <span className="text-sn-dim">{scan.progress}%</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {scan.total_findings > 0 ? (
                    <span className="flex gap-1.5">
                      {scan.critical_count > 0 && <span className="text-red-400">{scan.critical_count}C</span>}
                      {scan.high_count > 0 && <span className="text-orange-400">{scan.high_count}H</span>}
                      {scan.medium_count > 0 && <span className="text-amber-400">{scan.medium_count}M</span>}
                    </span>
                  ) : <span className="text-sn-dim">—</span>}
                </td>
                <td className="px-4 py-3 text-sn-dim">{fmtDate(scan.created_at)}</td>
                <td className="px-2 py-3 text-right">
                  <button
                    title="Delete scan"
                    onClick={(e) => { e.stopPropagation(); onDelete(scan.id); }}
                    className="p-1.5 rounded text-sn-dim hover:text-red-400 hover:bg-red-950/30 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
