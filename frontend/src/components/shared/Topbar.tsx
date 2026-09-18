"use client";
import { RefreshCw } from "lucide-react";

export function Topbar({ title, onRefresh }: { title: string; onRefresh?: () => void | Promise<void> }) {
  return (
    <header className="h-12 bg-sn-surface border-b border-sn-border flex items-center justify-between px-6 flex-shrink-0">
      <h1 className="text-[13px] font-semibold text-sn-text tracking-wider uppercase">{title}</h1>
      <div className="flex items-center gap-3">
        {onRefresh && (
          <button onClick={() => onRefresh()}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-sn-muted/30 border border-sn-border rounded-md text-sn-dim hover:text-sn-text text-[11px] transition-colors">
            <RefreshCw size={12} /> Refresh
          </button>
        )}
      </div>
    </header>
  );
}
