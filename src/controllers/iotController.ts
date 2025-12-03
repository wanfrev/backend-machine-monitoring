import { Request, Response } from "express";
import { pool } from "../db";
import { MachineEvent } from "../models/types";

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

  const data: any = { ...rawData, cantidad };

  // Actualizar status y last_ping de la máquina
  await pool.query(
    "UPDATE machines SET last_ping = $1, status = $2 WHERE id = $3",
    [
      new Date(),
      internalEvent === "machine_on"
        ? "active"
        : internalEvent === "machine_off"
        ? "inactive"
        : machineResult.rows[0].status,
      machineId,
    ]
  );

  // Insertar evento
  await pool.query(
    "INSERT INTO machine_events (machine_id, type, timestamp, data) VALUES ($1, $2, $3, $4)",
    [machineId, internalEvent, timestamp || new Date().toISOString(), data]
  );

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

// Obtener el estado de las máquinas (último ping y si están activas)
export const getStatus = async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    const result = await pool.query("SELECT * FROM machines");
    const status = result.rows.map((machine) => {
      const lastPing = machine.last_ping
        ? new Date(machine.last_ping).getTime()
        : 0;
      const connected = lastPing && now - lastPing < 2 * 60 * 1000;
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
