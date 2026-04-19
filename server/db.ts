import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { brainPulse } from "./services/sensory/BrainPulse";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error(
    "[DB] WARNING: DATABASE_URL not set. Database operations will fail. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: process.env.NODE_ENV === "production" ? 20 : 40,
  min: process.env.NODE_ENV === "production" ? 2 : 5,
  allowExitOnIdle: false,
  statement_timeout: 30000,
});

pool.on("error", (err) => {
  console.error("[DB] Pool error:", err.message);
});

pool.on("connect", () => {
  console.log("[DB] Pool connection established");
});

// === DB → 3D Brain pulse bridge ============================================
// Every SQL statement emits a pulse on the "hippocampus" zone (memory hub).
// Throttled internally by brainPulse (120ms per zone:source) to avoid noise.
const _origQuery = pool.query.bind(pool) as any;
(pool as any).query = function (...args: any[]) {
  try {
    const text = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
    const op = (text.trim().split(/\s+/)[0] || "QUERY").toUpperCase();
    // Skip the BrainPulse own writes & health pings to prevent loops/noise
    if (
      !/sensory_event|brain_pulse|^SELECT 1$|pg_stat|information_schema/i.test(
        text
      )
    ) {
      const isWrite = /^(INSERT|UPDATE|DELETE|UPSERT)/i.test(op);
      brainPulse(["hippocampus"], "db", `${op}`, {
        intensity: isWrite ? 2 : 1,
        autonomous: false,
      });
    }
  } catch {
    // never let pulse instrumentation break a query
  }
  return _origQuery(...args);
};

export const db = drizzle(pool, { schema });
