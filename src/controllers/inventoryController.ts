import { Response } from "express";
import { pool } from "../db";
import type { AuthRequest } from "../middleware/authMiddleware";

type InventoryMachineRow = {
  machineId: string;
  machineName: string;
  machineLocation: string;
  machineType: string;
  availableCoins: number;
  soldCoins: number;
  returnedCoins: number;
  lostCoins: number;
  pagoMovil: number;
  dolares: number;
  bolivares: number;
  premio: number;
  totalReported: number;
  coinLossBolivares: number;
  total: number;
  totalUsdEquivalent: number;
  events: { record: number; premio: number; perdidas: number; devueltas: number };
};

type InventorySummary = {
  availableCoins: number;
  soldCoins: number;
  returnedCoins: number;
  lostCoins: number;
  pagoMovil: number;
  dolares: number;
  bolivares: number;
  premio: number;
  totalReported: number;
  coinLossBolivares: number;
  total: number;
  totalUsdEquivalent: number;
  events: { record: number; premio: number; perdidas: number; devueltas: number };
};

type InventoryQueryRow = {
  machineId: string;
  machineName: string;
  machineLocation: string | null;
  machineType: string | null;
  availableCoins: number | string;
  soldCoins: number | string;
  returnedCoins: number | string;
  lostCoins: number | string;
  pagoMovil: number | string;
  dolares: number | string;
  bolivares: number | string;
  premio: number | string;
  totalReported: number | string;
  total: number | string;
  recordEvents: number | string;
  premioEvents: number | string;
  perdidasEvents: number | string;
  devueltasEvents: number | string;
};

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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatUtcYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Semana calendario ISO (lunes a domingo, UTC) que contiene la fecha YYYY-MM-DD. */
function isoWeekRangeFromYmd(ymd: string): { startDate: string; endDate: string } | null {
  if (!isYmd(ymd)) return null;
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay();
  const isoDow = dow === 0 ? 7 : dow;
  const mondayOffset = isoDow - 1;
  const mondayMs = t - mondayOffset * 86400000;
  const sundayMs = mondayMs + 6 * 86400000;
  return { startDate: formatUtcYmd(mondayMs), endDate: formatUtcYmd(sundayMs) };
}

function monthEndYmd(ym: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [yS, mS] = ym.split("-").map((v) => Number(v));
  const end = new Date(Date.UTC(yS, mS, 0));
  return `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
}

function getRangeFromFilters(params: {
  period: string;
  date?: string | null;
  month?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): { startDate: string; endDate: string } | null {
  const period = params.period;
  if (period === "custom") {
    const s = params.startDate || "";
    const e = params.endDate || "";
    if (!isYmd(s) || !isYmd(e)) return null;
    if (s > e) return null;
    return { startDate: s, endDate: e };
  }
  if (period === "month") {
    const month = params.month || "";
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const end = monthEndYmd(month);
    if (!end) return null;
    return { startDate: `${month}-01`, endDate: end };
  }
  const baseDate = params.date || "";
  if (!baseDate || !isYmd(baseDate)) return null;
  if (period === "day") {
    return { startDate: baseDate, endDate: baseDate };
  }
  if (period === "week") {
    return isoWeekRangeFromYmd(baseDate);
  }
  return null;
}

export const getInventorySummary = async (req: AuthRequest, res: Response) => {
  const authUserId = Number(req.user?.id);
  if (!Number.isFinite(authUserId)) {
    return res.status(401).json({ message: "Access token required" });
  }

  const authUser = await getAuthUser(authUserId);
  if (!authUser) {
    return res.status(401).json({ message: "User not found" });
  }
  if (authUser.role !== "admin" && !isSupervisorJobRole(authUser.jobRole)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const asString = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const period = asString(req.query?.period).toLowerCase() || "day";
  const machineId = asString(req.query?.machineId) || null;
  const date = asString(req.query?.date) || null;
  const month = asString(req.query?.month) || null;
  const startDate = asString(req.query?.startDate) || null;
  const endDate = asString(req.query?.endDate) || null;

  if (!["day", "week", "month", "custom"].includes(period)) {
    return res.status(400).json({ message: "Invalid period" });
  }
  if (date && !isYmd(date)) {
    return res.status(400).json({ message: "Invalid date" });
  }
  if (startDate && !isYmd(startDate)) {
    return res.status(400).json({ message: "Invalid startDate" });
  }
  if (endDate && !isYmd(endDate)) {
    return res.status(400).json({ message: "Invalid endDate" });
  }

  if (period === "month" && !month) {
    return res.status(400).json({ message: "month is required for period=month" });
  }
  if ((period === "day" || period === "week") && !date) {
    return res.status(400).json({ message: "date is required for this period" });
  }
  if (period === "custom" && (!startDate || !endDate)) {
    return res.status(400).json({ message: "startDate and endDate are required for custom period" });
  }

  const range = getRangeFromFilters({ period, date, month, startDate, endDate });
  if (!range || !range.startDate || !range.endDate) {
    return res.status(400).json({ message: "Invalid period filters" });
  }

  try {
    const supervisorMachineIds =
      authUser.role === "admin" ? [] : await getUserMachineIds(authUserId);
    if (authUser.role !== "admin" && supervisorMachineIds.length === 0) {
      return res.json({
        filters: { period, date, month, startDate, endDate, machineId },
        exchangeRate: 0,
        summary: {
          availableCoins: 0,
          soldCoins: 0,
          returnedCoins: 0,
          lostCoins: 0,
          pagoMovil: 0,
          dolares: 0,
          bolivares: 0,
          premio: 0,
          totalReported: 0,
          coinLossBolivares: 0,
          total: 0,
          totalUsdEquivalent: 0,
          events: { record: 0, premio: 0, perdidas: 0, devueltas: 0 },
        },
        machines: [],
      });
    }

    const result = await pool.query(
      `WITH allowed_machines AS (
         SELECT
           m.id,
           m.name,
           m.location,
           m.type,
           CASE
             WHEN LOWER(COALESCE(m.type, '')) LIKE 'agi%' THEN 'agilidad'
             WHEN LOWER(COALESCE(m.type, '')) LIKE 'box%' THEN 'boxeo'
             WHEN m.id ILIKE '%agilidad%' OR m.name ILIKE '%agilidad%' THEN 'agilidad'
             WHEN m.id ILIKE '%boxeo%' OR m.name ILIKE '%boxeo%' THEN 'boxeo'
             ELSE 'default'
           END AS machine_kind
         FROM machines m
         WHERE ($1::boolean = true OR m.id = ANY($2::text[]))
           AND ($3::text IS NULL OR m.id = $3::text)
       ),
       report_machine_rows AS (
         SELECT
           am.id AS machine_id,
           r.id AS report_id,
           CASE
             WHEN am.machine_kind = 'boxeo' THEN
               COALESCE(r.boxeo_coins, 0)::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'boxeo') OVER (PARTITION BY r.id),
                 0
               )::numeric
             WHEN am.machine_kind = 'agilidad' THEN
               COALESCE(r.agilidad_coins, 0)::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'agilidad') OVER (PARTITION BY r.id),
                 0
               )::numeric
             ELSE
               (COALESCE(r.boxeo_coins, 0) + COALESCE(r.agilidad_coins, 0))::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'default') OVER (PARTITION BY r.id),
                 0
               )::numeric
           END AS machine_sold,
           CASE
             WHEN am.machine_kind = 'boxeo' THEN
               COALESCE(r.boxeo_returned, 0)::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'boxeo') OVER (PARTITION BY r.id),
                 0
               )::numeric
             WHEN am.machine_kind = 'agilidad' THEN
               COALESCE(r.agilidad_returned, 0)::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'agilidad') OVER (PARTITION BY r.id),
                 0
               )::numeric
             ELSE
               (COALESCE(r.boxeo_returned, 0) + COALESCE(r.agilidad_returned, 0))::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'default') OVER (PARTITION BY r.id),
                 0
               )::numeric
           END AS machine_returned,
           CASE
             WHEN am.machine_kind = 'boxeo' THEN
               COALESCE(r.boxeo_lost, 0)::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'boxeo') OVER (PARTITION BY r.id),
                 0
               )::numeric
             WHEN am.machine_kind = 'agilidad' THEN
               COALESCE(r.agilidad_lost, 0)::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'agilidad') OVER (PARTITION BY r.id),
                 0
               )::numeric
             ELSE
               (COALESCE(r.boxeo_lost, 0) + COALESCE(r.agilidad_lost, 0))::numeric
               / NULLIF(
                 COUNT(*) FILTER (WHERE am.machine_kind = 'default') OVER (PARTITION BY r.id),
                 0
               )::numeric
           END AS machine_lost,
           COALESCE(r.boxeo_coins, 0) + COALESCE(r.agilidad_coins, 0) AS report_sold,
           (
             SELECT COUNT(*)
             FROM user_machines um_all
             JOIN machines m_all ON m_all.id = um_all.machine_id
             WHERE um_all.user_id = r.employee_id
               AND (
                 $1::boolean = true
                 OR um_all.machine_id = ANY($2::text[])
               )
           ) AS assigned_machine_count,
           r.pago_movil,
           r.dolares,
           r.bolivares,
           r.premio,
           r.total
         FROM user_machines um
         JOIN allowed_machines am ON am.id = um.machine_id
         JOIN employee_daily_reports r ON r.employee_id = um.user_id
         JOIN users u ON u.id = r.employee_id
         WHERE r.report_date >= $4::date
           AND r.report_date <= $5::date
           AND COALESCE(u.job_role, '') NOT ILIKE '%supervisor%'
       ),
       machine_reports AS (
         SELECT
           rmr.machine_id,
           SUM(rmr.machine_sold) AS sold_coins,
           SUM(rmr.machine_returned) AS returned_coins,
           SUM(rmr.machine_lost) AS lost_coins,
           SUM(
             COALESCE(rmr.pago_movil, 0)::numeric *
             CASE
               WHEN rmr.report_sold > 0 THEN rmr.machine_sold::numeric / rmr.report_sold::numeric
               ELSE 1::numeric / NULLIF(rmr.assigned_machine_count, 0)::numeric
             END
           ) AS pago_movil,
           SUM(
             COALESCE(rmr.dolares, 0)::numeric *
             CASE
               WHEN rmr.report_sold > 0 THEN rmr.machine_sold::numeric / rmr.report_sold::numeric
               ELSE 1::numeric / NULLIF(rmr.assigned_machine_count, 0)::numeric
             END
           ) AS dolares,
           SUM(
             COALESCE(rmr.bolivares, 0)::numeric *
             CASE
               WHEN rmr.report_sold > 0 THEN rmr.machine_sold::numeric / rmr.report_sold::numeric
               ELSE 1::numeric / NULLIF(rmr.assigned_machine_count, 0)::numeric
             END
           ) AS bolivares,
           SUM(
             COALESCE(rmr.premio, 0)::numeric *
             CASE
               WHEN rmr.report_sold > 0 THEN rmr.machine_sold::numeric / rmr.report_sold::numeric
               ELSE 1::numeric / NULLIF(rmr.assigned_machine_count, 0)::numeric
             END
           ) AS premio,
           SUM(
             COALESCE(rmr.total, 0)::numeric *
             CASE
               WHEN rmr.report_sold > 0 THEN rmr.machine_sold::numeric / rmr.report_sold::numeric
               ELSE 1::numeric / NULLIF(rmr.assigned_machine_count, 0)::numeric
             END
           ) AS total_reported,
           SUM(
             COALESCE(rmr.total, 0)::numeric *
             CASE
               WHEN rmr.report_sold > 0 THEN rmr.machine_sold::numeric / rmr.report_sold::numeric
               ELSE 1::numeric / NULLIF(rmr.assigned_machine_count, 0)::numeric
             END
           ) AS total_net,
           COUNT(*) FILTER (
             WHERE rmr.machine_returned > 0
           ) AS returned_events,
           COUNT(*) FILTER (
             WHERE rmr.machine_lost > 0
           ) AS lost_events,
           COUNT(*) FILTER (WHERE COALESCE(rmr.premio, 0) > 0) AS prize_events
         FROM report_machine_rows rmr
         GROUP BY rmr.machine_id
       ),
       machine_events AS (
         SELECT
           e.machine_id,
           COUNT(*) FILTER (
             WHERE COALESCE(e.record_message, '') <> ''
           ) AS record_events
         FROM employee_daily_sale_entries e
         WHERE e.machine_id IN (SELECT id FROM allowed_machines)
           AND e.sale_date >= $4::date
           AND e.sale_date <= $5::date
         GROUP BY e.machine_id
       ),
       machine_available AS (
         SELECT
           um.machine_id,
           SUM(COALESCE(u.operator_coin_balance, 200)) AS available_coins
         FROM user_machines um
         JOIN users u ON u.id = um.user_id
         WHERE um.machine_id IN (SELECT id FROM allowed_machines)
           AND u.role = 'employee'
           AND COALESCE(u.job_role, '') NOT ILIKE '%supervisor%'
         GROUP BY um.machine_id
       )
       SELECT
         am.id AS "machineId",
         am.name AS "machineName",
         am.location AS "machineLocation",
         am.type AS "machineType",
         COALESCE(ma.available_coins, 0) AS "availableCoins",
         COALESCE(mr.sold_coins, 0) AS "soldCoins",
         COALESCE(mr.returned_coins, 0) AS "returnedCoins",
         COALESCE(mr.lost_coins, 0) AS "lostCoins",
         COALESCE(mr.pago_movil, 0) AS "pagoMovil",
         COALESCE(mr.dolares, 0) AS "dolares",
         COALESCE(mr.bolivares, 0) AS "bolivares",
         COALESCE(mr.premio, 0) AS "premio",
         COALESCE(mr.total_reported, 0) AS "totalReported",
         COALESCE(mr.total_net, 0) AS "total",
         COALESCE(me.record_events, 0) AS "recordEvents",
         COALESCE(mr.prize_events, 0) AS "premioEvents",
         COALESCE(mr.lost_events, 0) AS "perdidasEvents",
         COALESCE(mr.returned_events, 0) AS "devueltasEvents"
       FROM allowed_machines am
       LEFT JOIN machine_reports mr ON mr.machine_id = am.id
       LEFT JOIN machine_events me ON me.machine_id = am.id
       LEFT JOIN machine_available ma ON ma.machine_id = am.id
       ORDER BY am.name`,
      [
        authUser.role === "admin",
        supervisorMachineIds,
        machineId,
        range.startDate,
        range.endDate,
      ],
    );

    const rateResult = await pool.query(
      `SELECT COALESCE(rate, 0) AS rate FROM exchange_rate_config WHERE id = 1`,
    );
    const exchangeRate = Number(rateResult.rows[0]?.rate ?? 0);

    const machines: InventoryMachineRow[] = (result.rows as InventoryQueryRow[]).map(
      (row) => {
        const bolivares = Number(row.bolivares || 0);
        const pagoMovil = Number(row.pagoMovil || 0);
        const dolares = Number(row.dolares || 0);
        const coinLossBolivares = 0;
        const vesNet = bolivares + pagoMovil;
        const totalUsdEquivalent =
          dolares + (exchangeRate > 0 ? vesNet / exchangeRate : 0);
        return {
          machineId: String(row.machineId),
          machineName: String(row.machineName || row.machineId),
          machineLocation: row.machineLocation ? String(row.machineLocation) : "",
          machineType: row.machineType ? String(row.machineType) : "",
          availableCoins: Number(row.availableCoins || 0),
          soldCoins: Number(row.soldCoins || 0),
          returnedCoins: Number(row.returnedCoins || 0),
          lostCoins: Number(row.lostCoins || 0),
          pagoMovil,
          dolares,
          bolivares,
          premio: Number(row.premio || 0),
          totalReported: Number(row.totalReported || 0),
          coinLossBolivares,
          total: Number(row.total || 0),
          totalUsdEquivalent,
          events: {
            record: Number(row.recordEvents || 0),
            premio: Number(row.premioEvents || 0),
            perdidas: Number(row.perdidasEvents || 0),
            devueltas: Number(row.devueltasEvents || 0),
          },
        };
      },
    );

    const summary = machines.reduce(
      (acc: InventorySummary, row: InventoryMachineRow) => {
        acc.availableCoins += row.availableCoins;
        acc.soldCoins += row.soldCoins;
        acc.returnedCoins += row.returnedCoins;
        acc.lostCoins += row.lostCoins;
        acc.pagoMovil += row.pagoMovil;
        acc.dolares += row.dolares;
        acc.bolivares += row.bolivares;
        acc.premio += row.premio;
        acc.totalReported += row.totalReported;
        acc.coinLossBolivares += row.coinLossBolivares;
        acc.total += row.total;
        acc.totalUsdEquivalent += row.totalUsdEquivalent;
        acc.events.record += row.events.record;
        acc.events.premio += row.events.premio;
        acc.events.perdidas += row.events.perdidas;
        acc.events.devueltas += row.events.devueltas;
        return acc;
      },
      {
        availableCoins: 0,
        soldCoins: 0,
        returnedCoins: 0,
        lostCoins: 0,
        pagoMovil: 0,
        dolares: 0,
        bolivares: 0,
        premio: 0,
        totalReported: 0,
        coinLossBolivares: 0,
        total: 0,
        totalUsdEquivalent: 0,
        events: {
          record: 0,
          premio: 0,
          perdidas: 0,
          devueltas: 0,
        },
      },
    );
    return res.json({
      filters: {
        period,
        date,
        month,
        startDate: range.startDate,
        endDate: range.endDate,
        machineId,
      },
      exchangeRate,
      summary,
      machines,
    });
  } catch (err) {
    console.error("Error listing inventory:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
