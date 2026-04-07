import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Link2, Unlink, RefreshCw, ShoppingBag, Package, TrendingUp, MapPin, Utensils, ExternalLink, ChevronUp, ChevronDown, Eye, X, User, Clock, CreditCard, Hash } from "lucide-react";
import { useSuguDark } from "./context";
import { Card, StatCard, PeriodFilter, usePeriodFilter } from "./shared";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { fmt } from "./types";

interface HubriseStatus {
    connected: boolean;
    account_id: string | null;
    location_id: string | null;
    catalog_id: string | null;
    clientConfigured: boolean;
}

interface OrdersSummary {
    totalOrders: number;
    totalRevenue: number;
    avgTicket: number;
    byDay: Record<string, { orders: number; revenue: number }>;
    byServiceType: Record<string, { orders: number; revenue: number }>;
    byPaymentType: Record<string, number>;
}

interface CatalogData {
    categories: any[];
    products: { id: string; name: string; description?: string; ref?: string; skus?: { name: string; ref?: string; price: string }[] }[];
}

export function HubriseTab() {
    const dk = useSuguDark();
    const qc = useQueryClient();
    const { toast } = useToast();
    const pf = usePeriodFilter("all");
    const [activeView, setActiveView] = useState<"overview" | "orders" | "catalog">("overview");

    const { data: status, isLoading: statusLoading } = useQuery<HubriseStatus>({
        queryKey: ["/api/v2/sugu-management/hubrise/status"],
        queryFn: async () => { const r = await fetch("/api/v2/sugu-management/hubrise/status", { credentials: "include" }); return r.json(); },
    });

    const { data: summary, isLoading: summaryLoading } = useQuery<OrdersSummary>({
        queryKey: ["/api/v2/sugu-management/hubrise/orders/summary", pf.period.from, pf.period.to],
        queryFn: async () => {
            const r = await fetch(`/api/v2/sugu-management/hubrise/orders/summary?from=${pf.period.from}&to=${pf.period.to}`, { credentials: "include" });
            if (!r.ok) throw new Error("HubRise summary error");
            const data = await r.json();
            if (data.error) throw new Error(data.error);
            return data;
        },
        enabled: !!status?.connected,
        retry: false,
    });

    const { data: catalog, isLoading: catalogLoading } = useQuery<CatalogData>({
        queryKey: ["/api/v2/sugu-management/hubrise/catalog"],
        queryFn: async () => { const r = await fetch("/api/v2/sugu-management/hubrise/catalog", { credentials: "include" }); return r.json(); },
        enabled: !!status?.connected && activeView === "catalog",
    });

    const { data: location } = useQuery<any>({
        queryKey: ["/api/v2/sugu-management/hubrise/location"],
        queryFn: async () => { const r = await fetch("/api/v2/sugu-management/hubrise/location", { credentials: "include" }); return r.json(); },
        enabled: !!status?.connected,
    });

    const connectMut = useMutation({
        mutationFn: async () => {
            const r = await fetch("/api/v2/sugu-management/hubrise/authorize", { credentials: "include" });
            const { url } = await r.json();
            window.open(url, "_blank", "width=600,height=700");
        },
    });

    const disconnectMut = useMutation({
        mutationFn: () => apiRequest("POST", "/api/v2/sugu-management/hubrise/disconnect"),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/hubrise"] });
            toast({ title: "HubRise déconnecté" });
        },
    });

    if (statusLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

    if (!status?.connected) {
        return (
            <div className="space-y-6">
                <Card title="HubRise" icon={Link2}>
                    <div className="text-center py-10 space-y-4">
                        <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center ${dk ? "bg-orange-500/20" : "bg-orange-100"}`}>
                            <Link2 className="w-8 h-8 text-orange-500" />
                        </div>
                        <h3 className={`text-lg font-semibold ${dk ? "text-white" : "text-slate-800"}`}>Connecter HubRise</h3>
                        <p className={`text-sm max-w-md mx-auto ${dk ? "text-white/60" : "text-slate-500"}`}>
                            Connectez votre compte HubRise pour synchroniser automatiquement les commandes, le catalogue produits et l'historique des ventes.
                        </p>
                        {!status?.clientConfigured && (
                            <p className="text-xs text-red-400">Client ID ou Secret manquant. Vérifiez les variables d'environnement HUBRISE_CLIENT_ID et HUBRISE_API_KEY.</p>
                        )}
                        <button
                            onClick={() => connectMut.mutate()}
                            disabled={connectMut.isPending || !status?.clientConfigured}
                            className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2 mx-auto"
                            data-testid="btn-hubrise-connect"
                        >
                            {connectMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                            Autoriser HubRise
                        </button>
                    </div>
                </Card>
            </div>
        );
    }

    const viewBtn = (v: "overview" | "orders" | "catalog", label: string) => (
        <button
            onClick={() => setActiveView(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeView === v
                ? "bg-orange-500 text-white shadow-lg shadow-orange-500/25"
                : dk ? "bg-white/5 text-white/60 hover:bg-white/10" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
            data-testid={`btn-hubrise-view-${v}`}
        >{label}</button>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    {viewBtn("overview", "Vue d'ensemble")}
                    {viewBtn("orders", "Commandes")}
                    {viewBtn("catalog", "Catalogue")}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async () => {
                            try {
                                await fetch("/api/v2/sugu-management/hubrise/sync", { method: "POST", credentials: "include" });
                            } catch {}
                            qc.invalidateQueries({ queryKey: ["/api/v2/sugu-management/hubrise"] });
                        }}
                        className={`p-2 rounded-lg transition ${dk ? "hover:bg-white/10 text-white/50" : "hover:bg-slate-200 text-slate-400"}`}
                        title="Synchroniser les dernières commandes"
                        data-testid="btn-hubrise-refresh"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => { if (confirm("Déconnecter HubRise ?")) disconnectMut.mutate(); }}
                        className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition"
                        data-testid="btn-hubrise-disconnect"
                    >
                        <Unlink className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            <PeriodFilter {...pf} />

            {activeView === "overview" && (
                <OverviewSection dk={dk} summary={summary} summaryLoading={summaryLoading} location={location} status={status} pf={pf} />
            )}

            {activeView === "orders" && (
                <OrdersSection dk={dk} pf={pf} />
            )}

            {activeView === "catalog" && (
                <CatalogSection dk={dk} catalog={catalog} catalogLoading={catalogLoading} />
            )}
        </div>
    );
}

function OverviewSection({ dk, summary, summaryLoading, location, status, pf }: { dk: boolean; summary?: OrdersSummary; summaryLoading: boolean; location?: any; status: HubriseStatus; pf: any }) {
    const [selectedDay, setSelectedDay] = useState<string | null>(null);

    const { data: orders = [] } = useQuery<any[]>({
        queryKey: ["/api/v2/sugu-management/hubrise/orders", pf.period.from, pf.period.to],
        queryFn: async () => {
            const r = await fetch(`/api/v2/sugu-management/hubrise/orders?after=${pf.period.from}T00:00:00%2B00:00&before=${pf.period.to}T23:59:59%2B00:00`, { credentials: "include" });
            if (!r.ok) throw new Error("HubRise orders error");
            const data = await r.json();
            if (!Array.isArray(data)) throw new Error(data?.error || "Invalid response");
            return data;
        },
        retry: false,
    });

    const originLabel = (o: any) => {
        const ch = o.channel || o.custom_fields?.channel || "";
        if (ch) return ch;
        const ref = o.service_type_ref || "";
        if (ref.toLowerCase().includes("uber")) return "Uber Eats Bridge";
        if (ref.toLowerCase().includes("deliveroo")) return "Deliveroo Bridge";
        if (ref.toLowerCase().includes("zenorder")) return "ZENORDER";
        return o.service_type === "delivery" ? "Livraison" : o.service_type === "collection" ? "Emporter" : o.service_type || "-";
    };

    const dayOriginBreakdown = (day: string) => {
        const dayOrders = orders.filter(o => o.created_at?.startsWith(day));
        const byOrigin: Record<string, { orders: number; revenue: number }> = {};
        dayOrders.forEach(o => {
            const orig = originLabel(o);
            if (!byOrigin[orig]) byOrigin[orig] = { orders: 0, revenue: 0 };
            byOrigin[orig].orders++;
            byOrigin[orig].revenue += parseFloat(o.total || "0");
        });
        Object.values(byOrigin).forEach(v => { v.revenue = Math.round(v.revenue * 100) / 100; });
        const totalRev = Math.round(dayOrders.reduce((s, o) => s + parseFloat(o.total || "0"), 0) * 100) / 100;
        return { byOrigin, total: dayOrders.length, totalRevenue: totalRev };
    };

    return (
        <div className="space-y-6">
            {location && (
                <Card title="Établissement" icon={MapPin}>
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${dk ? "bg-orange-500/20" : "bg-orange-100"}`}>
                            <Utensils className="w-6 h-6 text-orange-500" />
                        </div>
                        <div>
                            <p className={`font-semibold ${dk ? "text-white" : "text-slate-800"}`} data-testid="text-hubrise-location-name">{location.name || "Restaurant"}</p>
                            <p className={`text-sm ${dk ? "text-white/50" : "text-slate-500"}`}>{location.address_1} {location.city} {location.postal_code}</p>
                            <p className={`text-xs ${dk ? "text-white/30" : "text-slate-400"}`}>Account: {status.account_id} | Location: {status.location_id}</p>
                        </div>
                    </div>
                </Card>
            )}

            {summaryLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
            ) : summary ? (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard label="Commandes" value={summary.totalOrders.toString()} icon={ShoppingBag} color="blue" />
                        <StatCard label="CA HubRise" value={fmt(summary.totalRevenue)} icon={TrendingUp} color="green" />
                        <StatCard label="Ticket moyen" value={fmt(summary.avgTicket)} icon={Package} color="orange" />
                        <StatCard label="Jours actifs" value={Object.keys(summary.byDay).length.toString()} icon={TrendingUp} color="purple" />
                    </div>

                    {Object.keys(summary.byServiceType).length > 0 && (
                        <Card title="Par type de service" icon={Utensils}>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {Object.entries(summary.byServiceType).map(([type, data]) => (
                                    <div key={type} className={`p-3 rounded-xl ${dk ? "bg-white/5 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
                                        <p className={`text-xs font-medium ${dk ? "text-white/60" : "text-slate-500"}`}>{type === "delivery" ? "Livraison" : type === "collection" ? "À emporter" : type === "eat_in" ? "Sur place" : type}</p>
                                        <p className={`text-lg font-bold ${dk ? "text-white" : "text-slate-800"}`} data-testid={`text-hubrise-svc-${type}`}>{fmt(data.revenue)}</p>
                                        <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{data.orders} commandes</p>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}

                    {Object.keys(summary.byPaymentType).length > 0 && (
                        <Card title="Par mode de paiement" icon={TrendingUp}>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {Object.entries(summary.byPaymentType).map(([type, amount]) => (
                                    <div key={type} className={`p-3 rounded-xl ${dk ? "bg-white/5 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
                                        <p className={`text-xs font-medium ${dk ? "text-white/60" : "text-slate-500"}`}>{type === "cash" ? "Espèces" : type === "online" ? "En ligne" : type === "card" ? "Carte" : type}</p>
                                        <p className={`text-lg font-bold ${dk ? "text-white" : "text-slate-800"}`}>{fmt(amount)}</p>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}

                    {Object.keys(summary.byDay).length > 0 && (
                        <Card title="Historique journalier" icon={TrendingUp} defaultCollapsed>
                            <div className="space-y-1 max-h-[400px] overflow-y-auto">
                                <div className={`grid grid-cols-[1fr_70px_80px_70px_36px] text-xs font-medium px-3 py-2 ${dk ? "text-white/50" : "text-slate-500"}`}>
                                    <span>Date</span><span className="text-right">Commandes</span><span className="text-right">CA</span><span className="text-right">Ticket</span><span></span>
                                </div>
                                {Object.entries(summary.byDay).sort(([a], [b]) => b.localeCompare(a)).map(([day, data]) => (
                                    <div key={day} className={`grid grid-cols-[1fr_70px_80px_70px_36px] text-sm px-3 py-2 rounded-lg ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"} transition`}>
                                        <span className={dk ? "text-white/80" : "text-slate-700"}>{new Date(day).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</span>
                                        <span className={`text-right ${dk ? "text-white/60" : "text-slate-600"}`}>{data.orders}</span>
                                        <span className={`text-right font-medium ${dk ? "text-white" : "text-slate-800"}`}>{fmt(data.revenue)}</span>
                                        <span className={`text-right ${dk ? "text-white/50" : "text-slate-500"}`}>{data.orders > 0 ? fmt(data.revenue / data.orders) : "-"}</span>
                                        <button
                                            onClick={() => setSelectedDay(day)}
                                            className={`p-1 rounded-lg transition ${dk ? "text-white/30 hover:text-white/70" : "text-slate-300 hover:text-slate-600"}`}
                                            data-testid={`btn-day-detail-${day}`}
                                            title="CA par origine"
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </>
            ) : (
                <p className={`text-center py-10 ${dk ? "text-white/40" : "text-slate-400"}`}>Aucune donnée disponible pour cette période</p>
            )}

            {selectedDay && (() => {
                const bd = dayOriginBreakdown(selectedDay);
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSelectedDay(null)}>
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
                        <div
                            className={`relative w-full max-w-md rounded-2xl shadow-2xl ${dk ? "bg-[#1a1a2e] border border-white/10" : "bg-white border border-slate-200"}`}
                            onClick={(e) => e.stopPropagation()}
                            data-testid="popup-day-origin-detail"
                        >
                            <div className={`flex items-center justify-between px-5 py-4 border-b ${dk ? "border-white/10" : "border-slate-200"}`}>
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-orange-500" />
                                    <h3 className={`text-base font-bold ${dk ? "text-white" : "text-slate-900"}`}>
                                        CA par origine — {new Date(selectedDay).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
                                    </h3>
                                </div>
                                <button onClick={() => setSelectedDay(null)} className={`p-1.5 rounded-xl transition ${dk ? "text-white/40 hover:text-white/80 hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`} data-testid="btn-close-day-detail">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-5 space-y-4">
                                <div className={`rounded-xl p-4 text-center ${dk ? "bg-white/5 border border-white/10" : "bg-orange-50 border border-orange-100"}`}>
                                    <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>CA total du jour</p>
                                    <p className="text-2xl font-bold text-orange-500">{fmt(bd.totalRevenue)}</p>
                                    <p className={`text-xs mt-1 ${dk ? "text-white/40" : "text-slate-400"}`}>{bd.total} commande{bd.total > 1 ? "s" : ""}</p>
                                </div>

                                {Object.keys(bd.byOrigin).length > 0 ? (
                                    <div className={`rounded-xl overflow-hidden border ${dk ? "border-white/10" : "border-slate-200"}`}>
                                        <div className={`grid grid-cols-[1fr_60px_80px_70px] text-xs font-medium px-3 py-2 ${dk ? "bg-white/5 text-white/50" : "bg-slate-50 text-slate-500"}`}>
                                            <span>Origine</span><span className="text-center">Cmd</span><span className="text-right">CA</span><span className="text-right">%</span>
                                        </div>
                                        {Object.entries(bd.byOrigin).sort(([, a], [, b]) => b.revenue - a.revenue).map(([origin, data]) => (
                                            <div key={origin} className={`grid grid-cols-[1fr_60px_80px_70px] text-sm px-3 py-2.5 ${dk ? "border-t border-white/5" : "border-t border-slate-100"}`}>
                                                <span className={`font-medium ${dk ? "text-white/90" : "text-slate-800"}`}>{origin}</span>
                                                <span className={`text-center ${dk ? "text-white/60" : "text-slate-600"}`}>{data.orders}</span>
                                                <span className={`text-right font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{fmt(data.revenue)}</span>
                                                <span className={`text-right ${dk ? "text-white/50" : "text-slate-500"}`}>{bd.totalRevenue > 0 ? `${Math.round(data.revenue / bd.totalRevenue * 100)}%` : "-"}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className={`text-center py-4 text-sm ${dk ? "text-white/40" : "text-slate-400"}`}>Aucune donnée d'origine disponible</p>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

type OrderSortCol = "date" | "client" | "montant" | "statut" | "origine";

function OrdersSection({ dk, pf }: { dk: boolean; pf: any }) {
    const [sortCol, setSortCol] = useState<OrderSortCol>("date");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [selectedOrder, setSelectedOrder] = useState<any>(null);

    const { data: orders = [], isLoading } = useQuery<any[]>({
        queryKey: ["/api/v2/sugu-management/hubrise/orders", pf.period.from, pf.period.to],
        queryFn: async () => {
            const r = await fetch(`/api/v2/sugu-management/hubrise/orders?after=${pf.period.from}T00:00:00%2B00:00&before=${pf.period.to}T23:59:59%2B00:00`, { credentials: "include" });
            if (!r.ok) throw new Error("HubRise orders error");
            const data = await r.json();
            if (!Array.isArray(data)) throw new Error(data?.error || "Invalid response");
            return data;
        },
        retry: false,
    });

    const clientName = (o: any) => {
        const c = o.customer;
        if (!c) return "-";
        const parts = [c.first_name, c.last_name?.charAt(0) ? c.last_name.charAt(0) + "." : ""].filter(Boolean);
        return parts.join(" ") || "-";
    };

    const originLabel = (o: any) => {
        const ch = o.channel || o.custom_fields?.channel || "";
        if (ch) return ch;
        const ref = o.service_type_ref || "";
        if (ref.toLowerCase().includes("uber")) return "Uber Eats Bridge";
        if (ref.toLowerCase().includes("deliveroo")) return "Deliveroo Bridge";
        if (ref.toLowerCase().includes("zenorder")) return "ZENORDER";
        return o.service_type === "delivery" ? "Livraison" : o.service_type === "collection" ? "Emporter" : o.service_type || "-";
    };

    const statusLabel = (s: string) => {
        const map: Record<string, string> = { completed: "Completed", accepted: "Accepted", new: "New", received: "Received", rejected: "Rejected", cancelled: "Cancelled", delivery_failed: "Échec livraison" };
        return map[s] || s;
    };

    const toggleSort = (col: OrderSortCol) => {
        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortCol(col); setSortDir(col === "montant" ? "desc" : "asc"); }
    };

    const SortIcon = ({ col }: { col: OrderSortCol }) => {
        if (sortCol !== col) return <ChevronDown className="w-3 h-3 opacity-20 inline ml-0.5" />;
        return sortDir === "asc"
            ? <ChevronUp className="w-3 h-3 text-orange-500 inline ml-0.5" />
            : <ChevronDown className="w-3 h-3 text-orange-500 inline ml-0.5" />;
    };

    const sorted = [...orders].sort((a, b) => {
        const m = sortDir === "asc" ? 1 : -1;
        switch (sortCol) {
            case "date": return m * ((a.created_at || "").localeCompare(b.created_at || ""));
            case "client": return m * (clientName(a).localeCompare(clientName(b)));
            case "montant": return m * (parseFloat(a.total || "0") - parseFloat(b.total || "0"));
            case "statut": return m * ((a.status || "").localeCompare(b.status || ""));
            case "origine": return m * (originLabel(a).localeCompare(originLabel(b)));
            default: return 0;
        }
    });

    if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>;

    const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total || "0"), 0);

    const thCls = `cursor-pointer select-none hover:text-orange-500 transition-colors flex items-center gap-0.5`;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard label="Commandes" value={orders.length.toString()} icon={ShoppingBag} color="blue" />
                <StatCard label="CA total" value={fmt(totalRevenue)} icon={TrendingUp} color="green" />
                <StatCard label="Ticket moyen" value={orders.length > 0 ? fmt(totalRevenue / orders.length) : "0 €"} icon={Package} color="orange" />
            </div>
            <Card title={`Commandes (${orders.length})`} icon={ShoppingBag}>
                {orders.length === 0 ? (
                    <p className={`text-center py-6 ${dk ? "text-white/40" : "text-slate-400"}`}>Aucune commande pour cette période</p>
                ) : (
                    <div className="space-y-1 max-h-[600px] overflow-y-auto">
                        <div className={`grid grid-cols-[80px_1fr_1fr_80px_90px_1fr_36px] text-xs font-medium px-3 py-2 ${dk ? "text-white/50" : "text-slate-500"}`}>
                            <span className={thCls} onClick={() => toggleSort("date")} data-testid="sort-date">Date<SortIcon col="date" /></span>
                            <span>ID</span>
                            <span className={thCls} onClick={() => toggleSort("client")} data-testid="sort-client">Client<SortIcon col="client" /></span>
                            <span className={`${thCls} justify-end`} onClick={() => toggleSort("montant")} data-testid="sort-montant">Montant<SortIcon col="montant" /></span>
                            <span className={`${thCls} justify-center`} onClick={() => toggleSort("statut")} data-testid="sort-statut">Statut<SortIcon col="statut" /></span>
                            <span className={thCls} onClick={() => toggleSort("origine")} data-testid="sort-origine">Origine<SortIcon col="origine" /></span>
                            <span></span>
                        </div>
                        {sorted.map((o: any) => (
                            <div key={o.id} className={`grid grid-cols-[80px_1fr_1fr_80px_90px_1fr_36px] text-sm px-3 py-2 rounded-lg ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"} transition ${selectedOrder?.id === o.id ? (dk ? "bg-orange-500/10 border border-orange-500/30" : "bg-orange-50 border border-orange-200") : ""}`}>
                                <span className={`text-xs ${dk ? "text-white/70" : "text-slate-600"}`}>
                                    {o.created_at ? new Date(o.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "-"}
                                    <br />
                                    <span className={dk ? "text-white/40" : "text-slate-400"}>{o.created_at ? new Date(o.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                                </span>
                                <span className={`text-xs font-mono ${dk ? "text-white/50" : "text-slate-400"}`} data-testid={`text-order-${o.id}`}>{o.id?.substring(0, 8)}</span>
                                <span className={`font-medium truncate ${dk ? "text-white/90" : "text-slate-800"}`}>{clientName(o)}</span>
                                <span className={`text-right font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{fmt(parseFloat(o.total || "0"))}</span>
                                <span className="text-center">
                                    <span className={`text-xs px-2 py-0.5 rounded-full inline-block ${o.status === "completed" ? "bg-green-500/20 text-green-400" : o.status === "cancelled" || o.status === "rejected" ? "bg-red-500/20 text-red-400" : "bg-orange-500/20 text-orange-400"}`}>{statusLabel(o.status)}</span>
                                </span>
                                <span className={`text-xs truncate ${dk ? "text-white/50" : "text-slate-500"}`}>{originLabel(o)}</span>
                                <button
                                    onClick={() => setSelectedOrder(selectedOrder?.id === o.id ? null : o)}
                                    className={`p-1 rounded-lg transition ${selectedOrder?.id === o.id ? "text-orange-500" : dk ? "text-white/30 hover:text-white/70" : "text-slate-300 hover:text-slate-600"}`}
                                    data-testid={`btn-order-detail-${o.id}`}
                                    title="Détails"
                                >
                                    <Eye className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {selectedOrder && (
                <OrderDetailPanel dk={dk} order={selectedOrder} clientName={clientName(selectedOrder)} originLabel={originLabel(selectedOrder)} statusLabel={statusLabel(selectedOrder.status)} onClose={() => setSelectedOrder(null)} />
            )}
        </div>
    );
}

function OrderDetailPanel({ dk, order, clientName, originLabel, statusLabel, onClose }: { dk: boolean; order: any; clientName: string; originLabel: string; statusLabel: string; onClose: () => void }) {
    const o = order;
    const items = o.items || [];
    const payments = o.payment || [];
    const customer = o.customer;

    const row = (label: string, value: string | React.ReactNode, icon?: any) => (
        <div className="flex items-start gap-3 py-2">
            {icon && <span className={`mt-0.5 ${dk ? "text-white/30" : "text-slate-400"}`}>{icon}</span>}
            <div className="flex-1 min-w-0">
                <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{label}</p>
                <p className={`text-sm font-medium ${dk ? "text-white" : "text-slate-800"}`}>{value}</p>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
                className={`relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl ${dk ? "bg-[#1a1a2e] border border-white/10" : "bg-white border border-slate-200"}`}
                onClick={(e) => e.stopPropagation()}
                data-testid="popup-order-detail"
            >
                <div className={`sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b ${dk ? "bg-[#1a1a2e] border-white/10" : "bg-white border-slate-200"}`}>
                    <div className="flex items-center gap-2">
                        <ShoppingBag className="w-5 h-5 text-orange-500" />
                        <h3 className={`text-base font-bold ${dk ? "text-white" : "text-slate-900"}`}>Détails commande</h3>
                    </div>
                    <button onClick={onClose} className={`p-1.5 rounded-xl transition ${dk ? "text-white/40 hover:text-white/80 hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`} data-testid="btn-close-order-detail">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-x-4">
                        <div>
                            {row("Date & heure", o.created_at ? new Date(o.created_at).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-", <Clock className="w-4 h-4" />)}
                            {row("ID", <span className="font-mono text-xs">{o.id}</span>, <Hash className="w-4 h-4" />)}
                        </div>
                        <div>
                            {row("Statut", <span className={`text-xs px-2 py-0.5 rounded-full ${o.status === "completed" ? "bg-green-500/20 text-green-400" : o.status === "cancelled" || o.status === "rejected" ? "bg-red-500/20 text-red-400" : "bg-orange-500/20 text-orange-400"}`}>{statusLabel}</span>)}
                            {row("Origine", originLabel)}
                        </div>
                    </div>

                    <div className={`rounded-xl p-3 ${dk ? "bg-white/5 border border-white/10" : "bg-slate-50 border border-slate-100"}`}>
                        <div className="grid grid-cols-2 gap-x-4">
                            {row("Client", customer ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "-" : "-", <User className="w-4 h-4" />)}
                            {row("Total", <span className="text-lg font-bold text-orange-500">{fmt(parseFloat(o.total || "0"))}</span>, <CreditCard className="w-4 h-4" />)}
                        </div>
                        {customer?.email && <p className={`text-xs mt-1 ${dk ? "text-white/40" : "text-slate-400"}`}>{customer.email}</p>}
                        {customer?.phone && <p className={`text-xs ${dk ? "text-white/40" : "text-slate-400"}`}>{customer.phone}</p>}
                    </div>

                    {items.length > 0 && (
                        <div>
                            <p className={`text-xs font-semibold mb-2 ${dk ? "text-white/60" : "text-slate-600"}`}>Articles ({items.length})</p>
                            <div className={`rounded-xl overflow-hidden border ${dk ? "border-white/10" : "border-slate-200"}`}>
                                <div className={`grid grid-cols-[1fr_50px_70px_70px] text-xs font-medium px-3 py-2 ${dk ? "bg-white/5 text-white/50" : "bg-slate-50 text-slate-500"}`}>
                                    <span>Produit</span><span className="text-center">Qté</span><span className="text-right">Prix</span><span className="text-right">Total</span>
                                </div>
                                {items.map((it: any, idx: number) => (
                                    <div key={idx} className={`grid grid-cols-[1fr_50px_70px_70px] text-sm px-3 py-2 ${dk ? "border-t border-white/5" : "border-t border-slate-100"}`}>
                                        <span className={dk ? "text-white/90" : "text-slate-800"}>{it.product_name || it.name || "-"}</span>
                                        <span className={`text-center ${dk ? "text-white/60" : "text-slate-600"}`}>{it.quantity || "1"}</span>
                                        <span className={`text-right ${dk ? "text-white/60" : "text-slate-600"}`}>{fmt(parseFloat(it.price || "0"))}</span>
                                        <span className={`text-right font-medium ${dk ? "text-white" : "text-slate-800"}`}>{fmt(parseFloat(it.subtotal || it.price || "0"))}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {payments.length > 0 && (
                        <div>
                            <p className={`text-xs font-semibold mb-2 ${dk ? "text-white/60" : "text-slate-600"}`}>Paiements</p>
                            <div className="flex flex-wrap gap-2">
                                {payments.map((p: any, idx: number) => (
                                    <div key={idx} className={`px-3 py-2 rounded-xl ${dk ? "bg-white/5 border border-white/10" : "bg-slate-50 border border-slate-200"}`}>
                                        <p className={`text-xs ${dk ? "text-white/50" : "text-slate-500"}`}>{p.type === "cash" ? "Espèces" : p.type === "card" ? "Carte" : p.type === "online" ? "En ligne" : p.type || "-"}</p>
                                        <p className={`text-sm font-semibold ${dk ? "text-white" : "text-slate-800"}`}>{fmt(parseFloat(p.amount || "0"))}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {o.customer_notes && (
                        <div>
                            <p className={`text-xs font-semibold mb-1 ${dk ? "text-white/60" : "text-slate-600"}`}>Notes client</p>
                            <p className={`text-sm ${dk ? "text-white/80" : "text-slate-700"}`}>{o.customer_notes}</p>
                        </div>
                    )}

                    {o.expected_time && row("Heure prévue", new Date(o.expected_time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), <Clock className="w-4 h-4" />)}
                </div>
            </div>
        </div>
    );
}

function CatalogSection({ dk, catalog, catalogLoading }: { dk: boolean; catalog?: CatalogData; catalogLoading: boolean }) {
    if (catalogLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>;
    if (!catalog) return <p className={`text-center py-10 ${dk ? "text-white/40" : "text-slate-400"}`}>Catalogue non disponible</p>;

    return (
        <div className="space-y-6">
            {catalog.categories.length > 0 && (
                <Card title={`Catégories (${catalog.categories.length})`} icon={Package}>
                    <div className="flex flex-wrap gap-2">
                        {catalog.categories.map((c: any) => (
                            <span key={c.id} className={`px-3 py-1.5 rounded-lg text-sm ${dk ? "bg-white/5 border border-white/10 text-white/80" : "bg-slate-50 border border-slate-200 text-slate-700"}`} data-testid={`text-catalog-cat-${c.id}`}>
                                {c.name}
                            </span>
                        ))}
                    </div>
                </Card>
            )}

            <Card title={`Produits (${catalog.products.length})`} icon={Utensils}>
                {catalog.products.length === 0 ? (
                    <p className={`text-center py-6 ${dk ? "text-white/40" : "text-slate-400"}`}>Aucun produit dans le catalogue</p>
                ) : (
                    <div className="space-y-1 max-h-[500px] overflow-y-auto">
                        <div className={`grid grid-cols-3 text-xs font-medium px-3 py-2 ${dk ? "text-white/50" : "text-slate-500"}`}>
                            <span>Produit</span><span>Réf.</span><span className="text-right">Prix</span>
                        </div>
                        {catalog.products.map((p: any) => (
                            <div key={p.id} className={`grid grid-cols-3 text-sm px-3 py-2 rounded-lg ${dk ? "hover:bg-white/5" : "hover:bg-slate-50"} transition`}>
                                <span className={`font-medium ${dk ? "text-white" : "text-slate-800"}`} data-testid={`text-product-${p.id}`}>{p.name}</span>
                                <span className={`text-xs font-mono ${dk ? "text-white/40" : "text-slate-400"}`}>{p.ref || "-"}</span>
                                <span className={`text-right ${dk ? "text-white/70" : "text-slate-600"}`}>
                                    {p.skus?.[0]?.price ? fmt(parseFloat(p.skus[0].price)) : "-"}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
