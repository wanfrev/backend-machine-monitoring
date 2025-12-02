import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../utils/jsonDb';
import { User } from '../models/types';

// Helper for ID if uuid not installed, but I should install it. 
// For now, simple random string.
const generateId = () => Math.random().toString(36).substr(2, 9);

export const getUsers = (req: Request, res: Response) => {
  // Return users without sensitive data
  const users = db.users.map(({ passwordHash, ...u }) => u);
  res.json(users);
};

export const createUser = async (req: Request, res: Response) => {
  const { username, password, name, role, shift } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ message: 'Username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const newUser: User = {
    id: generateId(),
    username,
    passwordHash,
    role,
    name: name || username,
    shift
  };

  db.users.push(newUser);
  db.commit();

  const { passwordHash: _, ...userResponse } = newUser;
  res.status(201).json(userResponse);
};

export const deleteUser = (req: Request, res: Response) => {
  const { id } = req.params;
  const initialLength = db.users.length;
  const newUsers = db.users.filter(u => u.id !== id);
  
  if (newUsers.length === initialLength) {
    return res.status(404).json({ message: 'User not found' });
  }

  // Hacky way to update readonly property in this simple implementation
  // In real DB, we would delete. Here we replace the array content.
  // Since db.users is a getter, we need a setter or method in JsonDB.
  // I'll add a deleteUser method to JsonDB or just modify the array in place if it was a reference (it is).
  // Wait, db.users returns this.data.users, which is a reference. So:
  const index = db.users.findIndex(u => u.id === id);
  if (index !== -1) {
      db.users.splice(index, 1);
      db.commit();
      res.json({ message: 'User deleted' });
  } else {
      res.status(404).json({ message: 'User not found' });
  }
};
