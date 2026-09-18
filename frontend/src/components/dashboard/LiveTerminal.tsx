"use client";
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const levelStyle = {
  info:    "text-sn-dim",
  success: "text-emerald-400",
  warn:    "text-amber-400",
  error:   "text-red-400",
};

const prompt = {
  info:    "❯",
  success: "✔",
  warn:    "!",
  error:   "✘",
};

export function LiveTerminal({ activeScanId }: { activeScanId: string | null }) {
  const lines = useAppStore(s => s.streamLines);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="bg-[#0a0c14] border border-sn-border rounded-xl overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-sn-surface border-b border-sn-border">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500/70" />
          <span className="w-3 h-3 rounded-full bg-amber-500/70" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
        </div>
        <span className="ml-2 text-[10px] text-sn-dim font-mono tracking-wider">
          sentinel@engine {activeScanId ? `~ scan:${activeScanId.split("-")[0]}` : "~ idle"}
        </span>
        {activeScanId && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <div className="text-sn-dim italic pt-2">Awaiting scan telemetry…</div>
        ) : (
          <AnimatePresence initial={false}>
            {lines.map((line, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.1 }}
                className="flex gap-2 items-start">
                <span className={cn("shrink-0 text-[10px]", levelStyle[line.level])}>{prompt[line.level]}</span>
                <span className={cn(levelStyle[line.level])}>{line.message}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {/* Blinking cursor */}
        <div className="flex gap-2 items-center">
          <span className="text-sn-dim">❯</span>
          <span className="w-2 h-3.5 bg-violet-500 animate-pulse inline-block" />
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
