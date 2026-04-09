import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity, RefreshCw, Database, Zap, AlertTriangle, Cpu, Globe, Layers,
} from "lucide-react";
import { API, adminFetch, Spinner } from "./shared";

export function ScalabilityPanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch(`${API}/admin/scalability-health`);
      if (res.ok) setData(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  if (loading) return <Spinner />;
  if (!data) return <div className="text-center py-8 text-gray-500 text-sm">Erreur chargement</div>;

  const statusColor = data.status === "healthy" ? "text-green-400" : data.status === "degraded" ? "text-yellow-400" : "text-red-400";
  const statusBg = data.status === "healthy" ? "bg-green-500/10 border-green-500/20" : data.status === "degraded" ? "bg-yellow-500/10 border-yellow-500/20" : "bg-red-500/10 border-red-500/20";

  const uptimeHrs = Math.floor((data.uptime || 0) / 3600000);
  const uptimeMins = Math.floor(((data.uptime || 0) % 3600000) / 60000);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4" /> Scalabilite & Performance</h3>
        <div className="flex items-center gap-2">
          <button
            className={`text-xs px-2 py-0.5 rounded ${autoRefresh ? "bg-green-600/20 text-green-400" : "bg-gray-800 text-gray-500"}`}
            onClick={() => setAutoRefresh(!autoRefresh)}
            data-testid="btn-auto-refresh"
          >
            {autoRefresh ? "Live ON" : "Live OFF"}
          </button>
          <Button size="sm" variant="ghost" onClick={load} data-testid="btn-refresh-scalability"><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
      </div>

      <div className={`rounded-lg border p-3 ${statusBg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${data.status === "healthy" ? "bg-green-400" : data.status === "degraded" ? "bg-yellow-400" : "bg-red-400"} ${data.status === "critical" ? "animate-pulse" : ""}`} />
            <span className={`text-sm font-bold uppercase ${statusColor}`} data-testid="text-system-status">{data.status}</span>
          </div>
          <span className="text-xs text-gray-500">Uptime: {uptimeHrs}h {uptimeMins}m</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">Heap Memory</p>
            <p className="text-lg font-bold text-white" data-testid="text-heap-used">{data.memory?.heapUsedMB}MB</p>
            <div className="w-full h-1.5 bg-gray-800 rounded mt-1.5">
              <div className={`h-full rounded ${(data.memory?.heapPercent || 0) > 90 ? "bg-red-500" : (data.memory?.heapPercent || 0) > 75 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, data.memory?.heapPercent || 0)}%` }} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{data.memory?.heapPercent}% of {data.memory?.heapTotalMB}MB</p>
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">RSS Total</p>
            <p className="text-lg font-bold text-white" data-testid="text-rss">{data.memory?.rssMB}MB</p>
            <p className="text-xs text-gray-500 mt-1">{data.requests?.total || 0} requetes</p>
            <p className="text-xs text-gray-500">Erreurs: {data.requests?.errorRate || 0}%</p>
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">Response Time</p>
            <p className="text-lg font-bold text-white" data-testid="text-avg-response">{data.performance?.avgResponseMs}ms</p>
            <p className="text-xs text-gray-500 mt-1">p95: {data.performance?.p95ResponseMs}ms</p>
          </CardContent>
        </Card>

        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardContent className="p-3">
            <p className="text-xs text-gray-500 uppercase">Redis</p>
            <div className="flex items-center gap-1.5 mt-1">
              <div className={`w-2 h-2 rounded-full ${data.redis?.connected ? "bg-green-400" : "bg-red-400"}`} />
              <span className={`text-sm font-bold ${data.redis?.connected ? "text-green-400" : "text-red-400"}`} data-testid="text-redis-status">{data.redis?.connected ? "Connected" : "Fallback"}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Hits: {data.redis?.hits || 0} | Miss: {data.redis?.misses || 0}</p>
            <p className="text-xs text-gray-500">Mem cache: {data.redis?.memoryFallbackSize || 0}</p>
          </CardContent>
        </Card>
      </div>

      {data.dbPool && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Database className="w-3.5 h-3.5" /> DB Pool</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-lg font-mono font-bold text-white" data-testid="text-db-total">{data.dbPool.totalCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Idle</p>
                <p className="text-lg font-mono font-bold text-green-400">{data.dbPool.idleCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Waiting</p>
                <p className="text-lg font-mono font-bold text-yellow-400" data-testid="text-db-waiting">{data.dbPool.waitingCount}</p>
              </div>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded mt-3 overflow-hidden flex">
              <div className="h-full bg-blue-500" style={{ width: `${((data.dbPool.totalCount - data.dbPool.idleCount) / 40) * 100}%` }} title="Active" />
              <div className="h-full bg-green-500/50" style={{ width: `${(data.dbPool.idleCount / 40) * 100}%` }} title="Idle" />
            </div>
            <p className="text-xs text-gray-500 mt-1">{data.dbPool.totalCount - data.dbPool.idleCount} active / {data.dbPool.idleCount} idle / 40 max</p>
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/90 dark:bg-gray-900/60">
        <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Zap className="w-3.5 h-3.5" /> Concurrency Limiter</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(data.concurrency || {}).map(([domain, info]: [string, any]) => (
              <div key={domain} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-24 flex-shrink-0 font-mono">{domain}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded overflow-hidden">
                  <div
                    className={`h-full rounded ${info.active >= info.limit ? "bg-red-500" : info.active > 0 ? "bg-blue-500" : "bg-gray-700"}`}
                    style={{ width: `${(info.active / info.limit) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-300 w-16 text-right" data-testid={`text-concurrency-${domain}`}>
                  {info.active}/{info.limit}
                  {info.waiting > 0 && <span className="text-yellow-400 ml-1">+{info.waiting}w</span>}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {Object.keys(data.circuits || {}).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Circuit Breakers</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {Object.entries(data.circuits || {}).map(([name, info]: [string, any]) => (
                <div key={name} className="flex items-center justify-between bg-gray-100/60 dark:bg-gray-800/30 rounded px-3 py-1.5">
                  <span className="text-xs text-gray-400 font-mono">{name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs h-4 ${info.state === "closed" ? "text-green-400 border-green-400/30" : info.state === "open" ? "text-red-400 border-red-400/30" : "text-yellow-400 border-yellow-400/30"}`}>
                      {info.state}
                    </Badge>
                    {info.failures > 0 && <span className="text-xs text-red-400">{info.failures} fails</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(data.workers || []).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Cpu className="w-3.5 h-3.5" /> Workers Dedies (Palier 3)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data.workers || []).map((w: any) => (
                <div key={w.type} className="bg-gray-100/60 dark:bg-gray-800/30 rounded p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{w.label}</span>
                      <Badge variant="outline" className="text-[8px] h-4 text-gray-400 border-gray-600">{w.domain}</Badge>
                    </div>
                    <span className="text-xs font-mono text-gray-300" data-testid={`text-worker-${w.type}`}>
                      {w.active}/{w.maxConcurrency} actifs
                      {w.queueDepth > 0 && <span className="text-yellow-400 ml-1">+{w.queueDepth} en attente</span>}
                    </span>
                  </div>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden mb-1.5">
                    <div
                      className={`h-full rounded ${w.active >= w.maxConcurrency ? "bg-red-500" : w.active > 0 ? "bg-blue-500" : "bg-gray-700"}`}
                      style={{ width: `${w.maxConcurrency > 0 ? (w.active / w.maxConcurrency) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>Traites: <span className="text-gray-300">{w.totalProcessed}</span></span>
                    <span>Echecs: <span className={w.totalFailed > 0 ? "text-red-400" : "text-gray-300"}>{w.totalFailed}</span></span>
                    <span>Moy: <span className="text-gray-300">{w.avgDurationMs}ms</span></span>
                    {w.lastActivity > 0 && <span>Derniere: <span className="text-gray-300">{Math.round((Date.now() - w.lastActivity) / 1000)}s</span></span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(data.domains || []).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Globe className="w-3.5 h-3.5" /> Isolation par Domaine (Palier 4)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data.domains || []).map((d: any) => {
                const statusColors: Record<string, string> = { healthy: "border-green-500/30 bg-green-500/5", degraded: "border-yellow-500/30 bg-yellow-500/5", isolated: "border-red-500/30 bg-red-500/5", offline: "border-gray-600 bg-gray-100/60 dark:bg-gray-800/30" };
                const dotColors: Record<string, string> = { healthy: "bg-green-400", degraded: "bg-yellow-400", isolated: "bg-red-400", offline: "bg-gray-500" };
                return (
                  <div key={d.name} className={`rounded-lg border p-3 ${statusColors[d.status] || statusColors.healthy}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-sm font-bold text-white">{d.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${dotColors[d.status] || dotColors.healthy}`} />
                        <span className="text-xs text-gray-400 uppercase">{d.status}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{d.description}</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500 block">Requetes</span>
                        <span className="text-white font-mono font-bold">{d.requests}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Erreurs</span>
                        <span className={`font-mono font-bold ${d.errorRate > 5 ? "text-red-400" : "text-white"}`}>{d.errorRate}%</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Latence</span>
                        <span className="text-white font-mono font-bold">{d.avgResponseMs}ms</span>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-2 text-xs text-gray-500">
                      <span>Rate: {d.rateLimit?.requestsPerMinute}/min</span>
                      <span>DB: {d.dbPool?.min}-{d.dbPool?.max}</span>
                      <span>CB: {d.circuitState}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {(data.roadmap || []).length > 0 && (
        <Card className="bg-white/90 dark:bg-gray-900/60">
          <CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> Roadmap Scalabilite</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(data.roadmap || []).map((p: any) => {
                const statusBadge: Record<string, string> = { done: "bg-green-500/20 text-green-400 border-green-500/30", active: "bg-blue-500/20 text-blue-400 border-blue-500/30", planned: "bg-gray-700/30 text-gray-400 border-gray-600" };
                const statusLabel: Record<string, string> = { done: "Termine", active: "En cours", planned: "Prevu" };
                return (
                  <div key={p.palier} className="bg-gray-100/60 dark:bg-gray-800/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white bg-gray-700 px-2 py-0.5 rounded">P{p.palier}</span>
                        <span className="text-xs font-semibold text-white">{p.title}</span>
                      </div>
                      <Badge variant="outline" className={`text-xs h-4 ${statusBadge[p.status] || statusBadge.planned}`}>
                        {statusLabel[p.status] || p.status}
                      </Badge>
                    </div>
                    <div className="space-y-0.5">
                      {p.items.map((item: string, i: number) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs">
                          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status === "done" ? "bg-green-400" : p.status === "active" ? "bg-blue-400" : "bg-gray-600"}`} />
                          <span className="text-gray-400">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
