import { db } from "../db";
import { sql } from "drizzle-orm";

const HUBRISE_CLIENT_ID = process.env.HUBRISE_CLIENT_ID || "";
const HUBRISE_CLIENT_SECRET = process.env.HUBRISE_API_KEY || "";
const HUBRISE_API_BASE = "https://api.hubrise.com/v1";
const HUBRISE_OAUTH_BASE = "https://manager.hubrise.com/oauth2/v1";

interface HubriseToken {
  access_token: string;
  account_id?: string;
  location_id?: string;
  catalog_id?: string;
  customer_list_id?: string;
}

interface HubriseOrder {
  id: string;
  status: string;
  created_at: string;
  total: string;
  payment?: { type: string; amount: string }[];
  items?: { product_name: string; quantity: string; price: string; subtotal: string }[];
  customer?: { first_name?: string; last_name?: string; email?: string };
  service_type?: string;
  service_type_ref?: string;
  expected_time?: string;
  confirmed_time?: string;
  custom_fields?: Record<string, any>;
  channel?: string;
}

interface HubriseCatalogProduct {
  id: string;
  name: string;
  description?: string;
  ref?: string;
  skus?: { name: string; ref?: string; price: string }[];
  category_id?: string;
}

class HubriseService {
  private token: HubriseToken | null = null;
  private initialized = false;
  private allOrdersCache: { data: HubriseOrder[]; ts: number } | null = null;
  private summaryCache = new Map<string, { data: any; ts: number }>();
  private fetchPromise: Promise<HubriseOrder[]> | null = null;
  private syncPromise: Promise<void> | null = null;
  private static CACHE_TTL = 3 * 60 * 1000;

  async ensureTable() {
    if (this.initialized) return;
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hubrise_config (
        id SERIAL PRIMARY KEY,
        restaurant TEXT NOT NULL DEFAULT 'suguval',
        access_token TEXT NOT NULL,
        account_id TEXT,
        location_id TEXT,
        catalog_id TEXT,
        customer_list_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS hubrise_orders (
        id TEXT PRIMARY KEY,
        status TEXT,
        created_at TEXT,
        total TEXT,
        service_type TEXT,
        channel TEXT,
        data JSONB NOT NULL,
        synced_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_hubrise_orders_created ON hubrise_orders(created_at)`);
    this.initialized = true;
    console.log("[HubRise] Table ready");
    await this.loadToken();
  }

  private async loadToken() {
    const rows = await db.execute(sql`SELECT * FROM hubrise_config WHERE restaurant = 'suguval' ORDER BY id DESC LIMIT 1`);
    const row = (rows as any).rows?.[0];
    if (row) {
      this.token = {
        access_token: row.access_token,
        account_id: row.account_id,
        location_id: row.location_id,
        catalog_id: row.catalog_id,
        customer_list_id: row.customer_list_id,
      };
    }
  }

  isConnected(): boolean {
    return !!this.token?.access_token;
  }

  getStatus() {
    return {
      connected: this.isConnected(),
      account_id: this.token?.account_id || null,
      location_id: this.token?.location_id || null,
      catalog_id: this.token?.catalog_id || null,
      clientConfigured: !!HUBRISE_CLIENT_ID && !!HUBRISE_CLIENT_SECRET,
    };
  }

  getAuthorizeUrl(redirectUri: string): string {
    const scope = "location[orders.read,catalog.read,customer_list.read]";
    return `${HUBRISE_OAUTH_BASE}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(HUBRISE_CLIENT_ID)}&scope=${encodeURIComponent(scope)}`;
  }

  async handleCallback(code: string, redirectUri: string): Promise<HubriseToken> {
    const res = await fetch(`${HUBRISE_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: HUBRISE_CLIENT_ID,
        client_secret: HUBRISE_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HubRise token exchange failed: ${res.status} - ${err}`);
    }

    const data = await res.json() as HubriseToken;
    this.token = data;

    await db.execute(sql`
      INSERT INTO hubrise_config (restaurant, access_token, account_id, location_id, catalog_id, customer_list_id, updated_at)
      VALUES ('suguval', ${data.access_token}, ${data.account_id || null}, ${data.location_id || null}, ${data.catalog_id || null}, ${data.customer_list_id || null}, NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    console.log(`[HubRise] Connected: account=${data.account_id}, location=${data.location_id}`);
    return data;
  }

  private async apiGet(path: string, params?: Record<string, string>, retries = 2): Promise<any> {
    if (!this.token?.access_token) throw new Error("HubRise not connected");

    const url = new URL(`${HUBRISE_API_BASE}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(url.toString(), {
        headers: { "X-Access-Token": this.token.access_token },
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "2", 10);
        console.log(`[HubRise] Rate limited (429), retrying in ${retryAfter}s (attempt ${attempt + 1}/${retries + 1})`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue;
        }
        throw new Error(`HubRise API rate limited after ${retries + 1} attempts`);
      }

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`HubRise API error ${res.status}: ${err}`);
      }

      return res.json();
    }
  }

  async getAccount(): Promise<any> {
    return this.apiGet("/account");
  }

  async getLocation(): Promise<any> {
    return this.apiGet("/location");
  }

  private async syncNewOrders(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = (async () => {
      try {
        const latestRow = await db.execute(sql`SELECT created_at FROM hubrise_orders ORDER BY created_at DESC LIMIT 1`);
        const latestDate = (latestRow as any).rows?.[0]?.created_at;

        let cursorAfter: string | undefined;
        if (latestDate) {
          const lastTs = new Date(latestDate);
          lastTs.setHours(lastTs.getHours() - 2);
          cursorAfter = lastTs.toISOString();
        }

        const maxPages = 30;
        let totalNew = 0;
        let totalUpdated = 0;

        for (let page = 1; page <= maxPages; page++) {
          const qp: Record<string, string> = { count: "100" };
          if (cursorAfter) qp.after = cursorAfter;
          try {
            const batch = await this.apiGet("/location/orders", qp) as HubriseOrder[];
            if (!Array.isArray(batch) || batch.length === 0) break;

            for (const order of batch) {
              const res = await db.execute(sql`
                INSERT INTO hubrise_orders (id, status, created_at, total, service_type, channel, data)
                VALUES (${order.id}, ${order.status}, ${order.created_at}, ${order.total}, ${order.service_type || null}, ${order.channel || null}, ${JSON.stringify(order)}::jsonb)
                ON CONFLICT (id) DO UPDATE SET status = ${order.status}, total = ${order.total}, data = ${JSON.stringify(order)}::jsonb, synced_at = NOW()
              `);
              const rowCount = (res as any).rowCount || 0;
              if (rowCount > 0) totalUpdated++;
              totalNew++;
            }

            console.log(`[HubRise] sync page=${page} got ${batch.length} orders`);
            if (batch.length < 100) break;
            const lastDate = batch[batch.length - 1]?.created_at;
            if (!lastDate || lastDate === cursorAfter) break;
            cursorAfter = lastDate;
          } catch (e: any) {
            console.log(`[HubRise] sync page ${page} error: ${e.message}`);
            break;
          }
        }

        if (totalNew > 0) {
          console.log(`[HubRise] Synced ${totalNew} orders (${totalUpdated} upserted) to DB`);
          this.allOrdersCache = null;
          this.summaryCache.clear();
        } else {
          console.log(`[HubRise] No new orders to sync`);
        }
      } finally {
        this.syncPromise = null;
      }
    })();
    return this.syncPromise;
  }

  async forceSync(): Promise<void> {
    this.allOrdersCache = null;
    this.summaryCache.clear();
    this.fetchPromise = null;
    this.syncPromise = null;
    await this.syncNewOrders();
  }

  private async fetchAllOrders(): Promise<HubriseOrder[]> {
    if (this.allOrdersCache && Date.now() - this.allOrdersCache.ts < HubriseService.CACHE_TTL) {
      return this.allOrdersCache.data;
    }
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        await this.syncNewOrders();
      } catch (e: any) {
        console.log(`[HubRise] sync error: ${e.message}`);
      }

      const rows = await db.execute(sql`SELECT data FROM hubrise_orders ORDER BY created_at DESC`);
      const allOrders = ((rows as any).rows || []).map((r: any) => r.data as HubriseOrder);
      
      console.log(`[HubRise] Loaded ${allOrders.length} orders from DB`);
      if (allOrders.length > 0) {
        this.allOrdersCache = { data: allOrders, ts: Date.now() };
      }
      this.fetchPromise = null;
      return allOrders;
    })();

    return this.fetchPromise;
  }

  async getOrders(params: { after?: string; before?: string; status?: string; count?: number } = {}): Promise<HubriseOrder[]> {
    const all = await this.fetchAllOrders();

    const afterTs = params.after ? new Date(params.after).getTime() : null;
    const beforeTs = params.before ? new Date(params.before).getTime() : null;

    if (!afterTs && !beforeTs && !params.status) {
      return all;
    }

    return all.filter(o => {
      const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
      if (afterTs && ts < afterTs) return false;
      if (beforeTs && ts > beforeTs) return false;
      if (params.status && o.status !== params.status) return false;
      return true;
    });
  }

  async getOrdersSummary(from?: string, to?: string): Promise<{
    totalOrders: number;
    totalRevenue: number;
    avgTicket: number;
    byDay: Record<string, { orders: number; revenue: number }>;
    byServiceType: Record<string, { orders: number; revenue: number }>;
    byPaymentType: Record<string, number>;
  }> {
    const cacheKey = `summary|${from || ""}|${to || ""}`;
    const cached = this.summaryCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < HubriseService.CACHE_TTL) {
      return cached.data;
    }

    const afterParam = from ? `${from}T00:00:00+00:00` : undefined;
    const beforeParam = to ? `${to}T23:59:59+00:00` : undefined;
    const orders = await this.getOrders({ after: afterParam, before: beforeParam });

    const byDay: Record<string, { orders: number; revenue: number }> = {};
    const byServiceType: Record<string, { orders: number; revenue: number }> = {};
    const byPaymentType: Record<string, number> = {};
    let totalRevenue = 0;

    for (const o of orders) {
      const amount = parseFloat(o.total || "0");
      totalRevenue += amount;

      const day = o.created_at?.substring(0, 10) || "unknown";
      if (!byDay[day]) byDay[day] = { orders: 0, revenue: 0 };
      byDay[day].orders++;
      byDay[day].revenue += amount;

      const svc = o.service_type || "unknown";
      if (!byServiceType[svc]) byServiceType[svc] = { orders: 0, revenue: 0 };
      byServiceType[svc].orders++;
      byServiceType[svc].revenue += amount;

      if (o.payment) {
        for (const p of o.payment) {
          const pt = p.type || "other";
          byPaymentType[pt] = (byPaymentType[pt] || 0) + parseFloat(p.amount || "0");
        }
      }
    }

    const result = {
      totalOrders: orders.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgTicket: orders.length > 0 ? Math.round((totalRevenue / orders.length) * 100) / 100 : 0,
      byDay,
      byServiceType,
      byPaymentType,
    };
    if (result.totalOrders > 0) {
      this.summaryCache.set(cacheKey, { data: result, ts: Date.now() });
    }
    return result;
  }

  async getCatalog(): Promise<{ categories: any[]; products: HubriseCatalogProduct[] }> {
    const catalogId = this.token?.catalog_id;
    if (!catalogId) {
      const location = await this.getLocation();
      if (location?.catalog_id) {
        this.token!.catalog_id = location.catalog_id;
      } else {
        return { categories: [], products: [] };
      }
    }

    const cid = this.token!.catalog_id;
    const [categories, products] = await Promise.all([
      this.apiGet(`/catalogs/${cid}/categories`).catch(() => []),
      this.apiGet(`/catalogs/${cid}/products`).catch(() => []),
    ]);

    return { categories: categories || [], products: products || [] };
  }

  async disconnect() {
    await db.execute(sql`DELETE FROM hubrise_config WHERE restaurant = 'suguval'`);
    this.token = null;
    console.log("[HubRise] Disconnected");
  }
}

export const hubriseService = new HubriseService();
