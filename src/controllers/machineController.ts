// Ingresos diarios por máquina (para la gráfica de resumen)
export const getMachineDailyIncome = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;
  try {
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
      [id, startDate || null, endDate || null]
    );
    res.json(
      result.rows.map((r: any) => ({ date: r.date, income: Number(r.income) }))
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
      `SELECT machine_id, COUNT(*) AS total_coins FROM coins GROUP BY machine_id`
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

export const getMachines = (req: Request, res: Response) => {
  pool
    .query(
      `SELECT m.*,
        (SELECT timestamp FROM machine_events me WHERE me.machine_id = m.id AND me.type = 'machine_on' ORDER BY timestamp DESC LIMIT 1) AS last_on,
        (SELECT timestamp FROM machine_events me WHERE me.machine_id = m.id AND me.type = 'machine_off' ORDER BY timestamp DESC LIMIT 1) AS last_off
      FROM machines m`
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
      [id]
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

    const result = await pool.query(
      "INSERT INTO machines (id, name, status, location, last_ping) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [machineId, name, "inactive", location || "Unknown", new Date()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating machine:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const updateMachine = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, location, status, type } = req.body;

  const client = await pool.connect();
  try {
    // Fetch existing machine
    const existingRes = await client.query(
      "SELECT * FROM machines WHERE id = $1",
      [id]
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ message: "Machine not found" });
    }
    const existing = existingRes.rows[0] as Machine;

    // Infer old and new type (Boxeo vs Agilidad) — backend historically infers type from name
    const inferTypeFromName = (n: string) =>
      n && n.startsWith("Boxeo") ? "Boxeo" : "Agilidad";
    const oldType = inferTypeFromName(existing.name || "");
    const newType = type || (name ? inferTypeFromName(name) : oldType);

    // If type group didn't change, just update fields normally
    if (newType === oldType) {
      const result = await client.query(
        "UPDATE machines SET name = COALESCE($1, name), location = COALESCE($2, location), status = COALESCE($3, status) WHERE id = $4 RETURNING *",
        [name, location, status, id]
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
      "INSERT INTO machines (id, name, status, location, last_ping) SELECT $1, COALESCE($2, name), COALESCE($3, status), COALESCE($4, location), last_ping FROM machines WHERE id = $5",
      [newId, name, status, location, id]
    );

    // Migrate referencing rows to point to the new id
    await client.query(
      "UPDATE machine_events SET machine_id = $1 WHERE machine_id = $2",
      [newId, id]
    );
    await client.query(
      "UPDATE coins SET machine_id = $1 WHERE machine_id = $2",
      [newId, id]
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
      [id]
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
    const result = await pool.query(
      `SELECT *
       FROM machine_events
       WHERE machine_id = $1
         AND ($2::date IS NULL OR DATE(timestamp AT TIME ZONE 'America/Caracas') >= $2::date)
         AND ($3::date IS NULL OR DATE(timestamp AT TIME ZONE 'America/Caracas') <= $3::date)
       ORDER BY timestamp DESC`,
      [id, startDate || null, endDate || null]
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
    const result = await pool.query(
      `SELECT type, timestamp
       FROM machine_events
       WHERE machine_id = $1
         AND type IN ('machine_on', 'machine_off')
         AND ($2::date IS NULL OR DATE(timestamp) >= $2::date)
         AND ($3::date IS NULL OR DATE(timestamp) <= $3::date)
       ORDER BY timestamp ASC`,
      [id, startDate || null, endDate || null]
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

    for (const row of rows) {
      const tsIso = new Date(row.timestamp).toISOString();
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
  pool
    .query("SELECT * FROM machine_events WHERE machine_id = $1", [id])
    .then((result) => {
      const events = result.rows;
      const totalIncome = events
        .filter((e) => e.type === "coin_inserted")
        .reduce((sum, e) => sum + (e.data?.amount || 0), 0);
      const totalScore = events
        .filter((e) => e.type === "game_end")
        .reduce((sum, e) => sum + (e.data?.score || 0), 0);
      const activeSessions = events.filter(
        (e) => e.type === "game_start"
      ).length;
      const usageRate = events.length > 0 ? 45.5 : 0;
      res.json({ totalIncome, totalScore, activeSessions, usageRate });
    })
    .catch((err) => {
      console.error("Error fetching machine stats:", err);
      res.status(500).json({ message: "Server error" });
    });
};

export const getTotalCoins = async (req: Request, res: Response) => {
  try {
    console.log("[GET] /api/machines/coins/total");
    const result = await pool.query(
      "SELECT COALESCE(SUM((data->>'cantidad')::int), 0) AS total_coins FROM machine_events WHERE type = 'coin_inserted'"
    );
    const totalCoins = result.rows[0]?.total_coins ?? 0;
    console.log("Total coins computed:", totalCoins);
    res.json({ totalCoins });
  } catch (err) {
    console.error("Error fetching total coins:", err);
    res.status(500).json({ message: "Server error" });
  }
};
