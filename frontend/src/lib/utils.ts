import { type ClassValue, clsx } from "clsx";
import type { Severity } from "./api";

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

export const severityColor: Record<Severity, string> = {
  critical: "text-red-400 bg-red-950/50 border-red-800",
  high: "text-orange-400 bg-orange-950/50 border-orange-800",
  medium: "text-amber-400 bg-amber-950/50 border-amber-800",
  low: "text-blue-400 bg-blue-950/50 border-blue-800",
  info: "text-slate-400 bg-slate-900/50 border-slate-700",
};

export const severityBadge: Record<Severity, string> = {
  critical: "bg-red-900 text-red-300 border border-red-700",
  high: "bg-orange-900 text-orange-300 border border-orange-700",
  medium: "bg-amber-900 text-amber-300 border border-amber-700",
  low: "bg-blue-900 text-blue-300 border border-blue-700",
  info: "bg-slate-800 text-slate-400 border border-slate-600",
};

export const severityDot: Record<Severity, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500",
  low: "bg-blue-500", info: "bg-slate-500",
};

export const statusColor = {
  queued: "text-slate-400", cloning: "text-blue-400", scanning: "text-purple-400",
  aggregating: "text-cyan-400", ai_analysis: "text-violet-400",
  completed: "text-green-400", failed: "text-red-400",
};

export const healthColor = (score: number) =>
  score >= 80 ? "text-green-400" : score >= 50 ? "text-amber-400" : "text-red-400";

export const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
