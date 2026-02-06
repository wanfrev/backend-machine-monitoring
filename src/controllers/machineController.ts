// Ingresos diarios por máquina (para la gráfica de resumen)
export const getMachineDailyIncome = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;
  try {
    // Normalize and validate date query params to avoid passing invalid values
    // Accept either full date `YYYY-MM-DD` or month `YYYY-MM` (convert to month bounds).
    const asString = (v: any) => (typeof v === "string" ? v.trim() : "");
    let sd = asString(startDate) || null;
    let ed = asString(endDate) || null;

    const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const isYm = (s: string) => /^\d{4}-\d{2}$/.test(s);
    const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

    if (sd && isYm(sd)) {
      // convert YYYY-MM -> YYYY-MM-01
      sd = `${sd}-01`;
    } else if (sd && !isYmd(sd)) {
      sd = null;
    }

    if (ed && isYm(ed)) {
      // convert YYYY-MM -> last day of month
      const parts = ed.split("-").map((p) => Number(p));
      const y = parts[0] || 0;
      const m = parts[1] || 1;
      const last = daysInMonth(y, m);
      ed = `${ed}-${String(last).padStart(2, "0")}`;
    } else if (ed && !isYmd(ed)) {
      ed = null;
    }
    // Usar la tabla coins para contar monedas por día en zona horaria local.
    // Cada registro en coins representa una moneda insertada.
    // Ajustar aquí la zona horaria a la de tus máquinas/negocio.
    const result = await pool.query(
      `SELECT 
        DATE(timestamp AT TIME ZONE 'America/Caracas') AS date,
        COUNT(*) AS income
      FROM coins
      WHERE machine_id = $1
        AND ($2::date IS NULL OR DATE(timestamp AT TIME ZONE 'America/Caracas') >= $2::date)
        AND ($3::date IS NULL OR DATE(timestamp AT TIME ZONE 'America/Caracas') <= $3::date)
      GROUP BY DATE(timestamp AT TIME ZONE 'America/Caracas')
      ORDER BY DATE(timestamp AT TIME ZONE 'America/Caracas')`,
      [id, sd || null, ed || null],
    );
    res.json(
      result.rows.map((r: any) => ({ date: r.date, income: Number(r.income) })),
    );
  } catch (err) {
    console.error("Error fetching daily income for machine:", err);
    res.status(500).json({ message: "Server error" });
  }
};
// Devuelve el total de monedas agrupado por máquina
export const getCoinsByMachine = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT machine_id, COUNT(*) AS total_coins FROM coins GROUP BY machine_id`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching coins by machine:", err);
    res.status(500).json({ message: "Server error" });
  }
};
import { Request, Response } from "express";
import { pool } from "../db";
import { Machine } from "../models/types";

// Genera un ID secuencial en base al tipo de máquina
// Ej: "Boxeo" -> "Maquina_Boxeo_01", "Maquina_Boxeo_02", etc.
async function generateSequentialId(name: string): Promise<string> {
  // Inferir prefijo por nombre: asumimos que el nombre empieza por "Boxeo" o "Agilidad"
  const isBoxeo = name.startsWith("Boxeo");
  const tipo = isBoxeo ? "Boxeo" : "Agilidad";
  const prefix = isBoxeo ? "Maquina_Boxeo_" : "Maquina_Agilidad_";

  const result = await pool.query("SELECT id FROM machines WHERE id LIKE $1", [
    prefix + "%",
  ]);

  let maxNum = 0;
  for (const row of result.rows as { id: string }[]) {
    const match = row.id.match(/_(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  const next = (maxNum + 1).toString().padStart(2, "0");
  return `${prefix}${next}`;
}

function normalizeMachineTypeKey(
  input: unknown,
): "boxeo" | "agilidad" | "default" {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (raw.startsWith("box")) return "boxeo";
  if (raw.startsWith("agi")) return "agilidad";
  return "default";
}

function inferTypeKeyFromId(idStr: string): "boxeo" | "agilidad" | "default" {
  const s = String(idStr || "");
  if (s.includes("Maquina_Boxeo_")) return "boxeo";
  if (s.includes("Maquina_Agilidad_")) return "agilidad";
  return "default";
}

function inferTypeKeyFromName(name: string): "boxeo" | "agilidad" | "default" {
  const s = String(name || "").toLowerCase();
  if (s.includes("boxeo")) return "boxeo";
  if (s.includes("agilidad")) return "agilidad";
  return "default";
}

export const getMachines = (req: Request, res: Response) => {
  pool
    .query(
      `SELECT m.*,
        (SELECT timestamp FROM machine_events me WHERE me.machine_id = m.id AND me.type = 'machine_on' ORDER BY timestamp DESC LIMIT 1) AS last_on,
        (SELECT timestamp FROM machine_events me WHERE me.machine_id = m.id AND me.type = 'machine_off' ORDER BY timestamp DESC LIMIT 1) AS last_off
      FROM machines m`,
    )
    .then((result) => res.json(result.rows))
    .catch((err) => {
      console.error("Error fetching machines:", err);
      res.status(500).json({ message: "Server error" });
    });
};

export const getMachineById = (req: Request, res: Response) => {
  const { id } = req.params;
  pool
    .query(
      `SELECT m.*,
        (SELECT timestamp FROM machine_events me WHERE me.machine_id = m.id AND me.type = 'machine_on' ORDER BY timestamp DESC LIMIT 1) AS last_on,
        (SELECT timestamp FROM machine_events me WHERE me.machine_id = m.id AND me.type = 'machine_off' ORDER BY timestamp DESC LIMIT 1) AS last_off
      FROM machines m WHERE m.id = $1`,
      [id],
    )
    .then((result) => {
      if (result.rowCount === 0)
        return res.status(404).json({ message: "Machine not found" });
      res.json(result.rows[0]);
    })
    .catch((err) => {
      console.error("Error fetching machine:", err);
      res.status(500).json({ message: "Server error" });
    });
};

export const createMachine = async (req: Request, res: Response) => {
  const { name, location, id, type } = req.body;
  if (!name) return res.status(400).json({ message: "Name is required" });

  try {
    let machineId: string;
    if (id) {
      machineId = id;
    } else if (type) {
      // Prefer explicit type when provided
      const desiredNameForGeneration = type === "Boxeo" ? "Boxeo" : "Agilidad";
      machineId = await generateSequentialId(desiredNameForGeneration);
    } else {
      machineId = await generateSequentialId(name);
    }

    const typeKey =
      typeof type === "string" && type.trim()
        ? normalizeMachineTypeKey(type)
        : (inferTypeKeyFromId(machineId) ?? inferTypeKeyFromName(name));

    const result = await pool.query(
      "INSERT INTO machines (id, name, status, location, last_ping, type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [machineId, name, "inactive", location || "Unknown", new Date(), typeKey],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating machine:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateMachine = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, location, status, type, test_mode } = req.body;

  const client = await pool.connect();
  try {
    // Fetch existing machine
    const existingRes = await client.query(
      "SELECT * FROM machines WHERE id = $1",
      [id],
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ message: "Machine not found" });
    }
    const existing = existingRes.rows[0] as Machine;

    // Diagnostic logging
    console.log("[updateMachine] incoming payload:", {
      name,
      location,
      status,
      type,
      test_mode,
    });
    console.log("[updateMachine] existing machine:", existing);

    // Infer types: use existing.id to determine current group (more reliable than name)
    const inferGroupFromId = (idStr: string) =>
      idStr && idStr.includes("Maquina_Boxeo_") ? "Boxeo" : "Agilidad";
    const inferGroupFromName = (n: string) =>
      n && n.toLowerCase().includes("boxeo") ? "Boxeo" : "Agilidad";
    const normalizeGroup = (t: unknown) =>
      normalizeMachineTypeKey(t) === "boxeo" ? "Boxeo" : "Agilidad";

    const oldType = inferGroupFromId(existing.id || "");
    const newType = type
      ? normalizeGroup(type)
      : name
        ? inferGroupFromName(name)
        : oldType;
    const newTypeKey = type
      ? normalizeMachineTypeKey(type)
      : inferTypeKeyFromId(existing.id || "") ||
        inferTypeKeyFromName(name || "");

    console.log(
      "[updateMachine] inferred oldType from id:",
      oldType,
      "newType from payload/name:",
      newType,
    );

    // If type group didn't change, just update fields normally
    if (newType === oldType) {
      const result = await client.query(
        "UPDATE machines SET name = COALESCE($1, name), location = COALESCE($2, location), status = COALESCE($3, status), test_mode = COALESCE($4, test_mode), type = COALESCE($5, type) WHERE id = $6 RETURNING *",
        [
          name,
          location,
          status,
          typeof test_mode === "undefined" ? null : test_mode,
          newTypeKey,
          id,
        ],
      );
      return res.json(result.rows[0]);
    }

    // Type group changed: need to generate a new sequential id and migrate related rows
    // Generate a new id based on the (new) type
    const desiredNameForGeneration = newType === "Boxeo" ? "Boxeo" : "Agilidad";
    const newId = await generateSequentialId(desiredNameForGeneration);

    await client.query("BEGIN");
    // Insert a new machine row with new id and updated fields
    await client.query(
      "INSERT INTO machines (id, name, status, location, last_ping, test_mode, type) SELECT $1, COALESCE($2, name), COALESCE($3, status), COALESCE($4, location), last_ping, COALESCE($6, test_mode), $7 FROM machines WHERE id = $5",
      [
        newId,
        name,
        status,
        location,
        id,
        typeof test_mode === "undefined" ? null : test_mode,
        newTypeKey,
      ],
    );

    // Migrate referencing rows to point to the new id
    await client.query(
      "UPDATE machine_events SET machine_id = $1 WHERE machine_id = $2",
      [newId, id],
    );
    await client.query(
      "UPDATE coins SET machine_id = $1 WHERE machine_id = $2",
      [newId, id],
    );

    // Delete old machine row
    await client.query("DELETE FROM machines WHERE id = $1", [id]);

    await client.query("COMMIT");

    // Return newly inserted machine
    const fresh = await client.query("SELECT * FROM machines WHERE id = $1", [
      newId,
    ]);
    res.json(fresh.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error updating machine:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

export const deleteMachine = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM machines WHERE id = $1 RETURNING id",
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Machine not found" });
    }
    res.json({ message: "Machine deleted" });
  } catch (err) {
    console.error("Error deleting machine:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getMachineHistory = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;

  try {
    // Return machine events but only include coin events that have a corresponding
    // row in the `coins` table (i.e. real/recorded coins). This preserves
    // device-sent historical events while ensuring the UI shows only real coins.
    const result = await pool.query(
      `SELECT me.*
       FROM machine_events me
       WHERE me.machine_id = $1
         AND (me.type <> 'coin_inserted' OR EXISTS (SELECT 1 FROM coins c WHERE c.event_id = me.id))
         AND ($2::date IS NULL OR DATE(me.timestamp AT TIME ZONE 'America/Caracas') >= $2::date)
         AND ($3::date IS NULL OR DATE(me.timestamp AT TIME ZONE 'America/Caracas') <= $3::date)
       ORDER BY me.timestamp DESC`,
      [id, startDate || null, endDate || null],
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching machine history:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Devuelve los eventos de encendido/apagado con duración estimada por sesión
export const getMachinePowerLogs = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;
  try {
    // Use a consistent timezone when filtering by date to avoid day-shifts
    const result = await pool.query(
      `SELECT type, timestamp
       FROM machine_events
       WHERE machine_id = $1
         AND type IN ('machine_on', 'machine_off')
         AND ($2::date IS NULL OR DATE(timestamp AT TIME ZONE 'America/Caracas') >= $2::date)
         AND ($3::date IS NULL OR DATE(timestamp AT TIME ZONE 'America/Caracas') <= $3::date)
       ORDER BY timestamp ASC`,
      [id, startDate || null, endDate || null],
    );

    type RawRow = { type: string; timestamp: Date };
    type Log = {
      event: "Encendido" | "Apagado";
      ts: string;
      dur: number | null;
    };

    const rows = result.rows as RawRow[];
    const logs: Log[] = [];
    let lastOnIndex: number | null = null;

    // Helper: normalize various timestamp formats into an ISO UTC string
    const normalizeToIsoUtc = (v: any): string => {
      if (!v) return new Date().toISOString();
      if (v instanceof Date) return v.toISOString();
      const s = String(v);
      // If the string already contains timezone info, trust it
      if (s.endsWith("Z") || /[\+\-]\d{2}:?\d{2}/.test(s)) {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      // Otherwise assume the stored value is naive and append Z to treat as UTC
      const maybe = s + "Z";
      const d2 = new Date(maybe);
      if (!Number.isNaN(d2.getTime())) return d2.toISOString();
      return new Date().toISOString();
    };

    for (const row of rows) {
      const tsIso = normalizeToIsoUtc(row.timestamp);
      if (row.type === "machine_on") {
        logs.push({ event: "Encendido", ts: tsIso, dur: null });
        lastOnIndex = logs.length - 1;
      } else if (row.type === "machine_off") {
        // Evento de apagado
        if (lastOnIndex !== null) {
          const onTs = new Date(logs[lastOnIndex].ts).getTime();
          const offTs = new Date(tsIso).getTime();
          if (offTs > onTs) {
            const minutes = Math.round((offTs - onTs) / (1000 * 60));
            logs[lastOnIndex].dur = minutes;
          }
          lastOnIndex = null;
        }
        logs.push({ event: "Apagado", ts: tsIso, dur: null });
      }
    }

    res.json(logs);
  } catch (err) {
    console.error("Error fetching machine power logs:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getMachineStats = (req: Request, res: Response) => {
  const { id } = req.params;
  (async () => {
    try {
      // Fetch non-test events for computing sessions/scores
      const eventsRes = await pool.query(
        "SELECT * FROM machine_events WHERE machine_id = $1 AND NOT (data->>'test' = 'true')",
        [id],
      );
      const events = eventsRes.rows;

      // Compute totalIncome from the persisted `coins` table so only real coins are counted
      const coinsRes = await pool.query(
        "SELECT COUNT(*) AS cnt FROM coins WHERE machine_id = $1",
        [id],
      );
      const totalIncome = Number(coinsRes.rows[0]?.cnt ?? 0);

      const totalScore = events
        .filter((e) => e.type === "game_end")
        .reduce((sum, e) => sum + (e.data?.score || 0), 0);
      const activeSessions = events.filter(
        (e) => e.type === "game_start",
      ).length;
      const usageRate = events.length > 0 ? 45.5 : 0;
      res.json({ totalIncome, totalScore, activeSessions, usageRate });
    } catch (err) {
      console.error("Error fetching machine stats:", err);
      res.status(500).json({ message: "Server error" });
    }
  })();
};

export const getTotalCoins = async (req: Request, res: Response) => {
  try {
    console.log("[GET] /api/machines/coins/total");
    // Count persisted coins (we avoid inserting coins for machines in test_mode)
    const result = await pool.query(
      "SELECT COUNT(*) AS total_coins FROM coins",
    );
    const totalCoins = Number(result.rows[0]?.total_coins ?? 0);
    console.log("Total coins computed:", totalCoins);
    res.json({ totalCoins });
  } catch (err) {
    console.error("Error fetching total coins:", err);
    res.status(500).json({ message: "Server error" });
  }
};
