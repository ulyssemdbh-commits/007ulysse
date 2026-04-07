import { useState, useMemo, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, TrendingUp, TrendingDown, X, Maximize2, Minimize2, CalendarRange } from "lucide-react";
import { useSuguDark } from "./context";
import { normalizeCatKey } from "./types";

export type PeriodKey = "all" | "year" | "quarter" | "last_month" | "month" | "custom";

export interface PeriodDates {
  from: string;
  to: string;
  year: string;
  label: string;
  key: PeriodKey;
}

function pad2(n: number) { return n.toString().padStart(2, "0"); }

export function computePeriodDates(key: PeriodKey, customFrom?: string, customTo?: string): PeriodDates {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "all":
      return { from: "2024-01-01", to: `${y}-12-31`, year: `${y}`, label: "Depuis le début", key };
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31`, year: `${y}`, label: `Année ${y}`, key };
    case "quarter": {
      const qStartMonth = m - (m % 3);
      const qStart = new Date(y, qStartMonth, 1);
      const qEnd = new Date(y, qStartMonth + 3, 0);
      const qNum = Math.floor(m / 3) + 1;
      return { from: `${qStart.getFullYear()}-${pad2(qStart.getMonth() + 1)}-01`, to: `${qEnd.getFullYear()}-${pad2(qEnd.getMonth() + 1)}-${pad2(qEnd.getDate())}`, year: `${qStart.getFullYear()}`, label: `T${qNum} ${y}`, key };
    }
    case "last_month": {
      const lm = new Date(y, m - 1, 1);
      const lmEnd = new Date(y, m, 0);
      return { from: `${lm.getFullYear()}-${pad2(lm.getMonth() + 1)}-01`, to: `${lmEnd.getFullYear()}-${pad2(lmEnd.getMonth() + 1)}-${pad2(lmEnd.getDate())}`, year: `${lm.getFullYear()}`, label: new Date(lm).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), key };
    }
    case "month":
      return { from: `${y}-${pad2(m + 1)}-01`, to: `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`, year: `${y}`, label: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), key };
    case "custom":
      return { from: customFrom || `${y}-${pad2(m + 1)}-01`, to: customTo || `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`, year: (customFrom || `${y}`).slice(0, 4), label: "Personnalisé", key };
  }
}

export function usePeriodFilter(defaultKey: PeriodKey = "all") {
  const [periodKey, setPeriodKey] = useState<PeriodKey>(defaultKey);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const period = useMemo(() => computePeriodDates(periodKey, customFrom, customTo), [periodKey, customFrom, customTo]);
  const setPeriod = useCallback((k: PeriodKey) => setPeriodKey(k), []);
  return { period, periodKey, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo };
}

export function PeriodFilter({ periodKey, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }: {
  periodKey: PeriodKey;
  setPeriod: (k: PeriodKey) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
}) {
  const dk = useSuguDark();
  const tabs: { key: PeriodKey; label: string; icon?: boolean }[] = [
    { key: "all", label: "Tout" },
    { key: "year", label: "Année" },
    { key: "quarter", label: "Trimestre" },
    { key: "last_month", label: "Mois dernier" },
    { key: "month", label: "Mois en cours" },
    { key: "custom", label: "", icon: true },
  ];
  const active = (k: PeriodKey) => periodKey === k
    ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
    : dk ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="period-filter">
      {tabs.map(t => (
        <button
          key={t.key}
          data-testid={`btn-period-${t.key}`}
          onClick={() => setPeriod(t.key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active(t.key)}`}
        >
          {t.icon ? <CalendarRange className="w-3.5 h-3.5" /> : t.label}
        </button>
      ))}
      {periodKey === "custom" && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className={`px-2 py-1 rounded-lg border text-xs ${dk ? "bg-[#1e293b] border-white/10 text-white" : "bg-white border-slate-200 text-slate-800"}`} data-testid="input-period-from" />
          <span className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>→</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className={`px-2 py-1 rounded-lg border text-xs ${dk ? "bg-[#1e293b] border-white/10 text-white" : "bg-white border-slate-200 text-slate-800"}`} data-testid="input-period-to" />
        </div>
      )}
    </div>
  );
}

export const categoryLabels: Record<string, { label: string; color: string }> = {
    encaissement_cb: { label: "CB", color: "bg-green-500/20 text-green-400" },
    plateforme: { label: "Plateforme", color: "bg-blue-500/20 text-blue-400" },
    encaissement_especes: { label: "Espèces +", color: "bg-emerald-500/20 text-emerald-400" },
    encaissement_virement: { label: "Virement +", color: "bg-emerald-500/20 text-emerald-400" },
    virement_recu: { label: "Virement +", color: "bg-emerald-500/20 text-emerald-400" },
    achat_fournisseur: { label: "Fournisseur", color: "bg-orange-500/20 text-orange-400" },
    remboursement_fournisseur: { label: "Rembt Fourn.", color: "bg-lime-500/20 text-lime-400" },
    commission_plateforme: { label: "Com. Plateforme", color: "bg-rose-500/20 text-rose-400" },
    loyer: { label: "Loyer", color: "bg-purple-500/20 text-purple-400" },
    salaire: { label: "Salaire", color: "bg-pink-500/20 text-pink-400" },
    virement_interne: { label: "Vir. interne", color: "bg-slate-500/20 text-slate-400" },
    virement_emis: { label: "Virement -", color: "bg-red-500/20 text-red-400" },
    frais_bancaires: { label: "Frais banque", color: "bg-yellow-500/20 text-yellow-400" },
    assurance: { label: "Assurance", color: "bg-cyan-500/20 text-cyan-400" },
    emprunt: { label: "Emprunt", color: "bg-violet-500/20 text-violet-400" },
    leasing: { label: "Leasing", color: "bg-violet-500/20 text-violet-400" },
    energie: { label: "Énergie", color: "bg-amber-500/20 text-amber-400" },
    carburant: { label: "Carburant", color: "bg-amber-500/20 text-amber-400" },
    telecom: { label: "Télécom", color: "bg-sky-500/20 text-sky-400" },
    charges_sociales: { label: "Charges", color: "bg-rose-500/20 text-rose-400" },
    vehicule: { label: "Véhicule", color: "bg-lime-500/20 text-lime-400" },
    equipement: { label: "Équipement", color: "bg-teal-500/20 text-teal-400" },
    prelevement: { label: "Prélèvement", color: "bg-stone-500/20 text-stone-400" },
    credit_divers: { label: "Divers +", color: "bg-gray-500/20 text-gray-400" },
    debit_divers: { label: "Divers -", color: "bg-gray-500/20 text-gray-400" },
    divers: { label: "Divers", color: "bg-gray-500/20 text-gray-400" },
    alimentaire: { label: "Alimentaire", color: "bg-orange-500/20 text-orange-400" },
    boissons: { label: "Boissons", color: "bg-blue-500/20 text-blue-400" },
    emballages: { label: "Emballages", color: "bg-yellow-500/20 text-yellow-400" },
    entretien: { label: "Entretien", color: "bg-cyan-500/20 text-cyan-400" },
    produits_entretien: { label: "Entretien", color: "bg-cyan-500/20 text-cyan-400" },
    comptabilite: { label: "Comptabilité", color: "bg-indigo-500/20 text-indigo-400" },
    assurances: { label: "Assurances", color: "bg-cyan-500/20 text-cyan-400" },
    vehicules: { label: "Véhicules", color: "bg-lime-500/20 text-lime-400" },
    plateformes: { label: "Plateformes", color: "bg-blue-500/20 text-blue-400" },
    materiels: { label: "Matériels", color: "bg-teal-500/20 text-teal-400" },
    eau: { label: "Eau", color: "bg-sky-500/20 text-sky-400" },
    travaux: { label: "Travaux", color: "bg-red-500/20 text-red-400" },
    autre: { label: "Autre", color: "bg-gray-500/20 text-gray-400" },
    loyer_fg: { label: "Loyer", color: "bg-purple-500/20 text-purple-400" },
};
export function CategoryBadge({ cat }: { cat?: string | null }) {
    const dk = useSuguDark();
    if (!cat) return <span className={`${dk ? "text-white/30" : "text-slate-300"} text-xs`}>—</span>;
    const key = normalizeCatKey(cat);
    const info = categoryLabels[key] || { label: cat, color: `${dk ? "bg-white/10" : "bg-slate-100"} ${dk ? "text-white/60" : "text-slate-600"}` };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${info.color}`}>{info.label}</span>;
}

export const inputClass = "w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50";
export const selectClass = inputClass;
export const btnPrimary = "bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition flex items-center gap-2";
export const btnDanger = "bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg text-xs hover:bg-red-500/30 transition";

export function Card({ title, icon: Icon, children, action, cardId, defaultCollapsed }: { title: string; icon: any; children: React.ReactNode; action?: React.ReactNode; cardId?: string; defaultCollapsed?: boolean }) {
    const dk = useSuguDark();
    const storageKey = useMemo(() => {
        const raw = cardId || title;
        return raw ? `sugu-card-${raw.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
    }, [cardId, title]);

    const [collapsed, setCollapsed] = useState(() => {
        if (!storageKey || typeof window === "undefined") return defaultCollapsed ?? false;
        const saved = localStorage.getItem(storageKey);
        if (saved === "collapsed") return true;
        if (saved === "expanded") return false;
        return defaultCollapsed ?? false;
    });

    useEffect(() => {
        if (!storageKey || typeof window === "undefined") return;
        localStorage.setItem(storageKey, collapsed ? "collapsed" : "expanded");
    }, [collapsed, storageKey]);

    return (
        <div className={dk ? "bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm" : "bg-white border border-slate-200 rounded-2xl shadow-sm"}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 text-orange-500" />
                    <h2 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{title}</h2>
                </div>
                <div className="flex items-center gap-2">
                    {action}
                    <button
                        onClick={() => setCollapsed(v => !v)}
                        className={`p-2 rounded-lg transition ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`}
                        title={collapsed ? "Agrandir la carte" : "Réduire la carte"}
                        aria-label={collapsed ? "Agrandir la carte" : "Réduire la carte"}
                    >
                        {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                </div>
            </div>
            {!collapsed && <div className="p-5">{children}</div>}
        </div>
    );
}

export function StatCard({ label, value, icon: Icon, trendData, color = "orange", compact, warning }: { label: string; value: string; icon: any; trendData?: { pct: string, favorable: boolean, dir: "up" | "down" } | null; color?: string; compact?: boolean; warning?: string }) {
    const dk = useSuguDark();
    const darkMap: Record<string, string> = {
        orange: "from-orange-500/20 to-orange-600/10 border-orange-500/20",
        green: "from-green-500/20 to-green-600/10 border-green-500/20",
        red: "from-red-500/20 to-red-600/10 border-red-500/20",
        blue: "from-blue-500/20 to-blue-600/10 border-blue-500/20",
        purple: "from-purple-500/20 to-purple-600/10 border-purple-500/20",
    };
    const lightMap: Record<string, string> = {
        orange: "from-orange-50 to-orange-100/60 border-orange-200",
        green: "from-green-50 to-green-100/60 border-green-200",
        red: "from-red-50 to-red-100/60 border-red-200",
        blue: "from-blue-50 to-blue-100/60 border-blue-200",
        purple: "from-purple-50 to-purple-100/60 border-purple-200",
    };
    const iconDkMap: Record<string, string> = { orange: "text-orange-400", green: "text-green-400", red: "text-red-400", blue: "text-blue-400", purple: "text-purple-400" };
    const iconLtMap: Record<string, string> = { orange: "text-orange-500", green: "text-green-600", red: "text-red-500", blue: "text-blue-500", purple: "text-purple-500" };

    const TrendBadge = ({ trend }: { trend: { pct: string, favorable: boolean, dir: "up" | "down" } }) => (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${trend.favorable ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
            {trend.dir === "up" ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {trend.pct}%
        </span>
    );

    if (compact) {
        return (
            <div className={`bg-gradient-to-br ${dk ? darkMap[color] : lightMap[color]} border rounded-lg px-3 py-2 flex items-center gap-2`} title={warning || undefined}>
                <Icon className={`w-4 h-4 flex-shrink-0 ${dk ? (iconDkMap[color] || "text-white/60") : (iconLtMap[color] || "text-slate-500")}`} />
                <div className="flex flex-col min-w-0">
                    <p className={`text-sm font-bold ${dk ? "text-white" : "text-slate-800"} truncate`}>{value}</p>
                    <p className={`text-[9px] ${dk ? "text-white/50" : "text-slate-500"} truncate`}>{label}</p>
                </div>
                {warning && <span className="ml-auto text-amber-400 text-xs flex-shrink-0" title={warning}>⚠</span>}
                {!warning && trendData && <div className="ml-auto flex-shrink-0"><TrendBadge trend={trendData} /></div>}
            </div>
        );
    }

    return (
        <div className={`bg-gradient-to-br ${dk ? darkMap[color] : lightMap[color]} border rounded-lg px-3 py-2`}>
            <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 flex-shrink-0 ${dk ? (iconDkMap[color] || "text-white/60") : (iconLtMap[color] || "text-slate-500")}`} />
                <p className={`text-sm font-bold ${dk ? "text-white" : "text-slate-800"} truncate flex-1`}>{value}</p>
                <div className="flex items-center gap-1 flex-shrink-0">
                    {warning && <span className="text-amber-400 text-xs" title={warning}>⚠</span>}
                    {trendData && <TrendBadge trend={trendData} />}
                </div>
            </div>
            <p className={`text-[10px] mt-0.5 ${dk ? "text-white/50" : "text-slate-500"} truncate`}>{label}</p>
        </div>
    );
}

export function FormModal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
    const dk = useSuguDark();
    if (!open) return null;
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={onClose}>
            <div className={`${dk ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"} border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
                <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                    <h3 className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{title}</h3>
                    <button onClick={onClose} className={`p-1 rounded-lg ${dk ? "hover:bg-white/10" : "hover:bg-slate-100"}`} title="Fermer"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">{children}</div>
            </div>
        </div>
    );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
    const dk = useSuguDark();
    return (
        <label className="block">
            <span className={`block text-sm mb-1 ${dk ? "text-white/60" : "text-slate-600"}`}>{label}</span>
            {children}
        </label>
    );
}

export function useInputClass() {
    const dk = useSuguDark();
    return dk
        ? "w-full bg-[#1e293b] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
        : "w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30";
}

export function FormSelect({ className, ...props }: JSX.IntrinsicElements["select"]) {
    const dk = useSuguDark();
    return <select className={className} style={{ colorScheme: dk ? "dark" : "light" }} {...props} />;
}

export function CardSizeToggle({ compact, setCompact }: { compact: boolean; setCompact: (v: boolean) => void }) {
    const dk = useSuguDark();
    return (
        <button
            onClick={() => setCompact(!compact)}
            className={`p-1.5 rounded-lg transition ${dk ? "hover:bg-white/10 text-white/50 hover:text-white/80" : "hover:bg-slate-200 text-slate-400 hover:text-slate-600"}`}
            title={compact ? "Agrandir les cartes" : "Réduire les cartes"}
            data-testid="button-toggle-card-size"
        >
            {compact ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
        </button>
    );
}
