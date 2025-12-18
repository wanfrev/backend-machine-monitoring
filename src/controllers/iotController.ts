import { Request, Response } from "express";
import { pool } from "../db";
import { MachineEvent } from "../models/types";

const HEARTBEAT_TIMEOUT_MS = 1 * 60 * 1000; // 1 minuto

export const receiveData = async (req: Request, res: Response) => {
  const {
    machineId: rawMachineId,
    event: rawEvent,
    data: rawData,
    timestamp,
    maquina_id,
    evento,
    cantidad,
  } = req.body;

  const machineId = rawMachineId || maquina_id;
  const event = (rawEvent || evento) as string;

  if (!machineId || !event) {
    return res
      .status(400)
      .json({ message: "Missing machineId/maquina_id or event/evento" });
  }

  // Verificar que la máquina existe
  const machineResult = await pool.query(
    "SELECT * FROM machines WHERE id = $1",
    [machineId]
  );
  if (machineResult.rowCount === 0) {
    console.warn(`Received data from unknown machine: ${machineId}`);
    return res.status(404).json({ message: "Machine not found" });
  }

  // Mapear eventos
  let internalEvent: string;
  if (event === "ENCENDIDO") internalEvent = "machine_on";
  else if (event === "APAGADO") internalEvent = "machine_off";
  else if (event === "MONEDA") internalEvent = "coin_inserted";
  else if (
    [
      "coin_inserted",
      "machine_on",
      "machine_off",
      "game_start",
      "game_end",
      "ping",
    ].includes(event)
  ) {
    internalEvent = event;
  } else {
    internalEvent = "ping";
  }

  // Unificar cantidad: si viene en rawData.cantidad, cantidad, o ninguna
  let cantidadFinal = cantidad;
  if (rawData && typeof rawData.cantidad !== "undefined") {
    cantidadFinal = rawData.cantidad;
  }
  const data: any = { ...rawData };
  if (typeof cantidadFinal !== "undefined") {
    data.cantidad = cantidadFinal;
  }

  // Actualizar status y last_ping de la máquina.
  // Regla:
  // - ENCENDIDO o ping => status = 'active'
  // - APAGADO         => status = 'inactive'
  // - Otros eventos   => mantienen el status actual
  const now = new Date();
  const machineRow = machineResult.rows[0];
  let newStatus = machineRow.status as string;
  if (internalEvent === "machine_on" || internalEvent === "ping") {
    newStatus = "active";
  } else if (internalEvent === "machine_off") {
    newStatus = "inactive";
  }

  await pool.query(
    "UPDATE machines SET last_ping = $1, status = $2 WHERE id = $3",
    [now, newStatus, machineId]
  );

  // Insertar evento
  // Insertar evento y obtener el id
  const eventResult = await pool.query(
    "INSERT INTO machine_events (machine_id, type, timestamp, data) VALUES ($1, $2, $3, $4) RETURNING id",
    [machineId, internalEvent, timestamp || new Date().toISOString(), data]
  );

  // Si es evento de moneda, insertar en coins (con manejo de errores y logs)
  if (internalEvent === "coin_inserted") {
    const eventId = eventResult.rows[0].id;
    try {
      await pool.query(
        "INSERT INTO coins (machine_id, event_id) VALUES ($1, $2)",
        [machineId, eventId]
      );
      console.log(
        `Coin registrada: machine_id=${machineId}, event_id=${eventId}`
      );

      // Notificación en tiempo real vía Socket.IO (si está configurado)
      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("coin_inserted", {
            machineId,
            machineName: machineRow.name,
            location: machineRow.location,
            eventId,
            amount: data.cantidad ?? 1,
            timestamp: timestamp || new Date().toISOString(),
          });
        }
      } catch (socketErr) {
        console.error(
          "Error emitiendo evento coin_inserted por Socket.IO:",
          socketErr
        );
      }
      // Enviar notificación push a suscriptores (si VAPID configurado)
      try {
        const { sendNotificationToAll } = await import(
          "../utils/pushSubscriptions"
        );
        await sendNotificationToAll({
          title: "Moneda ingresada",
          body: `${machineRow.name} ${
            machineRow.location ? `• ${machineRow.location}` : ""
          }`.trim(),
          data: {
            machineId,
            eventId,
            amount: data.cantidad ?? 1,
            timestamp: timestamp || new Date().toISOString(),
          },
        });
      } catch (pushErr) {
        console.error("Error enviando notificación push:", pushErr);
      }
    } catch (err) {
      console.error("Error insertando en coins:", err);
    }
  }

  console.log(`IoT Event: ${machineId} - ${internalEvent}`, data);
  res.status(200).json({ status: "ok" });
};

// Obtener todos los eventos IoT registrados
export const getEvents = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM machine_events ORDER BY timestamp DESC LIMIT 100"
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Obtener el último evento coin_inserted (útil para Service Worker fallback)
export const getLatestEvent = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT me.*, m.name as machine_name, m.location as machine_location FROM machine_events me JOIN machines m ON m.id = me.machine_id WHERE me.type = 'coin_inserted' ORDER BY me.timestamp DESC LIMIT 1"
    );
    if (result.rowCount === 0) return res.json({ event: null });
    const row = result.rows[0];
    res.json({
      event: {
        id: row.id,
        machine_id: row.machine_id,
        type: row.type,
        timestamp: row.timestamp,
        data: row.data,
        machine_name: row.machine_name,
        machine_location: row.machine_location,
      },
    });
  } catch (err) {
    console.error('Error fetching latest event:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Obtener el estado de las máquinas (último ping y si están activas)
export const getStatus = async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    const result = await pool.query("SELECT * FROM machines");
    const status = result.rows.map((machine) => {
      const lastPing = machine.last_ping
        ? new Date(machine.last_ping).getTime()
        : 0;
      const connected = lastPing && now - lastPing < HEARTBEAT_TIMEOUT_MS;
      return {
        id: machine.id,
        name: machine.name,
        status: machine.status,
        lastPing: machine.last_ping,
        connected,
      };
    });
    res.json({ status });
  } catch (err) {
    console.error("Error fetching machine status:", err);
    res.status(500).json({ message: "Server error" });
  }
};
