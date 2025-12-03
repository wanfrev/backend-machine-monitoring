import { Request, Response } from "express";
import { db } from "../utils/jsonDb";
import { MachineEvent } from "../models/types";

export const receiveData = (req: Request, res: Response) => {
  // Soportar tanto el formato original del backend
  // como el formato enviado por la Pico W.
  const {
    machineId: rawMachineId,
    event: rawEvent,
    data: rawData,
    timestamp,
    // Campos que vienen desde la Pico W
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

  // Verify machine exists
  const machine = db.machines.find((m) => m.id === machineId);
  if (!machine) {
    console.warn(`Received data from unknown machine: ${machineId}`);
    return res.status(404).json({ message: "Machine not found" });
  }

  // Mapear eventos específicos de la Pico a los tipos internos
  let internalEvent: MachineEvent['type'];
  if (event === "ENCENDIDO") internalEvent = "machine_on";
  else if (event === "APAGADO") internalEvent = "machine_off";
  else if (event === "MONEDA") internalEvent = "coin_inserted";
  else if (
    event === "coin_inserted" ||
    event === "machine_on" ||
    event === "machine_off" ||
    event === "game_start" ||
    event === "game_end" ||
    event === "ping"
  ) {
    internalEvent = event as MachineEvent['type'];
  } else {
    internalEvent = "ping";
  }

  // Construir data combinando el campo "data" original y la "cantidad" de la Pico
  const data: any = {
    ...rawData,
    cantidad,
  };

  // Update machine status
  machine.lastPing = new Date();
  if (internalEvent === "machine_on") machine.status = "active";
  if (internalEvent === "machine_off") machine.status = "inactive";

  // Create event record
  const newEvent: MachineEvent = {
    id: Math.random().toString(36).substr(2, 9),
    machineId,
    type: internalEvent,
    timestamp: timestamp || new Date().toISOString(),
    data,
  };

  db.events.push(newEvent);
  db.commit();

  console.log(`IoT Event: ${machineId} - ${internalEvent}`, data);

  res.status(200).json({ status: "ok" });
};

// Obtener todos los eventos IoT registrados
export const getEvents = (req: Request, res: Response) => {
  // Devuelve los últimos 100 eventos (puedes ajustar el límite)
  const events = db.events.slice(-100).reverse();
  res.json({ events });
};

// Obtener el estado de las máquinas (último ping y si están activas)
export const getStatus = (req: Request, res: Response) => {
  // Considera "conectada" si el último ping fue hace menos de 2 minutos
  const now = Date.now();
  const status = db.machines.map((machine) => {
    const lastPing = machine.lastPing
      ? new Date(machine.lastPing).getTime()
      : 0;
    const connected = lastPing && now - lastPing < 2 * 60 * 1000;
    return {
      id: machine.id,
      name: machine.name,
      status: machine.status,
      lastPing: machine.lastPing,
      connected,
    };
  });
  res.json({ status });
};
