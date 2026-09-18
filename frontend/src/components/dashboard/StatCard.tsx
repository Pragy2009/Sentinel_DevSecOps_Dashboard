"use client";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: string;
  deltaPositive?: boolean;
  accent: "purple" | "red" | "amber" | "green" | "blue" | "cyan";
  icon?: ReactNode;
  delay?: number;
}

const accentMap = {
  purple: { bar: "bg-violet-500", top: "bg-gradient-to-r from-violet-600 to-purple-600", val: "text-violet-300" },
  red:    { bar: "bg-red-500",    top: "bg-gradient-to-r from-red-600 to-rose-600",       val: "text-red-400" },
  amber:  { bar: "bg-amber-500",  top: "bg-gradient-to-r from-amber-500 to-orange-500",   val: "text-amber-400" },
  green:  { bar: "bg-emerald-500",top: "bg-gradient-to-r from-emerald-500 to-teal-500",   val: "text-emerald-400" },
  blue:   { bar: "bg-blue-500",   top: "bg-gradient-to-r from-blue-500 to-indigo-500",    val: "text-blue-400" },
  cyan:   { bar: "bg-cyan-500",   top: "bg-gradient-to-r from-cyan-500 to-sky-500",       val: "text-cyan-400" },
};

export function StatCard({ label, value, sub, delta, deltaPositive, accent, icon, delay = 0 }: Props) {
  const a = accentMap[accent];
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3 }}
      className="relative bg-sn-surface border border-sn-border rounded-xl p-4 overflow-hidden group hover:border-sn-muted transition-colors">
      <div className={cn("absolute top-0 left-0 right-0 h-[2px]", a.top)} />
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] text-sn-dim uppercase tracking-widest">{label}</span>
        {icon && <div className="text-sn-dim opacity-60">{icon}</div>}
      </div>
      <div className={cn("text-3xl font-bold font-mono leading-none mb-1", a.val)}>{value}</div>
      <div className="flex items-center justify-between mt-2">
        {sub && <span className="text-[10px] text-sn-dim">{sub}</span>}
        {delta && <span className={cn("text-[10px] font-medium", deltaPositive ? "text-emerald-400" : "text-red-400")}>{delta}</span>}
      </div>
    </motion.div>
  );
}
