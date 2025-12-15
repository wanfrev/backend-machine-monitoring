import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { pool } from "../db";

const SECRET_KEY = process.env.JWT_SECRET || "supersecretkey";

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.username,
        u.password_hash,
        u.role,
        u.name,
        u.shift,
        u.document_id,
        u.job_role,
        COALESCE(
          JSON_AGG(um.machine_id) FILTER (WHERE um.machine_id IS NOT NULL),
          '[]'
        ) AS "assignedMachineIds"
      FROM users u
      LEFT JOIN user_machines um ON um.user_id = u.id
      WHERE u.username = $1
      GROUP BY u.id, u.username, u.password_hash, u.role, u.name, u.shift, u.document_id, u.job_role`,
      [username]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      SECRET_KEY,
      { expiresIn: "365d" }
    );

    const assignedMachineIds: string[] =
      (user.assignedMachineIds as string[]) || [];
    const primaryMachineId = assignedMachineIds[0] ?? null;

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        shift: user.shift,
        documentId: user.document_id,
        jobRole: user.job_role,
        assignedMachineIds,
        assignedMachineId: primaryMachineId,
      },
    });
  } catch (err) {
    console.error("Error in login:", err);
    res.status(500).json({ message: "Server error" });
  }
};
