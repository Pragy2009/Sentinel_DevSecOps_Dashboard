"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DashboardStats, Repository, Scan, ScanDetail, User, WsEvent } from "./api";

interface AppState {
  user: User | null;
  repos: Repository[];
  scans: Scan[];
  activeScan: ScanDetail | null;
  stats: DashboardStats | null;
  streamLines: WsEvent[];
  setUser: (u: User | null) => void;
  setRepos: (r: Repository[]) => void;
  setScans: (s: Scan[]) => void;
  setActiveScan: (s: ScanDetail | null) => void;
  setStats: (s: DashboardStats) => void;
  appendStream: (e: WsEvent) => void;
  clearStream: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null, repos: [], scans: [], activeScan: null, stats: null, streamLines: [],
      setUser: (u) => set({ user: u }),
      setRepos: (r) => set({ repos: r }),
      setScans: (s) => set({ scans: s }),
      setActiveScan: (s) => set({ activeScan: s }),
      setStats: (s) => set({ stats: s }),
      appendStream: (e) => set((st) => ({ streamLines: [...st.streamLines.slice(-499), e] })),
      clearStream: () => set({ streamLines: [] }),
    }),
    { name: "sentinel-store", partialize: (s) => ({ user: s.user }) }
  )
);
