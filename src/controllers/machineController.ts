import { Request, Response } from 'express';
import { db } from '../utils/jsonDb';
import { Machine } from '../models/types';

const generateId = () => 'M-' + Math.random().toString(36).substr(2, 6).toUpperCase();

export const getMachines = (req: Request, res: Response) => {
  res.json(db.machines);
};

export const getMachineById = (req: Request, res: Response) => {
  const machine = db.machines.find(m => m.id === req.params.id);
  if (!machine) return res.status(404).json({ message: 'Machine not found' });
  res.json(machine);
};

export const createMachine = (req: Request, res: Response) => {
  const { name, location, id } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });

  const newMachine: Machine = {
    id: id || generateId(),
    name,
    status: 'inactive',
    location: location || 'Unknown',
    lastPing: new Date()
  };

  db.machines.push(newMachine);
  db.commit();
  res.status(201).json(newMachine);
};

export const updateMachine = (req: Request, res: Response) => {
  const { id } = req.params;
  const machine = db.machines.find(m => m.id === id);
  if (!machine) return res.status(404).json({ message: 'Machine not found' });

  const { name, location, status } = req.body;
  if (name) machine.name = name;
  if (location) machine.location = location;
  if (status) machine.status = status;

  db.commit();
  res.json(machine);
};

export const deleteMachine = (req: Request, res: Response) => {
  const { id } = req.params;
  const index = db.machines.findIndex(m => m.id === id);
  if (index !== -1) {
    db.machines.splice(index, 1);
    db.commit();
    res.json({ message: 'Machine deleted' });
  } else {
    res.status(404).json({ message: 'Machine not found' });
  }
};

export const getMachineHistory = (req: Request, res: Response) => {
  const { id } = req.params;
  const events = db.events.filter(e => e.machineId === id).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json(events);
};

export const getMachineStats = (req: Request, res: Response) => {
  const { id } = req.params;
  const events = db.events.filter(e => e.machineId === id);
  
  // Calculate stats
  const totalIncome = events.filter(e => e.type === 'coin_inserted').reduce((sum, e) => sum + (e.data?.amount || 0), 0);
  const totalScore = events.filter(e => e.type === 'game_end').reduce((sum, e) => sum + (e.data?.score || 0), 0);
  const activeSessions = events.filter(e => e.type === 'game_start').length; // Simplified
  
  // Usage rate (mock calculation)
  const usageRate = events.length > 0 ? 45.5 : 0;

  res.json({
    totalIncome,
    totalScore,
    activeSessions,
    usageRate
  });
};
