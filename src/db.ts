import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString,
});

// Ensure each new client session uses America/Caracas for display/formatting
// This does not change stored UTC values, only the session timezone presentation.
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'America/Caracas'").catch(() => {
    /* ignore errors setting timezone */
  });
});
