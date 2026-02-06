import { Request, Response } from "express";
import { pool } from "../db";
import type { AuthRequest } from "../middleware/authMiddleware";

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

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

async function getUserMachineIds(userId: number): Promise<string[]> {
  const result = await pool.query(
    `SELECT COALESCE(JSON_AGG(machine_id), '[]'::json) AS "ids"
     FROM user_machines
     WHERE user_id = $1`,
    [userId],
  );
  return (result.rows[0]?.ids as string[]) ?? [];
}

export const upsertDailySale = async (req: AuthRequest, res: Response) => {
  const authUserId = Number(req.user?.id);
  if (!Number.isFinite(authUserId)) {
    return res.status(401).json({ message: "Access token required" });
  }

  const machineId =
    typeof req.body?.machineId === "string" ? req.body.machineId : "";
  const date = typeof req.body?.date === "string" ? req.body.date : "";
  const coinsRaw = req.body?.coins;
  const recordMessage =
    typeof req.body?.recordMessage === "string" ? req.body.recordMessage : null;
  const prizeBsRaw = req.body?.prizeBs;

  const coins = Number(coinsRaw);
  const prizeBs =
    prizeBsRaw === null ||
    typeof prizeBsRaw === "undefined" ||
    prizeBsRaw === ""
      ? null
      : Number(prizeBsRaw);

  const requestedEmployeeIdRaw = req.body?.employeeId;
  const requestedEmployeeId =
    typeof requestedEmployeeIdRaw === "undefined" ||
    requestedEmployeeIdRaw === null
      ? null
      : Number(requestedEmployeeIdRaw);

  if (
    !machineId ||
    !date ||
    !isYmd(date) ||
    !Number.isFinite(coins) ||
    coins < 0
  ) {
    return res.status(400).json({ message: "Invalid payload" });
  }
  if (prizeBs !== null && (!Number.isFinite(prizeBs) || prizeBs < 0)) {
    return res.status(400).json({ message: "Invalid prizeBs" });
  }

  const authUser = await getAuthUser(authUserId);
  if (!authUser) {
    return res.status(401).json({ message: "User not found" });
  }

  const employeeId =
    authUser.role === "admin"
      ? (requestedEmployeeId ?? authUserId)
      : authUserId;

  // Enforce that non-admin users can only log for themselves.
  if (authUser.role !== "admin" && employeeId !== authUserId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  // Enforce machine assignment for non-admin users.
  if (authUser.role !== "admin") {
    const myMachineIds = await getUserMachineIds(authUserId);
    if (!myMachineIds.includes(machineId)) {
      return res.status(403).json({ message: "Machine not assigned" });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO employee_daily_sales (
        employee_id,
        machine_id,
        sale_date,
        coins,
        record_message,
        prize_bs
      ) VALUES ($1, $2, $3::date, $4, $5, $6)
      ON CONFLICT (employee_id, machine_id, sale_date)
      DO UPDATE SET
        coins = EXCLUDED.coins,
        record_message = EXCLUDED.record_message,
        prize_bs = EXCLUDED.prize_bs,
        updated_at = NOW()
      RETURNING
        id,
        employee_id AS "employeeId",
        machine_id AS "machineId",
        sale_date AS "date",
        coins,
        record_message AS "recordMessage",
        prize_bs AS "prizeBs",
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [employeeId, machineId, date, coins, recordMessage, prizeBs],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Error upserting daily sale:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const listDailySales = async (req: AuthRequest, res: Response) => {
  const authUserId = Number(req.user?.id);
  if (!Number.isFinite(authUserId)) {
    return res.status(401).json({ message: "Access token required" });
  }

  const asString = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const startDate = asString(req.query?.startDate) || null;
  const endDate = asString(req.query?.endDate) || null;
  const machineId = asString(req.query?.machineId) || null;
  const employeeIdRaw = asString(req.query?.employeeId);
  const employeeId = employeeIdRaw ? Number(employeeIdRaw) : null;

  if (startDate && !isYmd(startDate)) {
    return res.status(400).json({ message: "Invalid startDate" });
  }
  if (endDate && !isYmd(endDate)) {
    return res.status(400).json({ message: "Invalid endDate" });
  }
  if (employeeIdRaw && !Number.isFinite(employeeId)) {
    return res.status(400).json({ message: "Invalid employeeId" });
  }

  const authUser = await getAuthUser(authUserId);
  if (!authUser) {
    return res.status(401).json({ message: "User not found" });
  }

  try {
    if (authUser.role === "admin") {
      const result = await pool.query(
        `SELECT
          s.id,
          s.machine_id AS "machineId",
          m.name AS "machineName",
          m.location AS "machineLocation",
          m.type AS "machineType",
          s.employee_id AS "employeeId",
          u.username AS "employeeUsername",
          u.name AS "employeeName",
          s.sale_date AS "date",
          s.coins,
          s.record_message AS "recordMessage",
          s.prize_bs AS "prizeBs",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt"
        FROM employee_daily_sales s
        JOIN users u ON u.id = s.employee_id
        JOIN machines m ON m.id = s.machine_id
        WHERE ($1::date IS NULL OR s.sale_date >= $1::date)
          AND ($2::date IS NULL OR s.sale_date <= $2::date)
          AND ($3::text IS NULL OR s.machine_id = $3::text)
          AND ($4::int IS NULL OR s.employee_id = $4::int)
        ORDER BY s.sale_date DESC, s.machine_id, u.name`,
        [startDate, endDate, machineId, employeeId],
      );
      return res.json(result.rows);
    }

    // Employee scope: either supervisor (sees machines assigned to them) or regular employee (sees only self)
    const supervisor = isSupervisorJobRole(authUser.jobRole);

    if (!supervisor) {
      const result = await pool.query(
        `SELECT
          s.id,
          s.machine_id AS "machineId",
          m.name AS "machineName",
          m.location AS "machineLocation",
          m.type AS "machineType",
          s.employee_id AS "employeeId",
          u.username AS "employeeUsername",
          u.name AS "employeeName",
          s.sale_date AS "date",
          s.coins,
          s.record_message AS "recordMessage",
          s.prize_bs AS "prizeBs",
          s.created_at AS "createdAt",
          s.updated_at AS "updatedAt"
        FROM employee_daily_sales s
        JOIN users u ON u.id = s.employee_id
        JOIN machines m ON m.id = s.machine_id
        WHERE s.employee_id = $1
          AND ($2::date IS NULL OR s.sale_date >= $2::date)
          AND ($3::date IS NULL OR s.sale_date <= $3::date)
          AND ($4::text IS NULL OR s.machine_id = $4::text)
        ORDER BY s.sale_date DESC, s.machine_id`,
        [authUserId, startDate, endDate, machineId],
      );
      return res.json(result.rows);
    }

    const supervisorMachineIds = await getUserMachineIds(authUserId);
    if (supervisorMachineIds.length === 0) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT
        s.id,
        s.machine_id AS "machineId",
        m.name AS "machineName",
        m.location AS "machineLocation",
        m.type AS "machineType",
        s.employee_id AS "employeeId",
        u.username AS "employeeUsername",
        u.name AS "employeeName",
        s.sale_date AS "date",
        s.coins,
        s.record_message AS "recordMessage",
        s.prize_bs AS "prizeBs",
        s.created_at AS "createdAt",
        s.updated_at AS "updatedAt"
      FROM employee_daily_sales s
      JOIN users u ON u.id = s.employee_id
      JOIN machines m ON m.id = s.machine_id
      WHERE s.machine_id = ANY($1::text[])
        AND ($2::date IS NULL OR s.sale_date >= $2::date)
        AND ($3::date IS NULL OR s.sale_date <= $3::date)
        AND ($4::text IS NULL OR s.machine_id = $4::text)
        AND ($5::int IS NULL OR s.employee_id = $5::int)
      ORDER BY s.sale_date DESC, s.machine_id, u.name`,
      [supervisorMachineIds, startDate, endDate, machineId, employeeId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Error listing daily sales:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
