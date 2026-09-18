"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
         RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import type { FindingCategory, Severity } from "@/lib/api";

const SEV_COLORS: Record<Severity, string> = {
  critical: "#f85149", high: "#f97316", medium: "#e3b341", low: "#58a6ff", info: "#7d8590",
};

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-sn-surface border border-sn-border rounded-lg px-3 py-2 text-[11px] font-mono">
      <span className="text-sn-dim capitalize">{label}: </span>
      <span className="text-sn-text font-bold">{payload[0].value}</span>
    </div>
  );
};

export function SeverityBarChart({ distribution }: { distribution: Record<Severity, number> }) {
  const data = (["critical", "high", "medium", "low", "info"] as Severity[]).map(s => ({
    name: s.charAt(0).toUpperCase() + s.slice(1), value: distribution[s] ?? 0, severity: s,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#7d8590", fontFamily: "monospace" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: "#7d8590" }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map(entry => <Cell key={entry.severity} fill={SEV_COLORS[entry.severity]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// P2-4: HealthRadar removed — it fabricated Secrets/Deps/Config as
// score×0.85/0.9/0.95 with no backing data. Use the numeric health score
// + bar chart until per-category data exists in the API.

// ── Security Posture radar ─────────────────────────────────────────────
// Same mesh look as the original, but every axis is derived from REAL
// finding counts per category (GET /dashboard/stats → category_distribution).
// Axis score: 100 when clean, −12 per finding, floored at 5. Hover any
// vertex for the raw count behind it.

const POSTURE_AXES: { key: FindingCategory; label: string }[] = [
  { key: "secret",     label: "Secrets" },
  { key: "dependency", label: "Deps" },
  { key: "sast",       label: "Code" },
  { key: "misconfig",  label: "Config" },
  { key: "container",  label: "Containers" },
];

const axisScore = (count: number) =>
  count <= 0 ? 100 : Math.max(5, 100 - 12 * count);

const RadarTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: { label: string; score: number; count: number } }[] }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-sn-surface border border-sn-border rounded-lg px-3 py-2 text-[11px] font-mono">
      <div className="text-sn-text font-bold">{p.label}: {p.score}</div>
      <div className="text-sn-dim">{p.count} finding{p.count !== 1 ? "s" : ""}</div>
    </div>
  );
};

export function PostureRadar({ distribution }: { distribution: Partial<Record<FindingCategory, number>> }) {
  const data = POSTURE_AXES.map(({ key, label }) => {
    const count = distribution[key] ?? 0;
    return { axis: label, label, score: axisScore(count), count };
  });
  return (
    <ResponsiveContainer width="100%" height={190}>
      <RadarChart data={data} outerRadius="68%">
        <PolarGrid stroke="#1c2333" />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9, fill: "#7d8590", fontFamily: "monospace" }} />
        <Tooltip content={<RadarTooltip />} />
        <Radar dataKey="score" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.35} dot={{ r: 2.5, fill: "#a78bfa", strokeWidth: 0 }} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
