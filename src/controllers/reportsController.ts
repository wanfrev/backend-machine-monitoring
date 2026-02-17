import { Response } from "express";
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

const toNumber = (v: unknown) => {
  if (v === null || typeof v === "undefined" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toIntNonNeg = (v: unknown) => {
  const n = toNumber(v);
  if (n === null) return null;
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
};

const toMoneyNonNeg = (v: unknown) => {
  const n = toNumber(v);
  if (n === null) return null;
  return n >= 0 ? n : null;
};

export const upsertWeeklyReport = async (req: AuthRequest, res: Response) => {
  const authUserId = Number(req.user?.id);
  if (!Number.isFinite(authUserId)) {
    return res.status(401).json({ message: "Access token required" });
  }

  const weekEndDate =
    typeof req.body?.weekEndDate === "string" ? req.body.weekEndDate : "";

  const requestedEmployeeIdRaw = req.body?.employeeId;
  const requestedEmployeeId =
    typeof requestedEmployeeIdRaw === "undefined" || requestedEmployeeIdRaw === null
      ? null
      : Number(requestedEmployeeIdRaw);

  if (!weekEndDate || !isYmd(weekEndDate)) {
    return res.status(400).json({ message: "Invalid weekEndDate" });
  }

  const boxeoCoins = toIntNonNeg(req.body?.boxeoCoins);
  const boxeoLost = toIntNonNeg(req.body?.boxeoLost);
  const boxeoReturned = toIntNonNeg(req.body?.boxeoReturned);

  const agilidadCoins = toIntNonNeg(req.body?.agilidadCoins);
  const agilidadLost = toIntNonNeg(req.body?.agilidadLost);
  const agilidadReturned = toIntNonNeg(req.body?.agilidadReturned);

  const remainingCoins = toIntNonNeg(req.body?.remainingCoins);

  const pagoMovil = toMoneyNonNeg(req.body?.pagoMovil);
  const dolares = toMoneyNonNeg(req.body?.dolares);
  const bolivares = toMoneyNonNeg(req.body?.bolivares);
  const premio = toMoneyNonNeg(req.body?.premio);
  const total = toMoneyNonNeg(req.body?.total);

  const required = [
    boxeoCoins,
    boxeoLost,
    boxeoReturned,
    agilidadCoins,
    agilidadLost,
    agilidadReturned,
    remainingCoins,
    pagoMovil,
    dolares,
    bolivares,
    premio,
    total,
  ];

  if (required.some((x) => x === null)) {
    return res.status(400).json({ message: "Invalid payload" });
  }

  const authUser = await getAuthUser(authUserId);
  if (!authUser) {
    return res.status(401).json({ message: "User not found" });
  }

  const employeeId =
    authUser.role === "admin"
      ? (requestedEmployeeId ?? authUserId)
      : authUserId;

  if (authUser.role !== "admin" && employeeId !== authUserId) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO employee_weekly_reports (
        employee_id,
        week_end_date,
        boxeo_coins,
        boxeo_lost,
        boxeo_returned,
        agilidad_coins,
        agilidad_lost,
        agilidad_returned,
        remaining_coins,
        pago_movil,
        dolares,
        bolivares,
        premio,
        total
      ) VALUES (
        $1, $2::date,
        $3, $4, $5,
        $6, $7, $8,
        $9,
        $10, $11, $12, $13, $14
      )
      ON CONFLICT (employee_id, week_end_date)
      DO UPDATE SET
        boxeo_coins = EXCLUDED.boxeo_coins,
        boxeo_lost = EXCLUDED.boxeo_lost,
        boxeo_returned = EXCLUDED.boxeo_returned,
        agilidad_coins = EXCLUDED.agilidad_coins,
        agilidad_lost = EXCLUDED.agilidad_lost,
        agilidad_returned = EXCLUDED.agilidad_returned,
        remaining_coins = EXCLUDED.remaining_coins,
        pago_movil = EXCLUDED.pago_movil,
        dolares = EXCLUDED.dolares,
        bolivares = EXCLUDED.bolivares,
        premio = EXCLUDED.premio,
        total = EXCLUDED.total,
        updated_at = NOW()
      RETURNING
        id,
        employee_id AS "employeeId",
        week_end_date AS "weekEndDate",
        boxeo_coins AS "boxeoCoins",
        boxeo_lost AS "boxeoLost",
        boxeo_returned AS "boxeoReturned",
        agilidad_coins AS "agilidadCoins",
        agilidad_lost AS "agilidadLost",
        agilidad_returned AS "agilidadReturned",
        remaining_coins AS "remainingCoins",
        pago_movil AS "pagoMovil",
        dolares,
        bolivares,
        premio,
        total,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        employeeId,
        weekEndDate,
        boxeoCoins,
        boxeoLost,
        boxeoReturned,
        agilidadCoins,
        agilidadLost,
        agilidadReturned,
        remainingCoins,
        pagoMovil,
        dolares,
        bolivares,
        premio,
        total,
      ],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Error upserting weekly report:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const listWeeklyReports = async (req: AuthRequest, res: Response) => {
  const authUserId = Number(req.user?.id);
  if (!Number.isFinite(authUserId)) {
    return res.status(401).json({ message: "Access token required" });
  }

  const asString = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const startDate = asString(req.query?.startDate) || null;
  const endDate = asString(req.query?.endDate) || null;
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

  const supervisor = authUser.role === "admin" || isSupervisorJobRole(authUser.jobRole);

  try {
    if (authUser.role === "admin") {
      const result = await pool.query(
        `SELECT
          r.id,
          r.employee_id AS "employeeId",
          u.username AS "employeeUsername",
          u.name AS "employeeName",
          r.week_end_date AS "weekEndDate",
          r.boxeo_coins AS "boxeoCoins",
          r.boxeo_lost AS "boxeoLost",
          r.boxeo_returned AS "boxeoReturned",
          r.agilidad_coins AS "agilidadCoins",
          r.agilidad_lost AS "agilidadLost",
          r.agilidad_returned AS "agilidadReturned",
          r.remaining_coins AS "remainingCoins",
          r.pago_movil AS "pagoMovil",
          r.dolares,
          r.bolivares,
          r.premio,
          r.total,
          r.created_at AS "createdAt",
          r.updated_at AS "updatedAt"
        FROM employee_weekly_reports r
        JOIN users u ON u.id = r.employee_id
        WHERE ($1::date IS NULL OR r.week_end_date >= $1::date)
          AND ($2::date IS NULL OR r.week_end_date <= $2::date)
          AND ($3::int IS NULL OR r.employee_id = $3::int)
          AND COALESCE(u.job_role, '') NOT ILIKE '%supervisor%'
        ORDER BY r.week_end_date DESC, u.name`,
        [startDate, endDate, employeeId],
      );
      return res.json(result.rows);
    }

    if (!supervisor) {
      const result = await pool.query(
        `SELECT
          r.id,
          r.employee_id AS "employeeId",
          u.username AS "employeeUsername",
          u.name AS "employeeName",
          r.week_end_date AS "weekEndDate",
          r.boxeo_coins AS "boxeoCoins",
          r.boxeo_lost AS "boxeoLost",
          r.boxeo_returned AS "boxeoReturned",
          r.agilidad_coins AS "agilidadCoins",
          r.agilidad_lost AS "agilidadLost",
          r.agilidad_returned AS "agilidadReturned",
          r.remaining_coins AS "remainingCoins",
          r.pago_movil AS "pagoMovil",
          r.dolares,
          r.bolivares,
          r.premio,
          r.total,
          r.created_at AS "createdAt",
          r.updated_at AS "updatedAt"
        FROM employee_weekly_reports r
        JOIN users u ON u.id = r.employee_id
        WHERE r.employee_id = $1
          AND ($2::date IS NULL OR r.week_end_date >= $2::date)
          AND ($3::date IS NULL OR r.week_end_date <= $3::date)
        ORDER BY r.week_end_date DESC, u.name`,
        [authUserId, startDate, endDate],
      );
      return res.json(result.rows);
    }

    const supervisorMachineIds = await getUserMachineIds(authUserId);
    if (supervisorMachineIds.length === 0) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT DISTINCT ON (r.id)
        r.id,
        r.employee_id AS "employeeId",
        u.username AS "employeeUsername",
        u.name AS "employeeName",
        r.week_end_date AS "weekEndDate",
        r.boxeo_coins AS "boxeoCoins",
        r.boxeo_lost AS "boxeoLost",
        r.boxeo_returned AS "boxeoReturned",
        r.agilidad_coins AS "agilidadCoins",
        r.agilidad_lost AS "agilidadLost",
        r.agilidad_returned AS "agilidadReturned",
        r.remaining_coins AS "remainingCoins",
        r.pago_movil AS "pagoMovil",
        r.dolares,
        r.bolivares,
        r.premio,
        r.total,
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt"
      FROM employee_weekly_reports r
      JOIN users u ON u.id = r.employee_id
      JOIN user_machines um ON um.user_id = r.employee_id
      WHERE um.machine_id = ANY($1::text[])
        AND ($2::date IS NULL OR r.week_end_date >= $2::date)
        AND ($3::date IS NULL OR r.week_end_date <= $3::date)
        AND ($4::int IS NULL OR r.employee_id = $4::int)
      ORDER BY r.id, r.week_end_date DESC, u.name`,
      [supervisorMachineIds, startDate, endDate, employeeId],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("Error listing weekly reports:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
