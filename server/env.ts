import dotenv from "dotenv";
import path from "path";

// Works in both ESM (tsx dev) and CJS (production bundle where import.meta.url is undefined)
const envPath = path.resolve(process.cwd(), ".env");

dotenv.config({ path: envPath, override: true });
