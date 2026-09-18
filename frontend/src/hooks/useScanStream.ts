"use client";
import { useEffect, useRef } from "react";
import { openScanStream, type WsEvent } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export function useScanStream(scanId: string | null, onTerminal?: (e: WsEvent) => void) {
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    if (!scanId) return;
    useAppStore.getState().clearStream();
    const ws = openScanStream(
      scanId,
      (e: WsEvent) => {
        const store = useAppStore.getState();
        store.appendStream(e);
        if (e.status === "completed" || e.status === "failed") {
          const { scans, setScans } = useAppStore.getState();
          setScans(
            scans.map((s) =>
              s.id === scanId ? { ...s, status: e.status, progress: e.progress } : s
            )
          );
          onTerminalRef.current?.(e);
        }
      },
      () => {}
    );
    return () => {
      ws.close();
    };
  }, [scanId]);
}
