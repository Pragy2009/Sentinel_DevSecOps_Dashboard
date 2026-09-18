"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X, ChevronRight, FileCode } from "lucide-react";
import type { Finding } from "@/lib/api";
import { cn, severityBadge } from "@/lib/utils";

// ─── Monaco theme ────────────────────────────────────────────────────────────
const SENTINEL_THEME = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "comment",   foreground: "6e7681" },
    { token: "keyword",   foreground: "ff7b72" },
    { token: "string",    foreground: "a5d6ff" },
    { token: "number",    foreground: "79c0ff" },
    { token: "type",      foreground: "ffa657" },
    { token: "function",  foreground: "d2a8ff" },
    { token: "variable",  foreground: "e6edf3" },
    { token: "operator",  foreground: "ff7b72" },
  ],
  colors: {
    "editor.background":           "#080b12",
    "editor.foreground":           "#e6edf3",
    "editor.lineHighlightBackground": "#161b22",
    "editor.selectionBackground":  "#264f78",
    "editorLineNumber.foreground": "#2d3748",
    "editorLineNumber.activeForeground": "#7d8590",
    "editor.findMatchBackground":  "#ea6045",
    "editorGutter.background":     "#080b12",
    "scrollbarSlider.background":  "#1c2333",
    "scrollbarSlider.hoverBackground": "#2d3748",
    "minimap.background":          "#0d1117",
  },
};

// ─── Decoration builder ──────────────────────────────────────────────────────
function buildDecorations(
  monacoInstance: Monaco,
  findings: Finding[],
): any[] {
  const decorations: any[] = [];

  for (const f of findings) {
    if (!f.line_start) continue;
    const line = f.line_start;
    const lineEnd = f.line_end ?? line;

    // Severity → glyph + highlight colour
    const sevConfig: Record<string, { glyph: string; bg: string; overview: string }> = {
      critical: { glyph: "sentinel-glyph-critical", bg: "sentinelLineCritical",  overview: "#f85149" },
      high:     { glyph: "sentinel-glyph-high",     bg: "sentinelLineHigh",      overview: "#f97316" },
      medium:   { glyph: "sentinel-glyph-medium",   bg: "sentinelLineMedium",    overview: "#e3b341" },
      low:      { glyph: "sentinel-glyph-low",      bg: "sentinelLineLow",       overview: "#58a6ff" },
      info:     { glyph: "sentinel-glyph-info",     bg: "sentinelLineInfo",      overview: "#7d8590" },
    };

    const cfg = sevConfig[f.severity] ?? sevConfig.info;

    // Line highlight
    decorations.push({
      range: new monacoInstance.Range(line, 1, lineEnd, 9999),
      options: {
        isWholeLine: true,
        className: cfg.bg,
        glyphMarginClassName: cfg.glyph,
        overviewRuler: { color: cfg.overview, position: monacoInstance.editor.OverviewRulerLane.Right },
        minimap: { color: cfg.overview, position: monacoInstance.editor.MinimapPosition.Inline },
        hoverMessage: { value: `**${f.severity.toUpperCase()}** — ${f.title}\n\n${f.description.slice(0, 200)}` },
      },
    });
  }

  return decorations;
}

// ─── File tree node ──────────────────────────────────────────────────────────
interface FileNode {
  name: string;
  path: string;
  findings: Finding[];
  children: Record<string, FileNode>;
  isDir: boolean;
}

function buildFileTree(findings: Finding[]): FileNode {
  const root: FileNode = { name: "", path: "", findings: [], children: {}, isDir: true };
  for (const f of findings) {
    if (!f.file_path) continue;
    const parts = f.file_path.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          findings: [],
          isDir: i < parts.length - 1,
          children: {},
        };
      }
      node = node.children[part];
      if (i === parts.length - 1) node.findings.push(f);
    }
  }
  return root;
}

function maxSeverity(findings: Finding[]): string {
  const order = ["critical", "high", "medium", "low", "info"];
  for (const s of order) if (findings.some(f => f.severity === s)) return s;
  return "info";
}

const SEV_DOT: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-400",
  low: "bg-blue-500", info: "bg-slate-500",
};

function FileTreeNode({
  node, depth = 0, onSelect, selectedPath,
}: {
  node: FileNode; depth?: number; onSelect: (f: FileNode) => void; selectedPath: string | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  const children = Object.values(node.children).sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
  );
  const allFindings = [...node.findings, ...children.flatMap(c => c.findings)];
  const sev = maxSeverity(allFindings);
  const hasBug = allFindings.length > 0;

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 w-full px-2 py-1 hover:bg-sn-muted/20 rounded transition-colors text-[11px] text-sn-dim hover:text-sn-text"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <ChevronRight size={11} className={cn("transition-transform", open && "rotate-90")} />
          <span className="font-mono">{node.name || "/"}</span>
          {hasBug && <span className={cn("ml-auto w-1.5 h-1.5 rounded-full", SEV_DOT[sev])} />}
        </button>
        {open && children.map(c => (
          <FileTreeNode key={c.path} node={c} depth={depth + 1} onSelect={onSelect} selectedPath={selectedPath} />
        ))}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <button
      onClick={() => onSelect(node)}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      className={cn(
        "flex items-center gap-1.5 w-full px-2 py-1 rounded transition-colors text-[11px] font-mono",
        isSelected
          ? "bg-violet-950/60 text-violet-300 border-r-2 border-violet-500"
          : "text-sn-dim hover:text-sn-text hover:bg-sn-muted/20"
      )}
    >
      <FileCode size={11} className="shrink-0" />
      <span className="truncate">{node.name}</span>
      {node.findings.length > 0 && (
        <span className={cn("ml-auto shrink-0 w-1.5 h-1.5 rounded-full", SEV_DOT[maxSeverity(node.findings)])} />
      )}
    </button>
  );
}

// ─── Inline annotation panel ─────────────────────────────────────────────────
function AnnotationPanel({
  findings, onClose,
}: {
  findings: Finding[]; onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-80 border-l border-sn-border bg-sn-surface flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-sn-border">
        <span className="text-[11px] font-semibold text-sn-text">
          {findings.length} Finding{findings.length !== 1 ? "s" : ""}
        </span>
        <button onClick={onClose} className="text-sn-dim hover:text-sn-text transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-sn-border/50">
        {findings.map(f => (
          <div key={f.id} className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border", severityBadge[f.severity])}>
                {f.severity}
              </span>
              {f.cve && <span className="text-[9px] font-mono text-cyan-500">{f.cve}</span>}
            </div>
            <div className="text-[11px] text-sn-text leading-snug">{f.title}</div>
            <div className="text-[10px] text-sn-dim leading-relaxed line-clamp-3">{f.description}</div>
            {f.line_start && (
              <div className="text-[9px] text-sn-dim font-mono">
                Line {f.line_start}{f.line_end && f.line_end !== f.line_start ? `–${f.line_end}` : ""}
              </div>
            )}
            {f.ai_explanation && (
              <div className="mt-2 pt-2 border-t border-sn-border/50">
                <div className="text-[9px] text-violet-400 font-semibold uppercase tracking-wider mb-1">AI Analysis</div>
                <div className="text-[10px] text-sn-dim leading-relaxed line-clamp-4">{f.ai_explanation}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
interface Props {
  findings: Finding[];
}

export function CodeExplorer({ findings }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationsRef = useRef<string[]>([]);

  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [language, setLanguage] = useState("plaintext");

  // P2-11: tree is derived data — memoize so typing/selection doesn't rebuild it.
  const fileTree = useMemo(() => buildFileTree(findings), [findings]);

  // Inject custom CSS for glyph decorations once
  useEffect(() => {
    if (document.getElementById("sentinel-monaco-styles")) return;
    const style = document.createElement("style");
    style.id = "sentinel-monaco-styles";
    style.textContent = `
      .sentinelLineCritical { background: rgba(248,81,73,0.08) !important; }
      .sentinelLineHigh     { background: rgba(249,115,22,0.07) !important; }
      .sentinelLineMedium   { background: rgba(227,179,65,0.07) !important; }
      .sentinelLineLow      { background: rgba(88,166,255,0.07) !important; }
      .sentinelLineInfo     { background: rgba(125,133,144,0.05) !important; }
      .sentinel-glyph-critical::before { content: "●"; color: #f85149; font-size: 10px; }
      .sentinel-glyph-high::before     { content: "●"; color: #f97316; font-size: 10px; }
      .sentinel-glyph-medium::before   { content: "●"; color: #e3b341; font-size: 10px; }
      .sentinel-glyph-low::before      { content: "●"; color: #58a6ff; font-size: 10px; }
      .sentinel-glyph-info::before     { content: "●"; color: #7d8590; font-size: 10px; }
    `;
    document.head.appendChild(style);
  }, []);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme("sentinel-dark", SENTINEL_THEME);
    monaco.editor.setTheme("sentinel-dark");
  }, []);

  // Apply decorations when findings, selected file, or editor mount changes.
  // Clears on unmount / file switch so stale highlights don't linger.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !selectedFile) return;

    const fileFindngs = findings.filter(f => f.file_path === selectedFile.path);
    const newDecorations = buildDecorations(monaco, fileFindngs);
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    return () => {
      try { decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []); }
      catch { /* editor disposed */ }
    };
  }, [findings, selectedFile, handleEditorMount]);

  const handleFileSelect = (node: FileNode) => {
    if (node.isDir) return;
    setSelectedFile(node);

    // P2-11 honesty: workspaces are deleted post-scan — we only have snippets.
    // Never present this as full source; line numbers are finding anchors.
    const fileFindngs = findings.filter(f => f.file_path === node.path);
    if (fileFindngs.length > 0 && fileFindngs[0].code_snippet) {
      setFileContent(
        `# ${node.path}\n# Snippet view — full source not retained (workspace cleaned post-scan)\n# ⚠ ${fileFindngs.length} finding(s) detected by Sentinel\n\n${fileFindngs.map(f =>
          `# [${f.severity.toUpperCase()}] ${f.title}\n# Line ${f.line_start} — ${f.scanner}\n${f.code_snippet ?? ""}`
        ).join("\n\n")}`
      );
    } else {
      setFileContent(`# ${node.path}\n# Snippet view — full source not retained.\n# No code snippet available for this file.`);
    }

    const ext = node.name.split(".").pop() ?? "";
    const langMap: Record<string, string> = {
      py: "python", js: "javascript", ts: "typescript", tsx: "typescript",
      jsx: "javascript", go: "go", rs: "rust", java: "java", rb: "ruby",
      sh: "shell", yml: "yaml", yaml: "yaml", json: "json", toml: "toml",
      dockerfile: "dockerfile", tf: "hcl",
    };
    setLanguage(langMap[ext.toLowerCase()] ?? "plaintext");
    setShowAnnotations(fileFindngs.length > 0);
  };

  const currentFindings = selectedFile
    ? findings.filter(f => f.file_path === selectedFile?.path)
    : [];

  return (
    <div className="flex flex-col h-full bg-sn-bg rounded-xl border border-sn-border overflow-hidden">
      <div className="px-3 py-1.5 bg-amber-950/30 border-b border-amber-800/30 text-[10px] text-amber-400/90">
        Snippet view — full source not retained (workspaces are cleaned post-scan). Line numbers are finding anchors.
      </div>
    <div className="flex flex-1 min-h-0 bg-sn-bg overflow-hidden">
      {/* File Tree */}
      <div className="w-56 min-w-56 bg-sn-surface border-r border-sn-border flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-sn-border">
          <span className="text-[10px] text-sn-dim uppercase tracking-widest font-medium">
            File Explorer
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {Object.values(fileTree.children).length === 0 ? (
            <div className="px-4 py-6 text-[11px] text-sn-dim italic">No files with findings.</div>
          ) : (
            Object.values(fileTree.children)
              .sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)
              .map(c => (
                <FileTreeNode key={c.path} node={c} depth={0} onSelect={handleFileSelect} selectedPath={selectedFile?.path ?? null} />
              ))
          )}
        </div>
        {/* Finding count summary */}
        <div className="px-3 py-2 border-t border-sn-border bg-sn-bg/50">
          <div className="text-[9px] text-sn-dim">
            {findings.length} findings across {new Set(findings.map(f => f.file_path).filter(Boolean)).size} files
          </div>
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-sn-border bg-sn-surface px-2 h-9">
          {selectedFile ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-sn-bg border border-sn-border border-b-transparent rounded-t-md -mb-px">
              <FileCode size={11} className="text-sn-dim" />
              <span className="text-[11px] text-sn-text font-mono">{selectedFile.name}</span>
              {currentFindings.length > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              )}
            </div>
          ) : (
            <span className="px-3 text-[11px] text-sn-dim italic">Select a file</span>
          )}
          {currentFindings.length > 0 && (
            <button
              onClick={() => setShowAnnotations(s => !s)}
              className="ml-auto mr-2 flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-950/40 border border-amber-800/40 text-amber-400 text-[10px] hover:bg-amber-950/60 transition-colors"
            >
              <AlertTriangle size={11} />
              {currentFindings.length} issue{currentFindings.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>

        {/* Editor + annotation panel */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            {selectedFile ? (
              <Editor
                height="100%"
                language={language}
                value={fileContent}
                theme="sentinel-dark"
                onMount={handleEditorMount}
                options={{
                  readOnly: true,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontLigatures: true,
                  lineNumbers: "on",
                  glyphMargin: true,
                  folding: true,
                  minimap: { enabled: true, maxColumn: 80 },
                  scrollBeyondLastLine: false,
                  wordWrap: "off",
                  renderWhitespace: "none",
                  overviewRulerBorder: false,
                  hideCursorInOverviewRuler: true,
                  scrollbar: { vertical: "auto", horizontal: "auto" },
                  padding: { top: 12, bottom: 12 },
                }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-sn-dim gap-3">
                <FileCode size={40} className="opacity-20" />
                <div className="text-[12px] italic">Select a file from the explorer to view findings</div>
              </div>
            )}
          </div>

          {/* Annotation panel */}
          <AnimatePresence>
            {showAnnotations && currentFindings.length > 0 && (
              <AnnotationPanel findings={currentFindings} onClose={() => setShowAnnotations(false)} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  </div>
  );
}
