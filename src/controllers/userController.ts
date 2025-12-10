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
        assigned_machine_id AS "assignedMachineId"
      FROM users`
    )
    .then((result) => res.json(result.rows))
    .catch((err) => {
      console.error("Error fetching users:", err);
      res.status(500).json({ message: "Server error" });
    });
};

export const createUser = async (req: Request, res: Response) => {
  const {
    username,
    password,
    name,
    role,
    shift,
    documentId,
    jobRole,
    assignedMachineId,
  } = req.body;
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
        document_id,
        job_role,
        assigned_machine_id`,
      [
        username,
        passwordHash,
        role,
        name || username,
        shift || null,
        documentId || null,
        jobRole || null,
        assignedMachineId || null,
      ]
    );
    // Map snake_case to camelCase for frontend compatibility
    const user = result.rows[0];
    res.status(201).json({
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      shift: user.shift,
      documentId: user.document_id,
      jobRole: user.job_role,
      assignedMachineId: user.assigned_machine_id,
    });
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
