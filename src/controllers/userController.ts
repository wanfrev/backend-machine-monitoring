import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { User } from "../models/types";

// Helper for ID if uuid not installed, but I should install it.
// For now, simple random string.
const generateId = () => Math.random().toString(36).substr(2, 9);

export const getUsers = (req: Request, res: Response) => {
  pool
    .query(
      `SELECT
        u.id,
        u.username,
        u.role,
        u.name,
        u.shift,
        u.document_id AS "documentId",
        u.job_role AS "jobRole",
        COALESCE(
          JSON_AGG(um.machine_id) FILTER (WHERE um.machine_id IS NOT NULL),
          '[]'::json
        ) AS "assignedMachineIds"
      FROM users u
      LEFT JOIN user_machines um ON um.user_id = u.id
      GROUP BY u.id, u.username, u.role, u.name, u.shift, u.document_id, u.job_role`
    )
    .then((result) => res.json(result.rows))
    .catch((err) => {
      console.error("Error fetching users:", err);
      res.status(500).json({ message: "Server error" });
    });
};

export const createUser = async (req: Request, res: Response) => {
  // Log de depuración para ver exactamente qué llega desde el frontend
  console.log("[createUser] Incoming body:", req.body);
  // Aceptar tanto camelCase como snake_case desde el frontend
  const { username, password, name, role, shift } = req.body;
  const documentId = req.body.documentId ?? req.body.document_id ?? null;
  const jobRole = req.body.jobRole ?? req.body.job_role ?? null;
  // Puede venir una sola máquina o un arreglo de IDs de máquinas
  const rawAssignedMany =
    req.body.assignedMachineIds ?? req.body.assigned_machine_ids;
  const singleAssigned =
    req.body.assignedMachineId ?? req.body.assigned_machine_id ?? null;
  let assignedMachineIds: string[] = [];
  if (Array.isArray(rawAssignedMany)) {
    assignedMachineIds = rawAssignedMany.filter(
      (v: unknown) => !!v
    ) as string[];
  } else if (singleAssigned) {
    assignedMachineIds = [singleAssigned];
  }
  if (!username || !password || !role) {
    return res.status(400).json({ message: "Missing required fields" });
  }
  try {
    if (!["admin", "employee"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const exists = await pool.query("SELECT 1 FROM users WHERE username = $1", [
      username,
    ]);
    if ((exists.rowCount ?? 0) > 0) {
      return res.status(400).json({ message: "Username already exists" });
    }
    const passwordHash = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO users (
          username,
          password_hash,
          role,
          name,
          shift,
          document_id,
          job_role
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          username,
          role,
          name,
          shift,
          document_id AS "documentId",
          job_role AS "jobRole"`,
        [
          username,
          passwordHash,
          role,
          name || username,
          shift,
          documentId || null,
          jobRole || null,
        ]
      );

      const newUser = result.rows[0] as User;

      if (assignedMachineIds.length > 0) {
        for (const machineId of assignedMachineIds) {
          await client.query(
            `INSERT INTO user_machines (user_id, machine_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [newUser.id, machineId]
          );
        }
      }

      await client.query("COMMIT");

      res.status(201).json({
        ...newUser,
        assignedMachineIds,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Actualizar usuario (posiblemente cambiando contraseña y máquinas asignadas)
export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  // Aceptar tanto camelCase como snake_case desde el frontend
  const { name, shift, password } = req.body;
  const documentId = req.body.documentId ?? req.body.document_id ?? null;
  const jobRole = req.body.jobRole ?? req.body.job_role ?? null;
  const role = req.body.role ?? "employee";

  const rawAssignedMany =
    req.body.assignedMachineIds ?? req.body.assigned_machine_ids;
  const singleAssigned =
    req.body.assignedMachineId ?? req.body.assigned_machine_id ?? null;
  let assignedMachineIds: string[] = [];
  if (Array.isArray(rawAssignedMany)) {
    assignedMachineIds = rawAssignedMany.filter(
      (v: unknown) => !!v
    ) as string[];
  } else if (singleAssigned) {
    assignedMachineIds = [singleAssigned];
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let result;

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      result = await client.query(
        `UPDATE users SET
          password_hash = $1,
          name = $2,
          shift = $3,
          document_id = $4,
          job_role = $5,
          role = $6
        WHERE id = $7
        RETURNING id, username, role, name, shift, document_id AS "documentId", job_role AS "jobRole"`,
        [passwordHash, name, shift, documentId, jobRole, role, id]
      );
    } else {
      result = await client.query(
        `UPDATE users SET
          name = $1,
          shift = $2,
          document_id = $3,
          job_role = $4,
          role = $5
        WHERE id = $6
        RETURNING id, username, role, name, shift, document_id AS "documentId", job_role AS "jobRole"`,
        [name, shift, documentId, jobRole, role, id]
      );
    }

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found" });
    }

    const updatedUser = result.rows[0] as User;

    // Reemplazar asignaciones de máquinas
    await client.query("DELETE FROM user_machines WHERE user_id = $1", [id]);
    if (assignedMachineIds.length > 0) {
      for (const machineId of assignedMachineIds) {
        await client.query(
          `INSERT INTO user_machines (user_id, machine_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [id, machineId]
        );
      }
    }

    await client.query("COMMIT");

    res.json({
      ...updatedUser,
      assignedMachineIds,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating user:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM users WHERE id = $1 RETURNING id",
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ message: "Server error" });
  }
};
