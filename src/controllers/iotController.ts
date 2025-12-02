import { Request, Response } from 'express';
import { db } from '../utils/jsonDb';
import { MachineEvent } from '../models/types';

export const receiveData = (req: Request, res: Response) => {
  const { machineId, event, data, timestamp } = req.body;

  if (!machineId || !event) {
    return res.status(400).json({ message: 'Missing machineId or event' });
  }

  // Verify machine exists
  const machine = db.machines.find(m => m.id === machineId);
  if (!machine) {
    // Optionally auto-create machine or reject
    // For security, better reject or log warning.
    // But for prototype, maybe we want to know.
    console.warn(`Received data from unknown machine: ${machineId}`);
    return res.status(404).json({ message: 'Machine not found' });
  }

  // Update machine status
  machine.lastPing = new Date();
  if (event === 'machine_on') machine.status = 'active';
  if (event === 'machine_off') machine.status = 'inactive';
  
  // Create event record
  const newEvent: MachineEvent = {
    id: Math.random().toString(36).substr(2, 9),
    machineId,
    type: event,
    timestamp: timestamp || new Date().toISOString(),
    data
  };

  db.events.push(newEvent);
  db.commit();

  console.log(`IoT Event: ${machineId} - ${event}`, data);

  res.status(200).json({ status: 'ok' });
};
