"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Shield, AlertTriangle, Key, Package } from "lucide-react";
import { cn, severityBadge, severityColor } from "@/lib/utils";
import type { Finding } from "@/lib/api";

const categoryIcon = { sast: Shield, secret: Key, dependency: Package, container: Package, misconfig: AlertTriangle };

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="text-[10px] font-mono leading-relaxed overflow-x-auto">
      {diff.split("\n").map((line, i) => (
        <div key={i} className={cn(
          "px-2 py-0.5",
          line.startsWith("+") ? "bg-emerald-950/40 text-emerald-400" :
          line.startsWith("-") ? "bg-red-950/40 text-red-400" :
          line.startsWith("@@") ? "text-cyan-500 bg-cyan-950/20" : "text-sn-dim"
        )}>{line || " "}</div>
      ))}
    </pre>
  );
}

function FindingRow({ finding, onSelect, selected }: { finding: Finding; onSelect: (f: Finding) => void; selected: boolean }) {
  const Icon = categoryIcon[finding.category] ?? Shield;
  return (
    <div className={cn("border-b border-sn-border/50 cursor-pointer transition-colors",
      selected ? "bg-violet-950/20" : "hover:bg-sn-muted/10")}
      onClick={() => onSelect(finding)}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Icon size={13} className="text-sn-dim shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border", severityBadge[finding.severity])}>
              {finding.severity}
            </span>
            {finding.cve && <span className="text-[9px] text-cyan-500 font-mono">{finding.cve}</span>}
            {finding.cwe && <span className="text-[9px] text-sn-dim font-mono">{finding.cwe}</span>}
          </div>
          <div className="text-[11px] text-sn-text truncate">{finding.title}</div>
          {finding.file_path && (
            <div className="text-[10px] text-sn-dim mt-0.5 font-mono truncate">
              {finding.file_path}{finding.line_start ? `:${finding.line_start}` : ""}
            </div>
          )}
        </div>
        <div className="text-[10px] text-sn-dim shrink-0">{finding.scanner}</div>
        {selected ? <ChevronDown size={12} className="text-sn-dim" /> : <ChevronRight size={12} className="text-sn-dim" />}
      </div>
    </div>
  );
}

function FindingDetail({ finding }: { finding: Finding }) {
  const [tab, setTab] = useState<"overview" | "ai" | "diff">("overview");
  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "ai" as const, label: "AI Analysis", disabled: !finding.ai_explanation },
    { id: "diff" as const, label: "Patch", disabled: !finding.ai_patch_diff },
  ];
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
      className="border-b border-sn-border bg-sn-bg/50 overflow-hidden">
      {/* Tabs */}
      <div className="flex gap-0 border-b border-sn-border px-4">
        {tabs.map(t => (
          <button key={t.id} disabled={t.disabled} onClick={() => setTab(t.id)}
            className={cn("px-4 py-2 text-[11px] font-medium border-b-2 transition-colors",
              tab === t.id ? "border-violet-500 text-violet-300" : "border-transparent text-sn-dim hover:text-sn-text",
              t.disabled && "opacity-30 cursor-not-allowed")}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4 text-[11px]">
        {tab === "overview" && (
          <div className="space-y-3">
            <p className="text-sn-dim leading-relaxed">{finding.description}</p>
            {finding.code_snippet && (
              <div className="bg-sn-surface border border-sn-border rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 border-b border-sn-border text-[9px] text-sn-dim font-mono">
                  {finding.file_path}:{finding.line_start}
                </div>
                <pre className="p-3 text-[10px] text-emerald-300 font-mono overflow-x-auto leading-relaxed">{finding.code_snippet}</pre>
              </div>
            )}
          </div>
        )}
        {tab === "ai" && finding.ai_explanation && (
          <div className="space-y-3">
            <div>
              <div className="text-[10px] text-sn-dim uppercase tracking-wider mb-1">Exploit Mechanism</div>
              <p className="text-sn-text leading-relaxed">{finding.ai_explanation}</p>
            </div>
            <div>
              <div className="text-[10px] text-sn-dim uppercase tracking-wider mb-1">Business Impact</div>
              <p className="text-sn-text leading-relaxed">{finding.ai_impact}</p>
            </div>
            {finding.ai_exploitability !== null && (
              <div className="flex items-center gap-3">
                <div className="text-[10px] text-sn-dim uppercase tracking-wider">Exploitability Score</div>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-sn-border rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-red-500 rounded-full"
                      style={{ width: `${(finding.ai_exploitability / 10) * 100}%` }} />
                  </div>
                  <span className="text-amber-400 font-bold font-mono">{finding.ai_exploitability.toFixed(1)}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {tab === "diff" && finding.ai_patch_diff && (
          <div className="bg-sn-surface border border-sn-border rounded-lg overflow-hidden">
            <DiffView diff={finding.ai_patch_diff} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function FindingList({ findings }: { findings: Finding[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const grouped = findings.reduce((acc, f) => {
    (acc[f.severity] ??= []).push(f);
    return acc;
  }, {} as Record<string, Finding[]>);
  const order = ["critical", "high", "medium", "low", "info"];

  if (findings.length === 0) {
    return <div className="flex items-center justify-center h-40 text-sn-dim text-[12px] italic">No findings for this scan.</div>;
  }

  return (
    <div className="bg-sn-surface border border-sn-border rounded-xl overflow-hidden">
      {order.filter(s => grouped[s]?.length).map(severity => (
        <div key={severity}>
          <div className={cn("px-4 py-2 border-b border-sn-border/50 text-[10px] font-bold uppercase tracking-widest", {
            "text-red-400 bg-red-950/10": severity === "critical",
            "text-orange-400 bg-orange-950/10": severity === "high",
            "text-amber-400 bg-amber-950/10": severity === "medium",
            "text-blue-400 bg-blue-950/10": severity === "low",
            "text-sn-dim": severity === "info",
          })}>
            {severity} ({grouped[severity].length})
          </div>
          {grouped[severity].map(f => (
            <div key={f.id}>
              <FindingRow finding={f} selected={selected === f.id} onSelect={() => setSelected(selected === f.id ? null : f.id)} />
              <AnimatePresence>{selected === f.id && <FindingDetail finding={f} />}</AnimatePresence>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
