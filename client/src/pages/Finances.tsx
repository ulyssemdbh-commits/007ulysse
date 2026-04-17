import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTabListener } from "@/hooks/useAppNavigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    TrendingUp,
    TrendingDown,
    RefreshCw,
    ArrowLeft,
    Search,
    BarChart3,
    DollarSign,
    Activity,
    Newspaper,
    Star,
    Plus,
    Trash2,
    AlertTriangle,
    Globe,
    ArrowUpDown,
    ExternalLink,
    Clock,
    Minus,
    Briefcase,
    PieChart as PieChartIcon,
    Target,
    Shield,
    Wallet,
    ChevronUp,
    ChevronDown,
    Eye,
    X,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    PieChart,
    Pie,
    Cell,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface StockQuote {
    symbol: string;
    name?: string;
    price: number;
    change: number;
    changePercent: number;
    high: number;
    low: number;
    open: number;
    previousClose: number;
    volume: number;
    timestamp: number;
    marketCap?: number;
    pe?: number;
    eps?: number;
    provider: string;
}

interface CompanyProfile {
    symbol: string;
    name: string;
    description?: string;
    sector?: string;
    industry?: string;
    country?: string;
    currency?: string;
    exchange?: string;
    marketCap?: number;
    logo?: string;
    weburl?: string;
    ipo?: string;
}

interface StockCandle {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface StockNews {
    headline: string;
    summary: string;
    source: string;
    url: string;
    datetime: number;
    sentiment?: "positive" | "negative" | "neutral";
}

interface Recommendation {
    symbol: string;
    buy: number;
    hold: number;
    sell: number;
    strongBuy: number;
    strongSell: number;
    period: string;
}

interface SearchResult {
    symbol: string;
    description: string;
    type: string;
}

interface PortfolioPosition {
    id: number;
    symbol: string;
    shares: number;
    avgCost: number;
    currency: string;
    notes?: string;
    currentPrice?: number | null;
    currentValue?: number | null;
    costBasis: number;
    gainLoss?: number | null;
    gainLossPercent?: number | null;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "BTC"];
const CHART_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316", "#10b981", "#6366f1"];
const CHART_BG_CLASSES = ["bg-blue-500", "bg-green-500", "bg-amber-500", "bg-red-500", "bg-violet-500", "bg-cyan-500", "bg-pink-500", "bg-orange-500", "bg-emerald-500", "bg-indigo-500"];

function fmt(val: number, currency = "USD"): string {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 }).format(val);
}

function fmtCompact(val: number): string {
    if (Math.abs(val) >= 1e12) return `${(val / 1e12).toFixed(2)}T`;
    if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
    if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
    return val.toFixed(0);
}

function fmtPct(val: number): string {
    const sign = val >= 0 ? "+" : "";
    return `${sign}${val.toFixed(2)}%`;
}

function cn(...classes: (string | false | undefined)[]) {
    return classes.filter(Boolean).join(" ");
}

// ═══════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function PriceChange({ change, changePercent, size = "sm" }: { change: number; changePercent: number; size?: "sm" | "lg" }) {
    const up = change >= 0;
    const Icon = up ? TrendingUp : TrendingDown;
    return (
        <span className={cn(
            "inline-flex items-center gap-1 font-semibold",
            up ? "text-emerald-500" : "text-red-500",
            size === "lg" ? "text-base" : "text-xs"
        )}>
            <Icon className={size === "lg" ? "w-4 h-4" : "w-3 h-3"} />
            {up ? "+" : ""}{change.toFixed(2)} ({fmtPct(changePercent)})
        </span>
    );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div className="rounded-xl bg-background/60 backdrop-blur border border-border/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
            <p className={cn("text-sm font-bold mt-0.5", color)}>{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
    );
}

function EmptyState({ icon: Icon, title, sub }: { icon: any; title: string; sub?: string }) {
    return (
        <Card className="border-dashed border-2 border-border/40 bg-transparent">
            <CardContent className="py-12 text-center">
                <Icon className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground font-medium">{title}</p>
                {sub && <p className="text-xs text-muted-foreground/60 mt-1 max-w-md mx-auto">{sub}</p>}
            </CardContent>
        </Card>
    );
}

function LoadingGrid({ count = 6, h = "h-28" }: { count?: number; h?: string }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: count }).map((_, i) => (
                <Skeleton key={i} className={`${h} w-full rounded-xl`} />
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 1 — MARCHÉS
// ═══════════════════════════════════════════════════════════════════

function MarketOverviewTab() {
    const { data: market, isLoading } = useQuery<any>({
        queryKey: ["/api/v2/stocks/market"],
        refetchInterval: 60_000,
    });

    if (isLoading) return <LoadingGrid count={6} />;

    const indices = (market?.indices || []).map((idx: any) => ({
        ...idx,
        price: idx.price ?? idx.value ?? 0,
    }));

    if (indices.length === 0) {
        return (
            <div className="space-y-8">
                <EmptyState icon={Activity} title="Données de marché indisponibles" sub="Les marchés sont peut-être fermés ou le service est en cours de chargement." />
                <MarketNewsSection />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {indices.map((idx: any) => (
                    <Card key={idx.symbol} className="group relative overflow-hidden border-border/30 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur hover:border-primary/20 transition-all duration-300">
                        <div className={cn(
                            "absolute top-0 right-0 w-24 h-24 rounded-full opacity-[0.04] -mr-8 -mt-8",
                            idx.change >= 0 ? "bg-emerald-500" : "bg-red-500"
                        )} />
                        <CardContent className="p-5">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{idx.name || idx.symbol}</p>
                                    <p className="text-2xl font-black tracking-tight mt-1">{fmt(idx.price)}</p>
                                </div>
                                <Badge className={cn(
                                    "text-xs font-bold px-2.5 py-1 rounded-lg",
                                    idx.change >= 0
                                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                        : "bg-red-500/10 text-red-500 border-red-500/20"
                                )} variant="outline">
                                    {idx.change >= 0 ? <ChevronUp className="w-3 h-3 mr-0.5" /> : <ChevronDown className="w-3 h-3 mr-0.5" />}
                                    {fmtPct(idx.changePercent)}
                                </Badge>
                            </div>
                            <Separator className="my-3 opacity-30" />
                            <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                                <div><span className="block font-medium">High</span>{idx.high ? fmt(idx.high) : "—"}</div>
                                <div><span className="block font-medium">Low</span>{idx.low ? fmt(idx.low) : "—"}</div>
                                <div><span className="block font-medium">Vol</span>{idx.volume ? fmtCompact(idx.volume) : "—"}</div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            <MarketNewsSection />
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 2 — WATCHLIST
// ═══════════════════════════════════════════════════════════════════

function WatchlistTab() {
    const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
    const [newSymbol, setNewSymbol] = useState("");
    const { toast } = useToast();

    const { data: quotes, isLoading, refetch } = useQuery<StockQuote[]>({
        queryKey: ["/api/v2/stocks/quotes", symbols],
        queryFn: async () => {
            const res = await apiRequest("POST", "/api/v2/stocks/quotes", { symbols });
            return res.json();
        },
        refetchInterval: 30_000,
    });

    const addSymbol = useCallback(() => {
        const sym = newSymbol.trim().toUpperCase();
        if (!sym) return;
        if (symbols.includes(sym)) { toast({ title: "Déjà dans la watchlist", variant: "destructive" }); return; }
        setSymbols((prev) => [...prev, sym]);
        setNewSymbol("");
    }, [newSymbol, symbols, toast]);

    return (
        <div className="space-y-5">
            <div className="flex gap-2 items-center">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Ajouter un symbole…"
                        value={newSymbol}
                        onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === "Enter" && addSymbol()}
                        className="pl-9 h-9 bg-background/60"
                    />
                </div>
                <Button size="sm" onClick={addSymbol} className="h-9 gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Ajouter
                </Button>
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => refetch()}>
                    <RefreshCw className="w-4 h-4" />
                </Button>
            </div>

            {isLoading ? <LoadingGrid count={8} /> : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {(quotes || []).map((q) => (
                        <Card key={q.symbol} className="group border-border/30 bg-card/60 backdrop-blur hover:shadow-lg hover:border-primary/20 transition-all duration-200">
                            <CardContent className="p-4">
                                <div className="flex justify-between items-start">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-black text-sm tracking-tight">{q.symbol}</span>
                                            <button title={`Retirer ${q.symbol}`} onClick={() => setSymbols((p) => p.filter(s => s !== q.symbol))}
                                                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity">
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        {q.name && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{q.name}</p>}
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="font-black text-sm">{fmt(q.price)}</p>
                                        <PriceChange change={q.change} changePercent={q.changePercent} />
                                    </div>
                                </div>
                                <div className="mt-3 pt-2 border-t border-border/20 flex justify-between text-[10px] text-muted-foreground">
                                    <span>Vol: {fmtCompact(q.volume)}</span>
                                    {q.pe && <span>P/E: {q.pe.toFixed(1)}</span>}
                                    {q.marketCap && <span>Cap: {fmtCompact(q.marketCap)}</span>}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 3 — ANALYSE DÉTAILLÉE
// ═══════════════════════════════════════════════════════════════════

function SymbolDetailTab() {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
    const [chartInterval, setChartInterval] = useState("1day");

    const { data: searchResults } = useQuery<SearchResult[]>({
        queryKey: ["/api/v2/stocks/search", searchQuery],
        queryFn: async () => {
            if (!searchQuery || searchQuery.length < 2) return [];
            const res = await fetch(`/api/v2/stocks/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include" });
            if (!res.ok) throw new Error("Request failed");
            return res.json();
        },
        enabled: searchQuery.length >= 2,
    });

    const { data: quote, isLoading: quoteLoading } = useQuery<StockQuote>({
        queryKey: [`/api/v2/stocks/quote/${selectedSymbol}`],
        refetchInterval: 15_000,
    });

    const { data: profile } = useQuery<CompanyProfile>({
        queryKey: [`/api/v2/stocks/profile/${selectedSymbol}`],
    });

    const { data: history, isLoading: historyLoading } = useQuery<StockCandle[]>({
        queryKey: [`/api/v2/stocks/history/${selectedSymbol}?interval=${chartInterval}&size=100`],
    });

    const { data: recommendations } = useQuery<Recommendation>({
        queryKey: [`/api/v2/stocks/recommendations/${selectedSymbol}`],
    });

    const { data: indicators } = useQuery<any[]>({
        queryKey: [`/api/v2/stocks/indicators/${selectedSymbol}`],
    });

    return (
        <div className="space-y-5">
            {/* Search */}
            <div className="relative max-w-lg">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder="Rechercher un actif (AAPL, MSFT, LVMH, BTC…)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-10 bg-background/60 text-sm"
                />
                {searchResults && searchResults.length > 0 && (
                    <Card className="absolute top-full mt-1 left-0 right-0 z-50 max-h-64 overflow-auto shadow-xl border-border/40">
                        <CardContent className="p-1">
                            {searchResults.map((r) => (
                                <button key={r.symbol}
                                    className="w-full text-left px-3 py-2.5 hover:bg-accent rounded-lg text-sm flex justify-between items-center transition-colors"
                                    onClick={() => { setSelectedSymbol(r.symbol); setSearchQuery(""); }}>
                                    <span className="font-bold">{r.symbol}</span>
                                    <span className="text-muted-foreground text-xs truncate ml-3">{r.description}</span>
                                </button>
                            ))}
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Quote Header */}
            {quoteLoading ? <Skeleton className="h-32 w-full rounded-xl" /> : quote ? (
                <Card className="border-border/30 bg-gradient-to-r from-card/90 to-card/60 backdrop-blur overflow-hidden">
                    <CardContent className="p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                {profile?.logo && <img src={profile.logo} alt="" className="w-12 h-12 rounded-xl shadow-lg" />}
                                <div>
                                    <div className="flex items-center gap-2.5">
                                        <h2 className="text-2xl font-black tracking-tight">{selectedSymbol}</h2>
                                        <Badge variant="outline" className="text-[10px] font-medium">{profile?.exchange || quote.provider}</Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{profile?.name || quote.name}</p>
                                    {profile?.sector && <p className="text-[11px] text-muted-foreground/70">{profile.sector} — {profile.industry}</p>}
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-4xl font-black tracking-tighter">{fmt(quote.price)}</p>
                                <PriceChange change={quote.change} changePercent={quote.changePercent} size="lg" />
                            </div>
                        </div>
                        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                            <Stat label="Open" value={fmt(quote.open)} />
                            <Stat label="High" value={fmt(quote.high)} />
                            <Stat label="Low" value={fmt(quote.low)} />
                            <Stat label="Prev Close" value={fmt(quote.previousClose)} />
                            <Stat label="Volume" value={fmtCompact(quote.volume)} />
                            {quote.marketCap && <Stat label="Market Cap" value={fmtCompact(quote.marketCap)} />}
                            {quote.pe && <Stat label="P/E" value={quote.pe.toFixed(2)} />}
                            {quote.eps && <Stat label="EPS" value={`$${quote.eps.toFixed(2)}`} />}
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {/* Price Chart */}
            <Card className="border-border/30 bg-card/60 backdrop-blur">
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-bold tracking-tight">Historique des prix</CardTitle>
                        <div className="flex bg-background/60 rounded-lg p-0.5 gap-0.5">
                            {[{ key: "1day", label: "1J" }, { key: "1week", label: "1S" }, { key: "1month", label: "1M" }].map((iv) => (
                                <button key={iv.key}
                                    onClick={() => setChartInterval(iv.key)}
                                    className={cn(
                                        "px-3 py-1 text-xs font-medium rounded-md transition-all",
                                        chartInterval === iv.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                    )}>
                                    {iv.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {historyLoading ? <Skeleton className="h-72 w-full rounded-lg" /> :
                        history && history.length > 0 ? (
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={history}>
                                    <defs>
                                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} />
                                    <XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, boxShadow: "0 10px 40px rgba(0,0,0,.2)" }} formatter={(val: number) => [`$${val.toFixed(2)}`, "Prix"]} labelFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" })} />
                                    <Area type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} fill="url(#priceGrad)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">Pas de données historiques disponibles</div>
                        )}
                </CardContent>
            </Card>

            {/* Volume */}
            {history && history.length > 0 && (
                <Card className="border-border/30 bg-card/60 backdrop-blur">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-bold tracking-tight">Volume d'échanges</CardTitle></CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={100}>
                            <BarChart data={history}>
                                <XAxis dataKey="date" tick={false} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={fmtCompact} />
                                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }} formatter={(val: number) => [fmtCompact(val), "Volume"]} />
                                <Bar dataKey="volume" fill="#8b5cf6" opacity={0.6} radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}

            {/* Analyst + Indicators compact row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {recommendations && (
                    <Card className="border-border/30 bg-card/60 backdrop-blur">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" /> Recommandations</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-6">
                                <PieChart width={110} height={110}>
                                    <Pie data={[
                                        { name: "Acheter", value: recommendations.strongBuy + recommendations.buy, color: "#22c55e" },
                                        { name: "Conserver", value: recommendations.hold, color: "#eab308" },
                                        { name: "Vendre", value: recommendations.sell + recommendations.strongSell, color: "#ef4444" },
                                    ].filter(d => d.value > 0)} dataKey="value" cx={55} cy={55} innerRadius={28} outerRadius={50} strokeWidth={0}>
                                        {[
                                            { value: recommendations.strongBuy + recommendations.buy, color: "#22c55e" },
                                            { value: recommendations.hold, color: "#eab308" },
                                            { value: recommendations.sell + recommendations.strongSell, color: "#ef4444" },
                                        ].filter(d => d.value > 0).map((e, i) => (
                                            <Cell key={i} fill={e.color} />
                                        ))}
                                    </Pie>
                                </PieChart>
                                <div className="space-y-1.5 text-xs">
                                    <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className="text-muted-foreground">Achat Fort:</span><span className="font-bold">{recommendations.strongBuy}</span></div>
                                    <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-green-400" /><span className="text-muted-foreground">Achat:</span><span className="font-bold">{recommendations.buy}</span></div>
                                    <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /><span className="text-muted-foreground">Conserver:</span><span className="font-bold">{recommendations.hold}</span></div>
                                    <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /><span className="text-muted-foreground">Vente:</span><span className="font-bold">{recommendations.sell}</span></div>
                                    <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-600" /><span className="text-muted-foreground">Vente Forte:</span><span className="font-bold">{recommendations.strongSell}</span></div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {indicators && indicators.length > 0 && (
                    <Card className="border-border/30 bg-card/60 backdrop-blur">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2"><Activity className="w-4 h-4 text-blue-500" /> Indicateurs</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-2">
                                {indicators.slice(0, 6).map((ind: any) => (
                                    <div key={ind.name} className="rounded-lg bg-background/50 p-2.5">
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{ind.name}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="font-bold text-sm">{typeof ind.value === "number" ? ind.value.toFixed(2) : ind.value}</span>
                                            {ind.signal && (
                                                <Badge variant={ind.signal === "buy" ? "default" : ind.signal === "sell" ? "destructive" : "secondary"} className="text-[9px] px-1.5 py-0">
                                                    {ind.signal === "buy" ? "BUY" : ind.signal === "sell" ? "SELL" : "HOLD"}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Company */}
            {profile?.description && (
                <Card className="border-border/30 bg-card/60 backdrop-blur">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2"><Globe className="w-4 h-4" /> À propos de {profile.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{profile.description}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                            {profile.country && <span>Pays: <strong>{profile.country}</strong></span>}
                            {profile.ipo && <span>IPO: <strong>{profile.ipo}</strong></span>}
                            {profile.weburl && (
                                <a href={profile.weburl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">
                                    Site web <ExternalLink className="w-3 h-3" />
                                </a>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 4 — MON PORTEFEUILLE
// ═══════════════════════════════════════════════════════════════════

function PortfolioTab() {
    const [showAdd, setShowAdd] = useState(false);
    const [addSymbol, setAddSymbol] = useState("");
    const [addShares, setAddShares] = useState("");
    const [addCost, setAddCost] = useState("");
    const [addNotes, setAddNotes] = useState("");
    const { toast } = useToast();

    const { data: positions, isLoading, refetch } = useQuery<PortfolioPosition[]>({
        queryKey: ["/api/v2/stocks/portfolio"],
        refetchInterval: 60_000,
    });

    const addMutation = useMutation({
        mutationFn: async (data: { symbol: string; shares: number; avgCost: number; notes?: string }) => {
            const res = await apiRequest("POST", "/api/v2/stocks/portfolio", data);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/v2/stocks/portfolio"] });
            toast({ title: "Position ajoutée" });
            setShowAdd(false);
            setAddSymbol("");
            setAddShares("");
            setAddCost("");
            setAddNotes("");
        },
        onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await apiRequest("DELETE", `/api/v2/stocks/portfolio/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/v2/stocks/portfolio"] });
            toast({ title: "Position supprimée" });
        },
    });

    const totals = useMemo(() => {
        if (!positions || positions.length === 0) return null;
        const totalValue = positions.reduce((s, p) => s + (p.currentValue || 0), 0);
        const totalCost = positions.reduce((s, p) => s + p.costBasis, 0);
        const totalGain = totalValue - totalCost;
        const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
        return { totalValue, totalCost, totalGain, totalGainPct, count: positions.length };
    }, [positions]);

    const allocationData = useMemo(() => {
        if (!positions || positions.length === 0) return [];
        const total = positions.reduce((s, p) => s + (p.currentValue || p.costBasis), 0);
        return positions.map((p, i) => ({
            name: p.symbol,
            value: p.currentValue || p.costBasis,
            pct: total > 0 ? ((p.currentValue || p.costBasis) / total * 100) : 0,
            color: CHART_COLORS[i % CHART_COLORS.length],
            bgClass: CHART_BG_CLASSES[i % CHART_BG_CLASSES.length],
        }));
    }, [positions]);

    if (isLoading) return <LoadingGrid count={4} h="h-36" />;

    return (
        <div className="space-y-6">
            {/* Portfolio Summary */}
            {totals ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <Card className="lg:col-span-2 border-border/30 bg-gradient-to-br from-card/90 to-card/50 backdrop-blur overflow-hidden">
                        <CardContent className="p-6">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                <Wallet className="w-4 h-4" />
                                <span className="uppercase tracking-wider font-medium">Valeur Totale du Portefeuille</span>
                            </div>
                            <p className="text-5xl font-black tracking-tighter">{fmt(totals.totalValue)}</p>
                            <div className="flex items-center gap-4 mt-3">
                                <PriceChange change={totals.totalGain} changePercent={totals.totalGainPct} size="lg" />
                                <Separator orientation="vertical" className="h-5" />
                                <span className="text-xs text-muted-foreground">{totals.count} position{totals.count > 1 ? "s" : ""}</span>
                                <span className="text-xs text-muted-foreground">Coût: {fmt(totals.totalCost)}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-3 mt-5">
                                <Stat label="Coût Total" value={fmt(totals.totalCost)} />
                                <Stat label="Plus-value" value={fmt(totals.totalGain)} color={totals.totalGain >= 0 ? "text-emerald-500" : "text-red-500"} />
                                <Stat label="Rendement" value={fmtPct(totals.totalGainPct)} color={totals.totalGainPct >= 0 ? "text-emerald-500" : "text-red-500"} />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/30 bg-card/60 backdrop-blur">
                        <CardHeader className="pb-0">
                            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
                                <PieChartIcon className="w-4 h-4 text-violet-500" /> Allocation
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col items-center pt-2">
                            <PieChart width={180} height={180}>
                                <Pie data={allocationData} dataKey="value" cx={90} cy={90} innerRadius={45} outerRadius={80} strokeWidth={2} stroke="hsl(var(--card))">
                                    {allocationData.map((e, i) => <Cell key={i} fill={e.color} />)}
                                </Pie>
                                <Tooltip formatter={(val: number) => fmt(val)} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }} />
                            </PieChart>
                            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
                                {allocationData.map((d) => (
                                    <span key={d.name} className="flex items-center gap-1 text-[10px]">
                                        <span className={`w-2 h-2 rounded-full ${d.bgClass}`} />
                                        <span className="font-medium">{d.name}</span>
                                        <span className="text-muted-foreground">{d.pct.toFixed(0)}%</span>
                                    </span>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            ) : (
                <EmptyState icon={Briefcase} title="Aucune position dans le portefeuille" sub="Ajoutez vos premières positions pour suivre vos investissements et calculer votre rendement en temps réel." />
            )}

            {/* Add position */}
            {!showAdd ? (
                <Button onClick={() => setShowAdd(true)} className="gap-2">
                    <Plus className="w-4 h-4" /> Ajouter une position
                </Button>
            ) : (
                <Card className="border-primary/30 bg-card/80 backdrop-blur">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-bold">Nouvelle position</CardTitle>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowAdd(false)}><X className="w-4 h-4" /></Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <Input placeholder="Symbole (AAPL)" value={addSymbol} onChange={(e) => setAddSymbol(e.target.value.toUpperCase())} className="bg-background/60" />
                            <Input placeholder="Nb actions" type="number" value={addShares} onChange={(e) => setAddShares(e.target.value)} className="bg-background/60" />
                            <Input placeholder="Coût moyen ($)" type="number" step="0.01" value={addCost} onChange={(e) => setAddCost(e.target.value)} className="bg-background/60" />
                            <Input placeholder="Notes (optionnel)" value={addNotes} onChange={(e) => setAddNotes(e.target.value)} className="bg-background/60" />
                        </div>
                        <Button className="mt-3 gap-2" disabled={!addSymbol || !addShares || !addCost || addMutation.isPending}
                            onClick={() => addMutation.mutate({ symbol: addSymbol, shares: parseFloat(addShares), avgCost: parseFloat(addCost), notes: addNotes || undefined })}>
                            {addMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Ajouter au portefeuille
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Positions table */}
            {positions && positions.length > 0 && (
                <Card className="border-border/30 bg-card/60 backdrop-blur overflow-hidden">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
                                <Briefcase className="w-4 h-4" /> Positions ({positions.length})
                            </CardTitle>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => refetch()}><RefreshCw className="w-3.5 h-3.5" /></Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <ScrollArea className="max-h-[500px]">
                            <div className="min-w-full">
                                <div className="grid grid-cols-8 gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/20 bg-background/30 sticky top-0 z-10">
                                    <span>Actif</span>
                                    <span className="text-right">Actions</span>
                                    <span className="text-right">PRU</span>
                                    <span className="text-right">Prix actuel</span>
                                    <span className="text-right">Valeur</span>
                                    <span className="text-right">Coût</span>
                                    <span className="text-right">P&L</span>
                                    <span className="text-right">Action</span>
                                </div>
                                {positions.map((pos) => {
                                    const gl = pos.gainLoss || 0;
                                    const glPct = pos.gainLossPercent || 0;
                                    return (
                                        <div key={pos.id} className="grid grid-cols-8 gap-2 px-4 py-3 items-center border-b border-border/10 hover:bg-accent/30 transition-colors text-sm">
                                            <div>
                                                <span className="font-black text-xs">{pos.symbol}</span>
                                                {pos.notes && <p className="text-[10px] text-muted-foreground truncate">{pos.notes}</p>}
                                            </div>
                                            <span className="text-right font-medium">{pos.shares}</span>
                                            <span className="text-right">{fmt(pos.avgCost)}</span>
                                            <span className="text-right font-medium">{pos.currentPrice ? fmt(pos.currentPrice) : "—"}</span>
                                            <span className="text-right font-bold">{pos.currentValue ? fmt(pos.currentValue) : "—"}</span>
                                            <span className="text-right text-muted-foreground">{fmt(pos.costBasis)}</span>
                                            <div className="text-right">
                                                <span className={cn("font-bold text-xs", gl >= 0 ? "text-emerald-500" : "text-red-500")}>
                                                    {gl >= 0 ? "+" : ""}{fmt(gl)}
                                                </span>
                                                <p className={cn("text-[10px]", glPct >= 0 ? "text-emerald-500/70" : "text-red-500/70")}>
                                                    {fmtPct(glPct)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-500"
                                                    onClick={() => deleteMutation.mutate(pos.id)}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            )}

            {/* Investment Strategy Section */}
            <Card className="border-border/30 bg-gradient-to-br from-violet-500/5 to-blue-500/5 backdrop-blur">
                <CardHeader>
                    <CardTitle className="text-sm font-bold tracking-tight flex items-center gap-2">
                        <Target className="w-4 h-4 text-violet-500" /> Stratégie d'Investissement
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Discute avec Ulysse pour définir ta stratégie — il analysera ton portefeuille et te recommandera des actions.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <StrategyCard icon={Shield} color="text-emerald-500" title="Défensif"
                            desc="Actions value, dividendes, faible volatilité. DCA mensuel."
                            tags={["Dividendes", "Blue chips", "ETF"]} />
                        <StrategyCard icon={BarChart3} color="text-blue-500" title="Équilibré"
                            desc="Mix 60/40 actions/bonds. Rééquilibrage trimestriel."
                            tags={["Growth", "S&P 500", "Obligataire"]} />
                        <StrategyCard icon={TrendingUp} color="text-orange-500" title="Agressif"
                            desc="Growth stocks, crypto, momentum. Swing trading."
                            tags={["Tech", "Crypto", "Small caps"]} />
                    </div>
                    <div className="mt-4 p-4 rounded-xl bg-background/40 border border-border/20">
                        <p className="text-xs text-muted-foreground">
                            <strong className="text-foreground">Demande à Ulysse :</strong> "Analyse mon portefeuille", "Suggère-moi des actions défensives",
                            "Quel est le meilleur moment pour investir dans NVDA ?", "Construis-moi un portefeuille équilibré de 10K€"
                        </p>
                        <Link href="/talking">
                            <Button size="sm" variant="outline" className="mt-3 gap-2 text-xs">
                                <Activity className="w-3.5 h-3.5" /> Parler à Ulysse
                            </Button>
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function StrategyCard({ icon: Icon, color, title, desc, tags }: { icon: any; color: string; title: string; desc: string; tags: string[] }) {
    return (
        <div className="rounded-xl border border-border/20 bg-background/40 p-4 hover:border-primary/20 transition-colors">
            <Icon className={cn("w-5 h-5 mb-2", color)} />
            <p className="font-bold text-sm">{title}</p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{desc}</p>
            <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((t) => <Badge key={t} variant="secondary" className="text-[9px] px-1.5 py-0">{t}</Badge>)}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 5 — ANALYSE EXPERT
// ═══════════════════════════════════════════════════════════════════

function MarketAnalysisTab() {
    const [symbol, setSymbol] = useState("AAPL");
    const [horizon, setHorizon] = useState("moyen");

    const { data: analysis, isLoading, refetch } = useQuery<any>({
        queryKey: [`/api/v2/markets/analyze?symbol=${symbol}&horizon=${horizon}`],
        enabled: !!symbol,
    });

    const { data: scenarios } = useQuery<any>({
        queryKey: [`/api/v2/markets/scenarios?symbol=${symbol}`],
        enabled: !!symbol && !!analysis,
    });

    return (
        <div className="space-y-5">
            <div className="flex gap-2 flex-wrap items-center">
                <Input placeholder="Symbole" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="max-w-[140px] h-9 bg-background/60" />
                <div className="flex bg-background/60 rounded-lg p-0.5 gap-0.5">
                    {(["court", "moyen", "long"] as const).map((h) => (
                        <button key={h}
                            onClick={() => setHorizon(h)}
                            className={cn("px-3 py-1.5 text-xs font-medium rounded-md transition-all", horizon === h ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                            {h === "court" ? "Court" : h === "moyen" ? "Moyen" : "Long"}
                        </button>
                    ))}
                </div>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => refetch()}>
                    <BarChart3 className="w-3.5 h-3.5" /> Analyser
                </Button>
            </div>

            {isLoading && <Skeleton className="h-52 w-full rounded-xl" />}

            {analysis?.success && analysis.analysis && (
                <>
                    <Card className="border-border/30 bg-gradient-to-r from-card/90 to-card/60 backdrop-blur">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-lg font-black">{analysis.analysis.symbol} — {analysis.analysis.name}</p>
                                    <p className="text-4xl font-black tracking-tighter mt-1">{fmt(analysis.analysis.currentPrice)}</p>
                                    <PriceChange change={analysis.analysis.change24h} changePercent={analysis.analysis.changePercent24h} size="lg" />
                                </div>
                                <div className="text-right space-y-2">
                                    <SignalBadge signal={analysis.analysis.signal} />
                                    <p className="text-xs text-muted-foreground">Confiance: <strong>{analysis.analysis.confidence}%</strong></p>
                                </div>
                            </div>
                            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{analysis.analysis.summary}</p>
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card className="border-border/30 bg-card/60 backdrop-blur">
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Analyse Technique</CardTitle></CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-2">
                                    <Stat label="Tendance" value={analysis.analysis.technical.trend} />
                                    <Stat label="Force" value={`${analysis.analysis.technical.trendStrength}/100`} />
                                    <Stat label="RSI" value={`${analysis.analysis.technical.rsiLevel?.toFixed(1)} (${analysis.analysis.technical.rsiSignal})`} />
                                    <Stat label="MACD" value={analysis.analysis.technical.macdSignal} />
                                    <Stat label="SMA 50/200" value={analysis.analysis.technical.sma50vs200} />
                                    <Stat label="Volume" value={analysis.analysis.technical.volumeTrend} />
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="border-border/30 bg-card/60 backdrop-blur">
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Niveaux Clés</CardTitle></CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-2">
                                    <Stat label="Support 1" value={fmt(analysis.analysis.levels.support1)} />
                                    <Stat label="Résistance 1" value={fmt(analysis.analysis.levels.resistance1)} />
                                    <Stat label="Support 2" value={fmt(analysis.analysis.levels.support2)} />
                                    <Stat label="Résistance 2" value={fmt(analysis.analysis.levels.resistance2)} />
                                    <Stat label="Stop Loss" value={fmt(analysis.analysis.levels.stopLoss)} color="text-red-500" />
                                    <Stat label="Take Profit" value={fmt(analysis.analysis.levels.takeProfit1)} color="text-emerald-500" />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card className="border-red-500/10 bg-red-500/[0.02] backdrop-blur">
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-bold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" /> Risques</CardTitle></CardHeader>
                            <CardContent>
                                <ul className="space-y-1.5">
                                    {(analysis.analysis.risks || []).map((r: string, i: number) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground"><Minus className="w-3 h-3 mt-1 shrink-0 text-red-400" />{r}</li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                        <Card className="border-emerald-500/10 bg-emerald-500/[0.02] backdrop-blur">
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-bold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-500" /> Opportunités</CardTitle></CardHeader>
                            <CardContent>
                                <ul className="space-y-1.5">
                                    {(analysis.analysis.opportunities || []).map((o: string, i: number) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground"><Plus className="w-3 h-3 mt-1 shrink-0 text-emerald-400" />{o}</li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    </div>

                    {scenarios?.success && scenarios.scenarios && (
                        <Card className="border-border/30 bg-card/60 backdrop-blur">
                            <CardHeader className="pb-2"><CardTitle className="text-sm font-bold">Scénarios de Trading</CardTitle></CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {scenarios.scenarios.map((sc: any) => (
                                        <div key={sc.type} className="rounded-xl p-4 border border-border/20 bg-background/30">
                                            <Badge variant="outline" className="text-[10px] mb-2">
                                                {sc.type.charAt(0).toUpperCase() + sc.type.slice(1)}
                                            </Badge>
                                            <div className="space-y-1 text-xs">
                                                <p>Entrée: <strong>{fmt(sc.entryZone.min)} – {fmt(sc.entryZone.max)}</strong></p>
                                                <p className="text-red-400">Stop: <strong>{fmt(sc.stopLoss)}</strong></p>
                                                <p className="text-emerald-400">TP: <strong>{sc.takeProfit.map((tp: number) => fmt(tp)).join(" / ")}</strong></p>
                                                <p>R/R: <strong>{sc.riskRewardRatio.toFixed(1)}x</strong> · Position: <strong>{sc.positionSizePercent}%</strong></p>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground mt-2">{sc.description}</p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 6 — FOREX / CRYPTO
// ═══════════════════════════════════════════════════════════════════

function ForexCryptoTab() {
    const FOREX = [{ from: "EUR", to: "USD" }, { from: "GBP", to: "USD" }, { from: "USD", to: "JPY" }, { from: "EUR", to: "GBP" }, { from: "USD", to: "CHF" }];
    const CRYPTO = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA"];

    const { data: forexData, isLoading: fl } = useQuery<any[]>({
        queryKey: ["/finances/forex", FOREX],
        queryFn: async () => {
            const r = await Promise.allSettled(FOREX.map(async (p) => { const res = await fetch(`/api/v2/stocks/forex/${p.from}/${p.to}`, { credentials: "include" }); if (!res.ok) return null; return res.json(); }));
            return r.map((x) => (x.status === "fulfilled" ? x.value : null)).filter(Boolean);
        },
        refetchInterval: 60_000,
    });

    const { data: cryptoData, isLoading: cl } = useQuery<any[]>({
        queryKey: ["/finances/crypto", CRYPTO],
        queryFn: async () => {
            const r = await Promise.allSettled(CRYPTO.map(async (sym) => {
                const res = await fetch(`/api/v2/stocks/quote/${sym}`, { credentials: "include" });
                if (!res.ok) { const r2 = await fetch(`/api/v2/stocks/crypto/${sym}`, { credentials: "include" }); if (!r2.ok) return null; return r2.json(); }
                return res.json();
            }));
            return r.map((x) => (x.status === "fulfilled" ? x.value : null)).filter(Boolean);
        },
        refetchInterval: 30_000,
    });

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-base font-bold tracking-tight mb-4 flex items-center gap-2"><ArrowUpDown className="w-5 h-5 text-blue-500" /> Forex</h3>
                {fl ? <LoadingGrid count={5} /> : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        {(forexData || []).length === 0 ? (
                            <div className="col-span-full"><EmptyState icon={ArrowUpDown} title="Données forex indisponibles" /></div>
                        ) : (forexData || []).map((rate: any, i: number) => (
                            <Card key={i} className="border-border/30 bg-card/60 backdrop-blur hover:border-blue-500/20 transition-colors">
                                <CardContent className="p-4 text-center">
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{rate?.from}/{rate?.to || "?"}</p>
                                    <p className="text-2xl font-black mt-1">{rate?.rate?.toFixed(4) || "N/A"}</p>
                                    {rate?.change && rate.change !== 0 && <PriceChange change={rate.change} changePercent={rate.changePercent || 0} />}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <h3 className="text-base font-bold tracking-tight mb-4 flex items-center gap-2"><DollarSign className="w-5 h-5 text-orange-500" /> Crypto</h3>
                {cl ? <LoadingGrid count={7} /> : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {(cryptoData || []).length === 0 ? (
                            <div className="col-span-full"><EmptyState icon={DollarSign} title="Données crypto indisponibles" /></div>
                        ) : (cryptoData || []).map((c: any, i: number) => (
                            <Card key={i} className="border-border/30 bg-card/60 backdrop-blur hover:border-orange-500/20 transition-colors group">
                                <CardContent className="p-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{c?.symbol || "?"}</p>
                                    <p className="text-2xl font-black mt-1">{c?.price ? fmt(c.price) : "N/A"}</p>
                                    {c?.change !== undefined && c.change !== 0 && <PriceChange change={c.change} changePercent={c.changePercent || 0} />}
                                    {c?.volume > 0 && <p className="text-[10px] text-muted-foreground mt-2">Vol: {fmtCompact(c.volume)}</p>}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// NEWS SECTION
// ═══════════════════════════════════════════════════════════════════

function MarketNewsSection() {
    const { data: news, isLoading } = useQuery<StockNews[]>({
        queryKey: ["/api/v2/stocks/news?limit=20"],
        refetchInterval: 120_000,
    });

    if (isLoading) return <LoadingGrid count={4} />;

    return (
        <div>
            <h3 className="text-base font-bold tracking-tight mb-4 flex items-center gap-2"><Newspaper className="w-5 h-5 text-blue-500" /> Actualités</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(news || []).slice(0, 10).map((n, i) => (
                    <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" className="block group">
                        <Card className="border-border/30 bg-card/60 backdrop-blur hover:border-primary/15 transition-all duration-200 h-full">
                            <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                    {n.sentiment && (
                                        <Badge variant={n.sentiment === "positive" ? "default" : n.sentiment === "negative" ? "destructive" : "secondary"}
                                            className="text-[9px] px-1.5 py-0 mt-0.5 shrink-0">
                                            {n.sentiment === "positive" ? "+" : n.sentiment === "negative" ? "−" : "="}
                                        </Badge>
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">{n.headline}</p>
                                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">{n.summary}</p>
                                        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                                            <span className="font-medium">{n.source}</span>
                                            <Clock className="w-3 h-3" />
                                            <span>{new Date(n.datetime * 1000).toLocaleDateString("fr-FR")}</span>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </a>
                ))}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════════

function SignalBadge({ signal }: { signal: string }) {
    const cfg: Record<string, { label: string; cls: string }> = {
        achat_fort: { label: "ACHAT FORT", cls: "bg-emerald-600 text-white shadow-emerald-600/30" },
        achat: { label: "ACHAT", cls: "bg-emerald-500 text-white shadow-emerald-500/30" },
        neutre: { label: "NEUTRE", cls: "bg-gray-500 text-white" },
        vente: { label: "VENTE", cls: "bg-red-500 text-white shadow-red-500/30" },
        vente_forte: { label: "VENTE FORTE", cls: "bg-red-600 text-white shadow-red-600/30" },
    };
    const c = cfg[signal] || { label: signal, cls: "bg-gray-500 text-white" };
    return <span className={`px-3.5 py-1.5 rounded-full text-[10px] font-black tracking-wide shadow-lg ${c.cls}`}>{c.label}</span>;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════

export default function Finances() {
    const [activeTab, setActiveTab] = useState("overview");
    useTabListener(setActiveTab, ["overview", "watchlist", "detail", "portfolio", "expert", "forex"], {
        "marches": "overview", "marchés": "overview", "marche": "overview",
        "analyse": "detail", "detail": "detail", "détail": "detail",
        "portefeuille": "portfolio", "portfolio": "portfolio",
        "crypto": "forex", "change": "forex",
    });
    return (
        <div className="min-h-screen bg-background">
            {/* Top bar */}
            <div className="sticky top-0 z-20 border-b border-border/20 bg-background/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link href="/">
                            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                        </Link>
                        <div>
                            <h1 className="text-lg font-black tracking-tight flex items-center gap-2">
                                <DollarSign className="w-5 h-5 text-emerald-500" />
                                Ulysse Finance
                            </h1>
                            <p className="text-[10px] text-muted-foreground tracking-wide">MARCHÉS · PORTEFEUILLE · ANALYSE</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-7xl mx-auto px-4 py-6">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="bg-background/60 backdrop-blur border border-border/30 rounded-xl h-auto p-1 gap-0.5 flex-wrap">
                        <TabsTrigger value="overview" className="text-xs font-medium gap-1.5 rounded-lg data-[state=active]:shadow-md"><Globe className="w-3.5 h-3.5" /> Marchés</TabsTrigger>
                        <TabsTrigger value="watchlist" className="text-xs font-medium gap-1.5 rounded-lg data-[state=active]:shadow-md"><Eye className="w-3.5 h-3.5" /> Watchlist</TabsTrigger>
                        <TabsTrigger value="detail" className="text-xs font-medium gap-1.5 rounded-lg data-[state=active]:shadow-md"><Search className="w-3.5 h-3.5" /> Analyse</TabsTrigger>
                        <TabsTrigger value="portfolio" className="text-xs font-medium gap-1.5 rounded-lg data-[state=active]:shadow-md"><Briefcase className="w-3.5 h-3.5" /> Mon Portefeuille</TabsTrigger>
                        <TabsTrigger value="expert" className="text-xs font-medium gap-1.5 rounded-lg data-[state=active]:shadow-md"><Target className="w-3.5 h-3.5" /> Expert</TabsTrigger>
                        <TabsTrigger value="forex" className="text-xs font-medium gap-1.5 rounded-lg data-[state=active]:shadow-md"><ArrowUpDown className="w-3.5 h-3.5" /> Forex / Crypto</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview"><MarketOverviewTab /></TabsContent>
                    <TabsContent value="watchlist"><WatchlistTab /></TabsContent>
                    <TabsContent value="detail"><SymbolDetailTab /></TabsContent>
                    <TabsContent value="portfolio"><PortfolioTab /></TabsContent>
                    <TabsContent value="expert"><MarketAnalysisTab /></TabsContent>
                    <TabsContent value="forex"><ForexCryptoTab /></TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
