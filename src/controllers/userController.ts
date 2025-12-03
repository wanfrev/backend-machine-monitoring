import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { User } from '../models/types';

// Helper for ID if uuid not installed, but I should install it. 
// For now, simple random string.
const generateId = () => Math.random().toString(36).substr(2, 9);

  pool.query('SELECT id, username, role, name, shift FROM users')
    .then(result => res.json(result.rows))
    .catch(err => {
      console.error('Error fetching users:', err);
      res.status(500).json({ message: 'Server error' });
    });
};

  const { username, password, name, role, shift } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (exists.rowCount > 0) {
      return res.status(400).json({ message: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role, name, shift) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, role, name, shift',
      [username, passwordHash, role, name || username, shift]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
