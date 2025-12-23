import { Request, Response } from "express";
import { pool } from "../db";
import { MachineEvent } from "../models/types";

const HEARTBEAT_TIMEOUT_MS = Number(
  process.env.HEARTBEAT_TIMEOUT_MS || 1 * 60 * 1000
); // 1 minuto

export const receiveData = async (req: Request, res: Response) => {
  const {
    machineId: rawMachineId,
    event: rawEvent,
    data: rawData,
    timestamp,
    maquina_id,
    evento,
    cantidad,
  } = req.body as any;

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
  const data: any = { ...(rawData || {}) };
  if (typeof cantidadFinal !== "undefined") {
    data.cantidad = cantidadFinal;
  }

  // Actualizar status y last_ping de la máquina.
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
  const eventResult = await pool.query(
    "INSERT INTO machine_events (machine_id, type, timestamp, data) VALUES ($1, $2, $3, $4) RETURNING id",
    [machineId, internalEvent, timestamp || new Date().toISOString(), data]
  );

  // Si es evento de moneda, insertar en coins
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

      try {
        const io = req.app.get("io");
        if (io) {
          try {
            console.log(
              `Emitiendo socket coin_inserted -> machine=${machineId} eventId=${eventId}`
            );
            const emitStart = Date.now();
            io.emit("coin_inserted", {
              machineId,
              machineName: machineRow.name,
              location: machineRow.location,
              eventId,
              amount: data.cantidad ?? 1,
              timestamp: timestamp || new Date().toISOString(),
            });
            console.log(
              `Emitido coin_inserted (took ${
                Date.now() - emitStart
              }ms) -> machine=${machineId}`
            );
          } catch (e) {
            console.error("Error emitiendo coin_inserted:", e);
          }
        }
      } catch (socketErr) {
        console.error(
          "Error emitiendo evento coin_inserted por Socket.IO:",
          socketErr
        );
      }

      try {
        const { sendNotificationToAll } = await import(
          "../utils/pushSubscriptions"
        );
        // Fire-and-forget: don't block the HTTP handler while sending web-push
        (async () => {
          const start = Date.now();
          try {
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
            console.log(
              `Push notifications sent (took ${
                Date.now() - start
              }ms) for machine=${machineId}`
            );
          } catch (err) {
            console.error(
              "Error enviando notificación push (background):",
              err
            );
          }
        })();
      } catch (pushErr) {
        console.error("Error iniciando envío push:", pushErr);
      }
    } catch (err) {
      console.error("Error insertando en coins:", err);
    }
  }

  // Si es evento de encendido/apagado, emitir por Socket.IO y enviar push
  if (internalEvent === "machine_on" || internalEvent === "machine_off") {
    const eventId = eventResult.rows[0].id;
    try {
      const io = req.app.get("io");
      if (io) {
        io.emit(internalEvent, {
          machineId,
          machineName: machineRow.name,
          location: machineRow.location,
          eventId,
          data,
          timestamp: timestamp || new Date().toISOString(),
        });
      }
    } catch (socketErr) {
      console.error(
        `Error emitiendo evento ${internalEvent} por Socket.IO:`,
        socketErr
      );
    }

    try {
      const { sendNotificationToAll } = await import(
        "../utils/pushSubscriptions"
      );
      const ts = timestamp || new Date().toISOString();
      // Asegura que el timestamp se interprete como UTC si no tiene zona
      let dateObj: Date;
      if (
        typeof ts === "string" &&
        !ts.endsWith("Z") &&
        !ts.includes("+") &&
        !ts.includes("-") &&
        ts.length > 10
      ) {
        dateObj = new Date(ts + "Z");
      } else {
        dateObj = new Date(ts);
      }
      const timeStr = dateObj.toLocaleString("es-VE", {
        timeZone: "America/Caracas",
      });
      const actionText =
        internalEvent === "machine_on" ? "encendida" : "apagada";
      const bodyParts = [`${machineRow.name}`];
      if (machineRow.location) bodyParts.push(`• ${machineRow.location}`);
      bodyParts.push(`${actionText} (${timeStr})`);
      if (data?.reason) bodyParts.push(`— ${data.reason}`);

      await sendNotificationToAll({
        title:
          internalEvent === "machine_on"
            ? "Máquina encendida"
            : "Máquina apagada",
        body: bodyParts.join(" "),
        data: {
          machineId,
          eventId,
          eventType: internalEvent,
          ...data,
          timestamp: ts,
        },
      });
    } catch (pushErr) {
      console.error("Error enviando notificación push:", pushErr);
    }
  }

  // Si recibimos un PING y la máquina estaba marcada como inactive,
  // tratarlo como re-encendido automático: insertar evento machine_on,
  // emitir por Socket.IO y enviar notificación push (fire-and-forget).
  if (internalEvent === "ping" && machineRow.status !== "active") {
    try {
      const onTs = timestamp || new Date().toISOString();
      const onRes = await pool.query(
        "INSERT INTO machine_events (machine_id, type, timestamp, data) VALUES ($1, $2, $3, $4) RETURNING id",
        [machineId, "machine_on", onTs, { auto: true, reason: "ping" }]
      );
      const onEventId = onRes.rows[0].id;
      try {
        const io = req.app.get("io");
        if (io) {
          try {
            io.emit("machine_on", {
              machineId,
              machineName: machineRow.name,
              location: machineRow.location,
              eventId: onEventId,
              data: { auto: true, reason: "ping" },
              timestamp: onTs,
            });
            console.log(
              `Auto machine_on emitted due to ping -> machine=${machineId} eventId=${onEventId}`
            );
          } catch (emitErr) {
            console.error("Error emitiendo auto machine_on:", emitErr);
          }
        }
      } catch (ioErr) {
        console.error("Error accediendo a io para auto machine_on:", ioErr);
      }

      try {
        const { sendNotificationToAll } = await import(
          "../utils/pushSubscriptions"
        );
        (async () => {
          try {
            await sendNotificationToAll({
              title: "Máquina encendida",
              body: `${machineRow.name} ${
                machineRow.location ? `• ${machineRow.location}` : ""
              } — reconectada`.trim(),
              data: {
                machineId,
                eventId: onEventId,
                eventType: "machine_on",
                auto: true,
                reason: "ping",
                timestamp: onTs,
              },
            });
          } catch (pushErr) {
            console.error("Error enviando push auto machine_on:", pushErr);
          }
        })();
      } catch (pushInitErr) {
        console.error("Error iniciando push auto machine_on:", pushInitErr);
      }
    } catch (err) {
      console.error("Error insertando evento auto machine_on:", err);
    }
  }

  // Only log important events to keep logs clean (coins / on / off)
  // Enable ping logging by setting LOG_PINGS=true in the environment if you
  // want to see incoming ping messages in the server logs.
  const logPings =
    String(process.env.LOG_PINGS || "false").toLowerCase() === "true";
  const shouldLogEvent =
    ["coin_inserted", "machine_on", "machine_off"].includes(internalEvent) ||
    (internalEvent === "ping" && logPings);

  if (shouldLogEvent) {
    console.log(`IoT Event: ${machineId} - ${internalEvent}`, data);
  }
  res.status(200).json({ status: "ok" });
};

export const getEvents = async (req: Request, res: Response) => {
  try {
    const {
      range,
      startDate,
      endDate,
      page = "1",
      pageSize = "20",
      includePings = "false",
    } = req.query as any;

    const params: any[] = [];
    const where: string[] = [];

    const includePingEvents = String(includePings) === "true";

    // Rango: '7d' o '30d' -> calcular startDate
    if (range === "7d" || range === "30d") {
      const days = range === "7d" ? 7 : 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      params.push(since.toISOString());
      where.push(`timestamp >= $${params.length}`);
    }

    // Si envían startDate/endDate explícitos, usar esos (anulan range)
    if (startDate) {
      params.push(String(startDate));
      where.push(`timestamp >= $${params.length}`);
    }
    if (endDate) {
      // Add a small buffer to endDate to avoid excluding events that
      // occurred a few milliseconds after the provided endDate due to
      // clock differences or timestamp rounding on clients.
      try {
        const e = new Date(String(endDate));
        if (!Number.isNaN(e.getTime())) {
          e.setMilliseconds(e.getMilliseconds() + 1000); // +1s buffer
          params.push(e.toISOString());
        } else {
          params.push(String(endDate));
        }
      } catch (e) {
        params.push(String(endDate));
      }
      where.push(`timestamp <= $${params.length}`);
    }

    // Por defecto no incluir eventos 'ping' en el histórico para evitar ruido
    if (!includePingEvents) {
      where.push("type <> 'ping'");
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const p = Math.max(1, Number(page) || 1);
    const ps = Math.max(1, Math.min(1000, Number(pageSize) || 20));
    const offset = (p - 1) * ps;

    // total count for pagination
    const countSql = `SELECT COUNT(*) as cnt FROM machine_events ${whereSql}`;
    const countResult = await pool.query(countSql, params);
    const total = Number(countResult.rows[0]?.cnt ?? 0);

    const sql = `SELECT * FROM machine_events ${whereSql} ORDER BY timestamp DESC LIMIT $${
      params.length + 1
    } OFFSET $${params.length + 2}`;
    const sqlParams = params.concat([ps, offset]);
    const result = await pool.query(sql, sqlParams);
    // leave response as before (no debug logs)

    const totalPages = Math.max(1, Math.ceil(total / ps));

    res.json({
      events: result.rows,
      total,
      page: p,
      pageSize: ps,
      totalPages,
    });
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getStatus = async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    const result = await pool.query("SELECT * FROM machines");
    const status = result.rows.map((machine: any) => {
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
  }
};
