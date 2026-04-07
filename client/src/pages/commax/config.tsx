import { Twitter, Instagram, Linkedin, Facebook, Youtube, Globe, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import { SiTiktok, SiThreads, SiPinterest } from "react-icons/si";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// ─── Platform config ──────────────────────────────────────────
export const PLATFORMS = [
  { id: "twitter", label: "Twitter / X", icon: Twitter, color: "text-sky-400", bg: "bg-sky-400/10", border: "border-sky-400/30" },
  { id: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-400", bg: "bg-pink-400/10", border: "border-pink-400/30" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/30" },
  { id: "facebook", label: "Facebook", icon: Facebook, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  { id: "tiktok", label: "TikTok", icon: SiTiktok, color: "text-white", bg: "bg-white/10", border: "border-white/20" },
  { id: "youtube", label: "YouTube", icon: Youtube, color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" },
  { id: "threads", label: "Threads", icon: SiThreads, color: "text-gray-300", bg: "bg-gray-300/10", border: "border-gray-300/20" },
  { id: "pinterest", label: "Pinterest", icon: SiPinterest, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30" },
];

export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Brouillon", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  scheduled: { label: "Planifié", color: "text-blue-400", bg: "bg-blue-400/10" },
  published: { label: "Publié", color: "text-green-400", bg: "bg-green-400/10" },
  failed: { label: "Échec", color: "text-red-400", bg: "bg-red-400/10" },
};

export const SENTIMENT_CONFIG: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  positive: { icon: ThumbsUp, color: "text-green-400", label: "Positif" },
  neutral: { icon: Minus, color: "text-gray-400", label: "Neutre" },
  negative: { icon: ThumbsDown, color: "text-red-400", label: "Négatif" },
};

export function getPlatformConfig(id: string) {
  return PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
}

export function PlatformBadge({ platform }: { platform: string }) {
  const cfg = getPlatformConfig(platform);
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", cfg.bg, cfg.color, cfg.border)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Stats Overview ───────────────────────────────────────────
