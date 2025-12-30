import { Request, Response } from "express";
import { pool } from "../db";
import { MachineEvent } from "../models/types";

const HEARTBEAT_TIMEOUT_MS = Number(
  process.env.HEARTBEAT_TIMEOUT_MS || 2 * 60 * 1000
); // 2 minutos

export const receiveData = async (req: Request, res: Response) => {
  try {
    const {
      machineId: rawMachineId,
      event: rawEvent,
      data: rawData,
      timestamp,
      maquina_id,
      evento,
      cantidad,
    } = req.body || ({} as any);

    const machineId = rawMachineId || maquina_id;
    const event = rawEvent || evento;

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
      internalEvent = event as string;
    } else {
      internalEvent = "ping";
    }

    // Unificar cantidad: si viene en rawData.cantidad, cantidad, o ninguna
    let cantidadFinal = cantidad as any;
    if (rawData && typeof rawData.cantidad !== "undefined") {
      cantidadFinal = rawData.cantidad;
    }
    let data: any = { ...(rawData || {}) };
    if (typeof cantidadFinal !== "undefined") {
      data.cantidad = cantidadFinal;
    }

    // Normalize incoming timestamp values to ISO UTC.
    const TZ_OFFSET_HOURS = -4; // America/Caracas (no DST currently)
    const normalizeTimestamp = (v: any) => {
      if (!v) return new Date().toISOString();
      if (v instanceof Date) return v.toISOString();
      const s = String(v).trim();
      if (s === "") return new Date().toISOString();
      // If already contains timezone info, trust JS Date to parse it
      if (s.endsWith("Z") || /[\+\-]\d{2}:?\d{2}/.test(s)) {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      // Try parse common formats like YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD HH:MM
      const m = s.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
      );
      if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const hh = Number(m[4] || 0);
        const mm = Number(m[5] || 0);
        const ss = Number(m[6] || 0);
        // Treat parsed components as America/Caracas local time (UTC-4)
        const utcMs =
          Date.UTC(y, mo - 1, d, hh, mm, ss) - TZ_OFFSET_HOURS * 3600 * 1000;
        return new Date(utcMs).toISOString();
      }
      // Fallback: let Date try to parse and convert to ISO
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
      return new Date().toISOString();
    };

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
      [now.toISOString(), newStatus, machineId]
    );

    // Mark event as test if the machine is in test_mode (don't count coins)
    if (machineRow.test_mode) {
      data = { ...(data || {}), test: true };
    }

    // Normalize timestamp for the incoming event early so we can use it for dedupe checks
    const normalizedTs = normalizeTimestamp(timestamp);

    // --- Deduplication / idempotency for coin events ---
    // Prefer an explicit `id_unico` sent by the device. If provided,
    // ignore duplicates that already have a machine_events row with the same id.
    // If no id is provided, use a short time-window based dedupe (CONFIG: COIN_DEDUP_MS)
    const COIN_DEDUP_MS = Number(process.env.COIN_DEDUP_MS || 3000);
    // Ensure any top-level id_unico is available inside data for persistence and queries
    const incomingUniqueId =
      (req.body && (req.body.id_unico || req.body.idUnique)) ||
      data?.id_unico ||
      data?.idUnique;
    if (internalEvent === "coin_inserted") {
      if (incomingUniqueId) {
        const dupCheck = await pool.query(
          `SELECT id FROM machine_events WHERE machine_id = $1 AND type = 'coin_inserted' AND (data->>'id_unico') = $2 LIMIT 1`,
          [machineId, String(incomingUniqueId)]
        );
        if ((dupCheck?.rowCount ?? 0) > 0) {
          console.log(
            `Ignored duplicate coin (id_unico=${incomingUniqueId}) for machine=${machineId}`
          );
          return res.status(200).json({
            status: "ok",
            ignored: "duplicate",
            id_unico: incomingUniqueId,
          });
        }
        // ensure the id is present inside the data object we persist
        data = { ...(data || {}), id_unico: incomingUniqueId };
      } else {
        // time-window dedupe: ignore if last coin_inserted for this machine is very recent
        try {
          const lastRes = await pool.query(
            "SELECT timestamp FROM machine_events WHERE machine_id = $1 AND type = 'coin_inserted' ORDER BY timestamp DESC LIMIT 1",
            [machineId]
          );
          if ((lastRes?.rowCount ?? 0) > 0) {
            const lastTs = new Date(lastRes.rows[0].timestamp).getTime();
            const newTs = new Date(normalizedTs).getTime();
            if (Math.abs(newTs - lastTs) < COIN_DEDUP_MS) {
              console.log(
                `Ignored coin due to rate dedupe (delta=${Math.abs(
                  newTs - lastTs
                )}ms) for machine=${machineId}`
              );
              return res.status(200).json({
                status: "ok",
                ignored: "rate_limit",
                deltaMs: Math.abs(newTs - lastTs),
              });
            }
          }
        } catch (e) {
          console.error("Error during coin dedupe check:", e);
        }
      }
    }

    // Insertar evento
    const eventResult = await pool.query(
      "INSERT INTO machine_events (machine_id, type, timestamp, data) VALUES ($1, $2, $3, $4) RETURNING id",
      [machineId, internalEvent, normalizedTs, data]
    );

    // Si es evento de moneda, insertar en coins
    if (internalEvent === "coin_inserted") {
      const eventId = eventResult.rows[0].id;
      try {
        // Do not persist coins if the machine is in test_mode
        // or if the machine was not marked as active (likely a startup ghost coin).
        if (machineRow.test_mode || machineRow.status !== "active") {
          console.log(
            `Coin ignorada (test_mode=${!!machineRow.test_mode} or inactive before event): machine_id=${machineId}, event_id=${eventId}`
          );
        } else {
          // Persist coin and include unique_id when available to enforce idempotency at DB level.
          const uniqueIdForCoin =
            (data && (data.id_unico || data.idUnique)) || null;
          const insertRes = await pool.query(
            "INSERT INTO coins (machine_id, event_id, unique_id) VALUES ($1, $2, $3) ON CONFLICT (machine_id, unique_id) DO NOTHING RETURNING id",
            [machineId, eventId, uniqueIdForCoin]
          );
          if (insertRes.rowCount === 0) {
            console.log(
              `Coin duplicada ignorada por ON CONFLICT: machine_id=${machineId}, unique_id=${uniqueIdForCoin}, event_id=${eventId}`
            );
          } else {
            console.log(
              `Coin registrada: machine_id=${machineId}, event_id=${eventId}`
            );
          }

          try {
            const io = req.app.get("io");
            if (io) {
              io.emit("coin_inserted", {
                machineId,
                machineName: machineRow.name,
                location: machineRow.location,
                eventId,
                amount: data.cantidad ?? 1,
                timestamp: normalizedTs,
                test: !!machineRow.test_mode,
              });
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
            await sendNotificationToAll({
              title: "Moneda ingresada",
              body: `${machineRow.name} ${
                machineRow.location ? `• ${machineRow.location}` : ""
              }`.trim(),
              data: {
                machineId,
                eventId,
                amount: data.cantidad ?? 1,
                timestamp: normalizedTs,
              },
            });
          } catch (pushErr) {
            console.error("Error enviando notificación push:", pushErr);
          }
        }
      } catch (err) {
        console.error("Error insertando en coins:", err);
      }
    }

    // Si recibimos un PING y la máquina estaba marcada como inactive,
    // tratarlo como re-encendido automático: insertar evento machine_on,
    // emitir por Socket.IO y enviar notificación push (fire-and-forget).
    if (internalEvent === "ping" && machineRow.status !== "active") {
      try {
        const onTs = normalizeTimestamp(timestamp);
        const onRes = await pool.query(
          "INSERT INTO machine_events (machine_id, type, timestamp, data) VALUES ($1, $2, $3, $4) RETURNING id",
          [machineId, "machine_on", onTs, { auto: true, reason: "ping" }]
        );
        const onEventId = onRes.rows[0].id;
        try {
          const io = req.app.get("io");
          if (io) {
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
          }
        } catch (emitErr) {
          console.error("Error emitiendo auto machine_on:", emitErr);
        }

        try {
          const { sendNotificationToAll } = await import(
            "../utils/pushSubscriptions"
          );
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
      } catch (err) {
        console.error("Error insertando evento auto machine_on:", err);
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
            timestamp: normalizedTs,
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
        const ts = normalizedTs;
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

    // Only log important events to keep logs clean (coins / on / off / ping)
    const shouldLogEvent = [
      "coin_inserted",
      "machine_on",
      "machine_off",
      "ping",
    ].includes(internalEvent);

    if (shouldLogEvent) {
      console.log(`IoT Event: ${machineId} - ${internalEvent}`, data);
    }

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Error en receiveData:", err);
    res.status(500).json({ message: "Server error" });
  }
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
      // Normalize startDate: accept both full ISO and date-only (YYYY-MM-DD).
      try {
        const raw = String(startDate);
        const parts = raw.split("-").map(Number);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && parts.length === 3) {
          // Treat date-only as local start of day to avoid timezone-shift bugs
          const s = new Date(
            parts[0],
            (parts[1] || 1) - 1,
            parts[2],
            0,
            0,
            0,
            0
          );
          params.push(s.toISOString());
        } else {
          const s = new Date(raw);
          if (!Number.isNaN(s.getTime())) params.push(s.toISOString());
          else params.push(raw);
        }
      } catch (err) {
        params.push(String(startDate));
      }
      where.push(`timestamp >= $${params.length}`);
    }
    if (endDate) {
      // Normalize endDate similarly and include end-of-day (local) so that
      // selecting the same day for from/to returns that day's events.
      try {
        const raw = String(endDate);
        const parts = raw.split("-").map(Number);
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && parts.length === 3) {
          const t = new Date(
            parts[0],
            (parts[1] || 1) - 1,
            parts[2],
            23,
            59,
            59,
            999
          );
          // small buffer to tolerate clock skew
          t.setMilliseconds(t.getMilliseconds() + 1000);
          params.push(t.toISOString());
        } else {
          const e = new Date(raw);
          if (!Number.isNaN(e.getTime())) {
            e.setMilliseconds(e.getMilliseconds() + 1000);
            params.push(e.toISOString());
          } else {
            params.push(raw);
          }
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
