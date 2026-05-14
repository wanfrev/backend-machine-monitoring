import { Response } from "express";
import { pool } from "../db";
import type { AuthRequest } from "../middleware/authMiddleware";

const isSupervisorJobRole = (jobRole: unknown) => {
  const jr = typeof jobRole === "string" ? jobRole.trim().toLowerCase() : "";
  return /\bsupervisor\b/.test(jr);
};

async function getAuthUser(userId: number) {
  const result = await pool.query(
    `SELECT id, role, job_role AS "jobRole" FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] as
    | { id: number; role: "admin" | "employee"; jobRole: string | null }
    | undefined;
}

function canManageExchangeRate(user: {
  role: "admin" | "employee";
  jobRole: string | null;
}) {
  return user.role === "admin" || isSupervisorJobRole(user.jobRole);
}

export const getExchangeRate = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT rate, updated_at AS "updatedAt"
       FROM exchange_rate_config
       WHERE id = 1`,
    );
    const row = result.rows[0] as
      | { rate: string | number; updatedAt: string }
      | undefined;
    if (!row) {
      return res.status(404).json({ message: "Exchange rate not configured" });
    }
    return res.json({
      rate: Number(row.rate),
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    console.error("Error fetching exchange rate:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const updateExchangeRate = async (req: AuthRequest, res: Response) => {
  const authUserId = Number(req.user?.id);
  if (!Number.isFinite(authUserId)) {
    return res.status(401).json({ message: "Access token required" });
  }

  const authUser = await getAuthUser(authUserId);
  if (!authUser) {
    return res.status(401).json({ message: "User not found" });
  }
  if (!canManageExchangeRate(authUser)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const rate = Number(req.body?.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ message: "Rate must be a positive number" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO exchange_rate_config (id, rate, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id)
       DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()
       RETURNING rate, updated_at AS "updatedAt"`,
      [rate],
    );
    const row = result.rows[0] as { rate: string | number; updatedAt: string };
    return res.json({
      rate: Number(row.rate),
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    console.error("Error updating exchange rate:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
