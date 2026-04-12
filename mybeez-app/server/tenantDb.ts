import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as checklistSchema from "@shared/schema/checklist";
import { RESTAURANTS, type RestaurantConfig } from "@shared/restaurants";

const { Pool } = pg;

type TenantDb = ReturnType<typeof drizzle<typeof checklistSchema>>;

const pools = new Map<string, InstanceType<typeof Pool>>();
const dbs = new Map<string, TenantDb>();

export function getTenantDb(tenantId: string): TenantDb {
  if (dbs.has(tenantId)) return dbs.get(tenantId)!;

  const config = RESTAURANTS[tenantId];
  if (!config) throw new Error(`Unknown tenant: ${tenantId}`);

  if (!process.env.DATABASE_URL) {
    throw new Error("[TenantDB] DATABASE_URL not set");
  }

  // Build tenant-specific connection URL by replacing the DB name
  const baseUrl = new URL(process.env.DATABASE_URL);
  baseUrl.pathname = `/${config.dbName}`;

  const pool = new Pool({
    connectionString: baseUrl.toString(),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: process.env.NODE_ENV === "production" ? 15 : 8,
    min: 1,
    allowExitOnIdle: false,
    statement_timeout: 30000,
  });

  pool.on("error", (err) => {
    console.error(`[TenantDB:${tenantId}] Pool error:`, err.message);
  });

  const db = drizzle(pool, { schema: checklistSchema });
  pools.set(tenantId, pool);
  dbs.set(tenantId, db);

  console.log(`[TenantDB] Pool created for tenant: ${tenantId} → ${config.dbName}`);
  return db;
}

export async function closeTenantPools(): Promise<void> {
  for (const [tenantId, pool] of pools) {
    console.log(`[TenantDB] Closing pool for tenant: ${tenantId}`);
    await pool.end();
  }
  pools.clear();
  dbs.clear();
}

export type { TenantDb };
