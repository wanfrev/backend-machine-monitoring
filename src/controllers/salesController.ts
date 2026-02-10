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

const toIntNonNeg = (v: unknown, fallback = 0) => {
  if (v === null || typeof v === "undefined" || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
};

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
  const lostRaw = req.body?.lost;
  const returnedRaw = req.body?.returned;
  const entryCoinsRaw = req.body?.entryCoins;

  const coins = Number(coinsRaw);
  const prizeBs =
    prizeBsRaw === null ||
    typeof prizeBsRaw === "undefined" ||
    prizeBsRaw === ""
      ? null
      : Number(prizeBsRaw);

  const lost = toIntNonNeg(lostRaw, 0);
  const returned = toIntNonNeg(returnedRaw, 0);
  const entryCoins =
    typeof entryCoinsRaw === "undefined" ||
    entryCoinsRaw === null ||
    entryCoinsRaw === ""
      ? null
      : toIntNonNeg(entryCoinsRaw, 0);

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
  if (lost === null || returned === null) {
    return res.status(400).json({ message: "Invalid lost/returned" });
  }
  if (entryCoins === null && typeof entryCoinsRaw !== "undefined") {
    return res.status(400).json({ message: "Invalid entryCoins" });
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
        prize_bs,
        lost,
        returned
      ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
      ON CONFLICT (employee_id, machine_id, sale_date)
      DO UPDATE SET
        coins = EXCLUDED.coins,
        record_message = EXCLUDED.record_message,
        prize_bs = EXCLUDED.prize_bs,
        lost = EXCLUDED.lost,
        returned = EXCLUDED.returned,
        updated_at = NOW()
      RETURNING
        id,
        employee_id AS "employeeId",
        machine_id AS "machineId",
        sale_date AS "date",
        coins,
        record_message AS "recordMessage",
        prize_bs AS "prizeBs",
        lost,
        returned,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        employeeId,
        machineId,
        date,
        coins,
        recordMessage,
        prizeBs,
        lost,
        returned,
      ],
    );

    const shouldLogEntry =
      entryCoins !== null ||
      recordMessage ||
      prizeBs !== null ||
      (lost ?? 0) > 0 ||
      (returned ?? 0) > 0;

    if (shouldLogEntry) {
      const entryCoinsValue = entryCoins ?? 0;
      await pool.query(
        `INSERT INTO employee_daily_sale_entries (
          employee_id,
          machine_id,
          sale_date,
          coins,
          record_message,
          prize_bs,
          lost,
          returned
        ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)`,
        [
          employeeId,
          machineId,
          date,
          entryCoinsValue,
          recordMessage,
          prizeBs,
          lost,
          returned,
        ],
      );
    }

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
  const summary = asString(req.query?.summary).toLowerCase();

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
    if (summary === "employee") {
      if (authUser.role === "admin") {
        const result = await pool.query(
          `SELECT
            u.id AS "employeeId",
            u.username AS "employeeUsername",
            u.name AS "employeeName",
            COALESCE(
              (
                SELECT JSON_AGG(DISTINCT COALESCE(m.name, um.machine_id))
                FROM user_machines um
                LEFT JOIN machines m ON m.id = um.machine_id
                WHERE um.user_id = u.id
              ),
              '[]'::json
            ) AS "machineNames",
            COALESCE(
              (
                SELECT SUM(s.coins)
                FROM employee_daily_sales s
                WHERE s.employee_id = u.id
                  AND ($1::date IS NULL OR s.sale_date >= $1::date)
                  AND ($2::date IS NULL OR s.sale_date <= $2::date)
              ),
              0
            ) AS "totalCoins"
          FROM users u
          WHERE u.role = 'employee'
            AND ($3::int IS NULL OR u.id = $3::int)
          ORDER BY "totalCoins" DESC, u.name`,
          [startDate, endDate, employeeId],
        );
        return res.json(result.rows);
      }

      const supervisor = isSupervisorJobRole(authUser.jobRole);
      if (!supervisor) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const supervisorMachineIds = await getUserMachineIds(authUserId);
      if (supervisorMachineIds.length === 0) {
        return res.json([]);
      }

      const result = await pool.query(
        `SELECT
          u.id AS "employeeId",
          u.username AS "employeeUsername",
          u.name AS "employeeName",
          COALESCE(
            (
              SELECT JSON_AGG(DISTINCT COALESCE(m.name, um.machine_id))
              FROM user_machines um
              LEFT JOIN machines m ON m.id = um.machine_id
              WHERE um.user_id = u.id
                AND um.machine_id = ANY($3::text[])
            ),
            '[]'::json
          ) AS "machineNames",
          COALESCE(
            (
              SELECT SUM(s.coins)
              FROM employee_daily_sales s
              WHERE s.employee_id = u.id
                AND s.machine_id = ANY($3::text[])
                AND ($1::date IS NULL OR s.sale_date >= $1::date)
                AND ($2::date IS NULL OR s.sale_date <= $2::date)
            ),
            0
          ) AS "totalCoins"
        FROM users u
        WHERE u.role = 'employee'
          AND COALESCE(u.job_role, '') NOT ILIKE '%supervisor%'
          AND u.id IN (
            SELECT um.user_id
            FROM user_machines um
            WHERE um.machine_id = ANY($3::text[])
          )
          AND ($4::int IS NULL OR u.id = $4::int)
        ORDER BY "totalCoins" DESC, u.name`,
        [startDate, endDate, supervisorMachineIds, employeeId],
      );

      return res.json(result.rows);
    }

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
          s.lost,
          s.returned,
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
          s.lost,
          s.returned,
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
        s.lost,
        s.returned,
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

export const listDailySaleEntries = async (req: AuthRequest, res: Response) => {
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
          e.id,
          e.machine_id AS "machineId",
          m.name AS "machineName",
          e.employee_id AS "employeeId",
          u.username AS "employeeUsername",
          u.name AS "employeeName",
          e.sale_date AS "date",
          e.coins,
          e.record_message AS "recordMessage",
          e.prize_bs AS "prizeBs",
          e.lost,
          e.returned,
          e.created_at AS "createdAt"
        FROM employee_daily_sale_entries e
        JOIN users u ON u.id = e.employee_id
        JOIN machines m ON m.id = e.machine_id
        WHERE ($1::date IS NULL OR e.sale_date >= $1::date)
          AND ($2::date IS NULL OR e.sale_date <= $2::date)
          AND ($3::text IS NULL OR e.machine_id = $3::text)
          AND ($4::int IS NULL OR e.employee_id = $4::int)
        ORDER BY e.created_at DESC`,
        [startDate, endDate, machineId, employeeId],
      );
      return res.json(result.rows);
    }

    const supervisor = isSupervisorJobRole(authUser.jobRole);
    if (!supervisor) {
      const result = await pool.query(
        `SELECT
          e.id,
          e.machine_id AS "machineId",
          m.name AS "machineName",
          e.employee_id AS "employeeId",
          u.username AS "employeeUsername",
          u.name AS "employeeName",
          e.sale_date AS "date",
          e.coins,
          e.record_message AS "recordMessage",
          e.prize_bs AS "prizeBs",
          e.lost,
          e.returned,
          e.created_at AS "createdAt"
        FROM employee_daily_sale_entries e
        JOIN users u ON u.id = e.employee_id
        JOIN machines m ON m.id = e.machine_id
        WHERE e.employee_id = $1
          AND ($2::date IS NULL OR e.sale_date >= $2::date)
          AND ($3::date IS NULL OR e.sale_date <= $3::date)
          AND ($4::text IS NULL OR e.machine_id = $4::text)
        ORDER BY e.created_at DESC`,
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
        e.id,
        e.machine_id AS "machineId",
        m.name AS "machineName",
        e.employee_id AS "employeeId",
        u.username AS "employeeUsername",
        u.name AS "employeeName",
        e.sale_date AS "date",
        e.coins,
        e.record_message AS "recordMessage",
        e.prize_bs AS "prizeBs",
        e.lost,
        e.returned,
        e.created_at AS "createdAt"
      FROM employee_daily_sale_entries e
      JOIN users u ON u.id = e.employee_id
      JOIN machines m ON m.id = e.machine_id
      WHERE e.machine_id = ANY($1::text[])
        AND ($2::date IS NULL OR e.sale_date >= $2::date)
        AND ($3::date IS NULL OR e.sale_date <= $3::date)
        AND ($4::text IS NULL OR e.machine_id = $4::text)
        AND ($5::int IS NULL OR e.employee_id = $5::int)
      ORDER BY e.created_at DESC`,
      [supervisorMachineIds, startDate, endDate, machineId, employeeId],
    );

    return res.json(result.rows);
  } catch (err) {
    console.error("Error listing daily sale entries:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
