import { Request, Response } from "express";
import { pool } from "../db";
import { Machine } from "../models/types";

const generateId = () =>
  "M-" + Math.random().toString(36).substr(2, 6).toUpperCase();

export const getMachines = (req: Request, res: Response) => {
  pool
    .query("SELECT * FROM machines")
    .then((result) => res.json(result.rows))
    .catch((err) => {
      console.error("Error fetching machines:", err);
      res.status(500).json({ message: "Server error" });
    });
};

export const getMachineById = (req: Request, res: Response) => {
  const { id } = req.params;
  pool
    .query("SELECT * FROM machines WHERE id = $1", [id])
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

export const createMachine = (req: Request, res: Response) => {
  const { name, location, id } = req.body;
  if (!name) return res.status(400).json({ message: "Name is required" });
  const machineId = id || generateId();
  pool
    .query(
      "INSERT INTO machines (id, name, status, location, last_ping) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [machineId, name, "inactive", location || "Unknown", new Date()]
    )
    .then((result) => res.status(201).json(result.rows[0]))
    .catch((err) => {
      console.error("Error creating machine:", err);
      res.status(500).json({ message: "Server error" });
    });
};

export const updateMachine = (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, location, status } = req.body;
  pool
    .query(
      "UPDATE machines SET name = COALESCE($1, name), location = COALESCE($2, location), status = COALESCE($3, status) WHERE id = $4 RETURNING *",
      [name, location, status, id]
    )
    .then((result) => {
      if (result.rowCount === 0)
        return res.status(404).json({ message: "Machine not found" });
      res.json(result.rows[0]);
    })
    .catch((err) => {
      console.error("Error updating machine:", err);
      res.status(500).json({ message: "Server error" });
    });
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

export const getMachineHistory = (req: Request, res: Response) => {
  const { id } = req.params;
  pool
    .query(
      "SELECT * FROM machine_events WHERE machine_id = $1 ORDER BY timestamp DESC",
      [id]
    )
    .then((result) => res.json(result.rows))
    .catch((err) => {
      console.error("Error fetching machine history:", err);
      res.status(500).json({ message: "Server error" });
    });
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
