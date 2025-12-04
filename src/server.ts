import app from "./app";
import dotenv from "dotenv";
import { pool } from "./db";

dotenv.config();

const PORT = process.env.PORT || 3000;

// Verificar conexión a PostgreSQL al iniciar
pool
  .query("SELECT 1")
  .then(() => console.log("✅ Conexión a PostgreSQL exitosa"))
  .catch((err: unknown) =>
    console.error("❌ Error de conexión a PostgreSQL:", err)
  );

// Cron simple en memoria: marca máquinas como inactivas si no han enviado PING reciente
const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos
const HEARTBEAT_CHECK_INTERVAL_MS = 60 * 1000; // cada 1 minuto

async function markStaleMachinesInactive() {
  try {
    const now = new Date();
    const result = await pool.query(
      "SELECT id, last_ping FROM machines WHERE status = 'active'"
    );

    for (const row of result.rows as { id: string; last_ping: Date | null }[]) {
      if (!row.last_ping) continue;
      const diff = now.getTime() - new Date(row.last_ping).getTime();
      if (diff > HEARTBEAT_TIMEOUT_MS) {
        await pool.query(
          "UPDATE machines SET status = 'inactive' WHERE id = $1",
          [row.id]
        );
        console.log(
          `⚠️ Máquina ${
            row.id
          } marcada como INACTIVA por falta de latido (${Math.round(
            diff / 1000
          )}s sin PING).`
        );
      }
    }
  } catch (err) {
    console.error("Error actualizando estado de máquinas inactivas:", err);
  }
}

setInterval(markStaleMachinesInactive, HEARTBEAT_CHECK_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
