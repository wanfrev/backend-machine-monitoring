import app from "./app";
import dotenv from "dotenv";
import { pool } from "./db";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

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
const HEARTBEAT_TIMEOUT_MS = 1 * 60 * 1000; // 1 minuto
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
        // 1. Insertar evento machine_off en machine_events
        await pool.query(
          "INSERT INTO machine_events (machine_id, type, timestamp, data) VALUES ($1, $2, $3, $4)",
          [
            row.id,
            "machine_off",
            now.toISOString(),
            { auto: true, reason: "timeout" },
          ]
        );
        // Emitir evento y notificar push a suscriptores
        try {
          const machineRes = await pool.query(
            "SELECT * FROM machines WHERE id = $1",
            [row.id]
          );
          const machineRow = machineRes.rows[0];
          const io = app.get("io");
          if (io) {
            io.emit("machine_off", {
              machineId: row.id,
              machineName: machineRow?.name,
              location: machineRow?.location,
              data: { auto: true, reason: "timeout" },
              timestamp: now.toISOString(),
            });
          }
          try {
            const { sendNotificationToAll } = await import(
              "./utils/pushSubscriptions"
            );
            await sendNotificationToAll({
              title: "Máquina apagada",
              body: `${machineRow?.name ?? row.id} ${
                machineRow?.location ? `• ${machineRow.location}` : ""
              } — timeout`.trim(),
              data: {
                machineId: row.id,
                eventType: "machine_off",
                auto: true,
                reason: "timeout",
                timestamp: now.toISOString(),
              },
            });
          } catch (pushErr) {
            console.error("Error enviando notificación push (cron):", pushErr);
          }
        } catch (err) {
          console.error(
            "Error al emitir notificación cron para machine_off:",
            err
          );
        }
        // 2. Actualizar estado de la máquina
        await pool.query(
          "UPDATE machines SET status = 'inactive' WHERE id = $1",
          [row.id]
        );
        console.log(
          `⚠️ Máquina ${
            row.id
          } marcada como INACTIVA y evento machine_off registrado por falta de latido (${Math.round(
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

// Crear servidor HTTP y Socket.IO para notificaciones en tiempo real
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin:
      process.env.FRONTEND_ORIGIN || process.env.VUE_APP_FRONTEND_URL || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Hacer disponible io dentro de los controladores vía req.app.get("io")
app.set("io", io);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
