import { useState, useEffect, useCallback } from "react";

export interface DgmState {
  dgmActive: boolean;
  dgmSessionId: number | null;
  dgmObjective: string;
  dgmTasks: any[];
  dgmLoading: boolean;
  dgmPanelOpen: boolean;
  dgmAllSessions: any[];
  setDgmObjective: (v: string) => void;
  setDgmPanelOpen: (v: boolean) => void;
  toggleDgm: (activate: boolean) => Promise<void>;
}

export function useDgm(repoFullName: string | null): DgmState {
  const [dgmActive, setDgmActive] = useState(false);
  const [dgmSessionId, setDgmSessionId] = useState<number | null>(null);
  const [dgmObjective, setDgmObjective] = useState("");
  const [dgmTasks, setDgmTasks] = useState<any[]>([]);
  const [dgmLoading, setDgmLoading] = useState(false);
  const [dgmPanelOpen, setDgmPanelOpen] = useState(false);
  const [dgmAllSessions, setDgmAllSessions] = useState<any[]>([]);

  const fetchDgmForRepo = useCallback((repoName: string | null) => {
    if (!repoName) {
      setDgmActive(false);
      setDgmSessionId(null);
      setDgmObjective("");
      setDgmTasks([]);
      return;
    }
    fetch(`/api/ulysse-dev/dgm/status?repo=${encodeURIComponent(repoName)}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setDgmActive(data.active);
          if (data.session) {
            setDgmSessionId(data.session.id);
            setDgmObjective(data.session.objective || "");
          } else {
            setDgmSessionId(null);
            setDgmObjective("");
          }
          setDgmTasks(data.tasks || []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchDgmForRepo(repoFullName);
  }, [repoFullName, fetchDgmForRepo]);

  useEffect(() => {
    fetch("/api/ulysse-dev/dgm/status", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.sessions) {
          setDgmAllSessions(data.sessions);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dgmActive || !repoFullName) return;
    const interval = setInterval(() => {
      fetchDgmForRepo(repoFullName);
    }, 4000);
    return () => clearInterval(interval);
  }, [dgmActive, repoFullName, fetchDgmForRepo]);

  const toggleDgm = useCallback(async (activate: boolean) => {
    if (!repoFullName) return;
    setDgmLoading(true);
    try {
      const res = await fetch("/api/ulysse-dev/dgm/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          active: activate,
          objective: dgmObjective || undefined,
          repoContext: repoFullName,
        }),
      });
      const data = await res.json();
      setDgmActive(data.active);
      if (data.session) {
        setDgmSessionId(data.session.id);
        setDgmTasks([]);
      }
      if (!activate) {
        setDgmPanelOpen(false);
      }
      fetch("/api/ulysse-dev/dgm/status", { credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.sessions) setDgmAllSessions(d.sessions); })
        .catch(() => {});
    } catch (err: any) {
      console.error("[DGM] Toggle error:", err);
    }
    setDgmLoading(false);
  }, [repoFullName, dgmObjective]);

  return {
    dgmActive,
    dgmSessionId,
    dgmObjective,
    dgmTasks,
    dgmLoading,
    dgmPanelOpen,
    dgmAllSessions,
    setDgmObjective,
    setDgmPanelOpen,
    toggleDgm,
  };
}
