import axios, { AxiosError, type AxiosInstance } from "axios";

// ── Types ──────────────────────────────────────────────────────────────────────
export type ScanStatus = "queued" | "cloning" | "scanning" | "aggregating" | "ai_analysis" | "completed" | "failed";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingCategory = "sast" | "secret" | "dependency" | "container" | "misconfig";
export type FindingState = "open" | "resolved" | "suppressed";

export interface User { id: string; email: string; full_name: string | null; github_username: string | null; avatar_url: string | null; github_linked: boolean; created_at: string; }
export interface Repository { id: string; name: string; full_name: string; clone_url: string; default_branch: string; is_private: boolean; language: string | null; description: string | null; health_score: number; created_at: string; }
export interface Scan { id: string; repository_id: string; branch: string; commit_sha: string | null; status: ScanStatus; progress: number; scanners_run: Record<string, string> | null; error_message: string | null; total_findings: number; critical_count: number; high_count: number; medium_count: number; low_count: number; info_count: number; created_at: string; started_at: string | null; completed_at: string | null; }
export interface Finding { id: string; rule_id: string; title: string; description: string; category: FindingCategory; severity: Severity; scanner: string; cwe: string | null; cve: string | null; cvss_score: number | null; file_path: string | null; line_start: number | null; line_end: number | null; code_snippet: string | null; state: FindingState; ai_explanation: string | null; ai_impact: string | null; ai_exploitability: number | null; ai_patch_diff: string | null; created_at: string; }
export interface ScanDetail extends Scan { findings: Finding[]; }
export interface DashboardStats { total_scans: number; total_repositories: number; scanned_repos: number; severity_distribution: Record<Severity, number>; category_distribution: Record<FindingCategory, number>; avg_health_score: number; recent_scans: RecentScan[]; }
export interface RecentScan { id: string; repository_id: string; repository_name: string; status: ScanStatus; progress: number; total_findings: number; critical_count: number; high_count: number; medium_count: number; low_count: number; branch: string; created_at: string; completed_at: string | null; }
export interface ScanDiff { base_scan_id: string; head_scan_id: string; new_findings: Finding[]; resolved_findings: Finding[]; persisting_findings: Finding[]; }
export interface TokenPair { access_token: string; refresh_token: string; token_type: string; }
export interface WsEvent { scan_id: string; level: "info" | "success" | "warn" | "error"; message: string; progress: number; status: ScanStatus; ts: string; }

// ── Token storage ──────────────────────────────────────────────────────────────
const TOKEN_KEY = "sentinel_access_token";
const REFRESH_KEY = "sentinel_refresh_token";

export const tokenStore = {
  get: () => typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null,
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  getRefresh: () => typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null,
  setRefresh: (t: string) => localStorage.setItem(REFRESH_KEY, t),
  setTokenPair: (pair: TokenPair) => { localStorage.setItem(TOKEN_KEY, pair.access_token); localStorage.setItem(REFRESH_KEY, pair.refresh_token); },
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); },
};

// ── Axios instance ─────────────────────────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS_URL = (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000").replace(/^http/, "ws");

const http: AxiosInstance = axios.create({ baseURL: `${API_URL}/api/v1`, timeout: 30_000 });

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = false;
http.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    if (err.response?.status === 401 && !refreshing) {
      refreshing = true;
      const refresh = tokenStore.getRefresh();
      if (refresh) {
        try {
          const res = await axios.post(`${API_URL}/api/v1/auth/refresh`, { refresh_token: refresh });
          tokenStore.setTokenPair(res.data);
          if (err.config) {
            err.config.headers.Authorization = `Bearer ${res.data.access_token}`;
            refreshing = false;
            return http(err.config);
          }
        } catch { tokenStore.clear(); if (typeof window !== "undefined") window.location.href = "/"; }
      }
      refreshing = false;
    }
    return Promise.reject(err);
  }
);

// ── Auth ───────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (email: string, password: string, full_name?: string) =>
    http.post<TokenPair>("/auth/register", { email, password, full_name }).then(r => { tokenStore.setTokenPair(r.data); return r.data; }),
  login: (email: string, password: string) =>
    http.post<TokenPair>("/auth/login", { email, password }).then(r => { tokenStore.setTokenPair(r.data); return r.data; }),
  me: () => http.get<User>("/auth/me").then(r => r.data),
  // C5: server-side logout (refresh denylist) — fire-and-forget so the
  // sync call sites (useAuth/Sidebar) keep working even if backend is down.
  logout: () => {
    const refresh = tokenStore.getRefresh();
    if (refresh) {
      http.post("/auth/logout", { refresh_token: refresh }).catch(() => { /* offline — local clear still logs out */ });
    }
    tokenStore.clear();
  },
};

// ── GitHub OAuth ───────────────────────────────────────────────────────────────
export const githubApi = {
  getLoginUrl: () => http.get<{ authorize_url: string; state: string }>("/github/login").then(r => r.data),
  triggerLogin: async () => { const { authorize_url } = await githubApi.getLoginUrl(); window.location.href = authorize_url; },
  syncRepos: () => http.post<Repository[]>("/github/sync").then(r => r.data),
  listGithubRepos: () => http.get<Record<string, unknown>[]>("/github/repos").then(r => r.data),
  getBranches: (owner: string, repo: string) => http.get<string[]>(`/github/repos/${owner}/${repo}/branches`).then(r => r.data),
};

// ── Repositories ───────────────────────────────────────────────────────────────
export const repoApi = {
  list: () => http.get<Repository[]>("/repositories").then(r => r.data),
  delete: (id: string) => http.delete(`/repositories/${id}`),
};

// ── Scans ──────────────────────────────────────────────────────────────────────
export const scanApi = {
  create: (repository_id: string, branch: string) =>
    http.post<{ scan_id: string; status: ScanStatus; message: string }>("/scans", { repository_id, branch }).then(r => r.data),
  createByUrl: (clone_url: string, branch: string) =>
    http.post<{ scan_id: string; status: ScanStatus; message: string }>("/scans", { clone_url, branch }).then(r => r.data),
  list: () => http.get<Scan[]>("/scans").then(r => r.data),
  get: (id: string) => http.get<ScanDetail>(`/scans/${id}`).then(r => r.data),
  diff: (base: string, head: string) => http.get<ScanDiff>(`/scans/diff/${base}/${head}`).then(r => r.data),
  cancel: (id: string) => http.delete(`/scans/${id}`).then(r => r.data),
  remove: (id: string) => http.delete(`/scans/${id}?hard=true`).then(r => r.data),
};

// ── Dashboard ──────────────────────────────────────────────────────────────────
export const dashboardApi = {
  stats: () => http.get<DashboardStats>("/dashboard/stats").then(r => r.data),
};

// ── WebSocket ──────────────────────────────────────────────────────────────────
export const openScanStream = (scanId: string, onEvent: (e: WsEvent) => void, onClose?: () => void): WebSocket => {
  const token = tokenStore.get();
  const ws = new WebSocket(`${WS_URL}/api/v1/stream/scans/${scanId}${token ? `?token=${token}` : ""}`);
  ws.onmessage = (evt) => { try { onEvent(JSON.parse(evt.data)); } catch { /* skip malformed */ } };
  ws.onclose = () => onClose?.();
  ws.onerror = () => onClose?.();
  return ws;
};

// ── Reports ────────────────────────────────────────────────────────────────────
export type ReportFormat = "json" | "markdown" | "pdf";

export const reportApi = {
  download: async (scanId: string, format: ReportFormat): Promise<void> => {
    const token = tokenStore.get();
    const resp = await fetch(
      `${API_URL}/api/v1/reports/${scanId}?format=${format}`,
      { headers: { Authorization: `Bearer ${token ?? ""}` } }
    );
    if (!resp.ok) {
      const err = new Error(`Report download failed: ${resp.status}`) as Error & { status?: number };
      err.status = resp.status;
      throw err;
    }
    const blob = await resp.blob();
    const disposition = resp.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="(.+?)"/);
    const filename = match?.[1] ?? `sentinel-report.${format === "pdf" ? "pdf" : format === "json" ? "json" : "md"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
  downloadDiff: async (baseId: string, headId: string, format: "json" | "markdown"): Promise<void> => {
    const token = tokenStore.get();
    const resp = await fetch(
      `${API_URL}/api/v1/reports/diff/${baseId}/${headId}?format=${format}`,
      { headers: { Authorization: `Bearer ${token ?? ""}` } }
    );
    if (!resp.ok) throw new Error(`Diff report download failed: ${resp.status}`);
    const blob = await resp.blob();
    const disposition = resp.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="(.+?)"/);
    const filename = match?.[1] ?? `sentinel-diff.${format === "json" ? "json" : "md"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
};
