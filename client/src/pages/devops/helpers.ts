import { useState, useEffect } from "react";

export function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}j`;
  return `${Math.floor(days / 30)}mo`;
}

export function langColor(lang: string | null) {
  const colors: Record<string, string> = {
    TypeScript: "bg-blue-500",
    JavaScript: "bg-yellow-400",
    Python: "bg-green-500",
    Rust: "bg-orange-600",
    Go: "bg-cyan-500",
    Java: "bg-red-500",
    "C++": "bg-pink-500",
    CSS: "bg-purple-500",
    HTML: "bg-orange-400",
  };
  return lang ? colors[lang] || "bg-gray-400" : "bg-gray-400";
}

export function getRepoThreadKey(repoFullName: string) {
  return `devops_thread_${repoFullName.replace(/\//g, "_")}`;
}

export function getRepoThreads(repoFullName: string): number[] {
  try {
    const raw = localStorage.getItem(getRepoThreadKey(repoFullName));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRepoThread(repoFullName: string, threadId: number) {
  const threads = getRepoThreads(repoFullName);
  if (!threads.includes(threadId)) {
    threads.push(threadId);
    localStorage.setItem(
      getRepoThreadKey(repoFullName),
      JSON.stringify(threads),
    );
  }
}

export function setActiveRepoThread(repoFullName: string, threadId: number | null) {
  if (threadId) {
    localStorage.setItem(
      `devops_active_thread_${repoFullName.replace(/\//g, "_")}`,
      String(threadId),
    );
  }
}

export function getActiveRepoThread(repoFullName: string): number | null {
  const val = localStorage.getItem(
    `devops_active_thread_${repoFullName.replace(/\//g, "_")}`,
  );
  return val ? parseInt(val, 10) : null;
}

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function getLastVisitedRepo(): string | null {
  try {
    return localStorage.getItem("devops_last_repo");
  } catch {
    return null;
  }
}

export function setLastVisitedRepo(fullName: string) {
  try {
    localStorage.setItem("devops_last_repo", fullName);
  } catch {}
}

export function getLastActiveTab(): string {
  try {
    return localStorage.getItem("devops_last_tab") || "branches";
  } catch {
    return "branches";
  }
}

export function setLastActiveTab(tab: string) {
  try {
    localStorage.setItem("devops_last_tab", tab);
  } catch {}
}
