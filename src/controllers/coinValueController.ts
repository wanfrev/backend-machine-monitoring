import { Request, Response } from "express";
import { pool } from "../db";

export const getCoinValues = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT type, value FROM coin_values ORDER BY type ASC",
    );
    const map: Record<string, number> = {};
    for (const row of result.rows as { type: string; value: string }[]) {
      const v = Number(row.value);
      if (!Number.isFinite(v)) continue;
      map[String(row.type)] = v;
    }
    return res.json(map);
  } catch (err) {
    console.error("Error fetching coin values:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const setCoinValue = async (req: Request, res: Response) => {
  const rawType = typeof req.params?.type === "string" ? req.params.type : "";
  const type = rawType.trim().toLowerCase();
  const value = Number(req.body?.value);

  if (!type) {
    return res.status(400).json({ message: "Type is required" });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ message: "Value must be a positive number" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO coin_values (type, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (type)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       RETURNING type, value`,
      [type, value],
    );
    const row = result.rows[0] as { type: string; value: string };
    return res.json({ type: row.type, value: Number(row.value) });
  } catch (err) {
    console.error("Error setting coin value:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
