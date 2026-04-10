import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("[DB] WARNING: DATABASE_URL not set. Database operations will fail.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: process.env.NODE_ENV === "production" ? 20 : 10,
  min: 2,
  allowExitOnIdle: false,
  statement_timeout: 30000,
});

pool.on("error", (err) => {
  console.error("[DB] Pool error:", err.message);
});

pool.on("connect", () => {
  console.log("[DB] Pool connection established");
});

export const db = drizzle(pool, { schema });
