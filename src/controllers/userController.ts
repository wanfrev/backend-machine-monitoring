// Actualizar usuario (posiblemente cambiando contraseña si se envía)
export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  // Aceptar tanto camelCase como snake_case desde el frontend
  const { name, shift, password } = req.body;
  const documentId = req.body.documentId ?? req.body.document_id ?? null;
  const jobRole = req.body.jobRole ?? req.body.job_role ?? null;
  const assignedMachineId =
    req.body.assignedMachineId ?? req.body.assigned_machine_id ?? null;
  const zone = req.body.zone ?? req.body.locationPrefix ?? null;
  const role = req.body.role ?? "employee";
  try {
    let result;

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      result = await pool.query(
        `UPDATE users SET
          password_hash = $1,
          name = $2,
          shift = $3,
          document_id = $4,
          job_role = $5,
          assigned_machine_id = $6,
          role = $7,
          zone = $8
        WHERE id = $9
        RETURNING id, username, role, name, shift, document_id AS "documentId", job_role AS "jobRole", assigned_machine_id AS "assignedMachineId", zone`,
        [
          passwordHash,
          name,
          shift,
          documentId,
          jobRole,
          assignedMachineId,
          role,
          zone,
          id,
        ]
      );
    } else {
      result = await pool.query(
        `UPDATE users SET
          name = $1,
          shift = $2,
          document_id = $3,
          job_role = $4,
          assigned_machine_id = $5,
          role = $6,
          zone = $7
        WHERE id = $8
        RETURNING id, username, role, name, shift, document_id AS "documentId", job_role AS "jobRole", assigned_machine_id AS "assignedMachineId", zone`,
        [name, shift, documentId, jobRole, assignedMachineId, role, zone, id]
      );
    }
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating user:", err);
    res.status(500).json({ message: "Server error" });
  }
};
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
        id,
        username,
        role,
        name,
        shift,
        document_id AS "documentId",
        job_role AS "jobRole",
        assigned_machine_id AS "assignedMachineId",
        zone
      FROM users`
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
  const assignedMachineId =
    req.body.assignedMachineId ?? req.body.assigned_machine_id ?? null;
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
    const result = await pool.query(
      `INSERT INTO users (
        username,
        password_hash,
        role,
        name,
        shift,
        document_id,
        job_role,
        assigned_machine_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id,
        username,
        role,
        name,
        shift,
        document_id AS "documentId",
        job_role AS "jobRole",
        assigned_machine_id AS "assignedMachineId"`,
      [
        username,
        passwordHash,
        role,
        name || username,
        shift,
        documentId || null,
        jobRole || null,
        assignedMachineId || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(500).json({ message: "Server error" });
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
