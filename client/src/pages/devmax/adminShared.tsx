import { Loader2 } from "lucide-react";

export const API = "/api/devmax";
export const ADMIN_TOKEN_KEY = "devmax_admin_token";

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export async function adminFetch(url: string, opts: RequestInit = {}) {
  const token = getAdminToken();
  return fetch(url, {
    ...opts,
    headers: { ...opts.headers as any, "x-devmax-admin": token || "", "Content-Type": "application/json" },
  });
}

export function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function Spinner() {
  return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
}

export const PLAN_COLORS: Record<string, string> = {
  free: "border-gray-500/50 text-gray-400",
  starter: "border-blue-500/50 text-blue-400",
  pro: "border-purple-500/50 text-purple-400",
  enterprise: "border-amber-500/50 text-amber-400",
};

export const PLAN_LABELS: Record<string, string> = {
  free: "Free", starter: "Starter", pro: "Pro", enterprise: "Enterprise"
};

export const CATEGORY_COLORS: Record<string, string> = {
  communication: "text-blue-400", productivity: "text-green-400", media: "text-pink-400",
  development: "text-gray-300", storage: "text-cyan-400", payment: "text-yellow-400",
  ai: "text-purple-400", deployment: "text-orange-400", database: "text-emerald-400",
  custom: "text-gray-400",
};

export const CATEGORY_LABELS: Record<string, string> = {
  communication: "Communication", productivity: "Productivité", media: "Média",
  development: "Développement", storage: "Stockage", payment: "Paiement",
  ai: "Intelligence Artificielle", deployment: "Déploiement", database: "Base de données",
  custom: "Personnalisé",
};

export const STATUS_STYLES: Record<string, { border: string; text: string; label: string }> = {
  connected: { border: "border-emerald-500/50", text: "text-emerald-400", label: "Connecté" },
  disconnected: { border: "border-gray-500/50", text: "text-gray-400", label: "Déconnecté" },
  error: { border: "border-red-500/50", text: "text-red-400", label: "Erreur" },
};
