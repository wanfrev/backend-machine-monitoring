import fs from 'fs';
import path from 'path';
import { User, Machine, MachineEvent } from '../models/types';

const DB_PATH = path.join(__dirname, '../../data.json');

interface DatabaseSchema {
  users: User[];
  machines: Machine[];
  events: MachineEvent[];
}

const initialData: DatabaseSchema = {
  users: [
    {
      id: '1',
      username: 'admin',
      passwordHash: '$2a$10$x.z.z.z.z.z.z.z.z.z.z.z.z.z.z.z.z.z.z.z.z.z', // Placeholder, will need real hash
      role: 'admin',
      name: 'Administrador Principal'
    }
  ],
  machines: [
    { id: 'A-001', name: 'Máquina de Boxeo 1', status: 'active', location: 'Sucursal Centro' },
    { id: 'B-001', name: 'Máquina de Agilidad 1', status: 'inactive', location: 'Sucursal Norte' }
  ],
  events: []
};

export class JsonDB {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
  }

  private load(): DatabaseSchema {
    if (!fs.existsSync(DB_PATH)) {
      this.save(initialData);
      return initialData;
    }
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      console.error("Error reading DB, resetting...", e);
      return initialData;
    }
  }

  private save(data: DatabaseSchema) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  }

  public get users() { return this.data.users; }
  public get machines() { return this.data.machines; }
  public get events() { return this.data.events; }

  public commit() {
    this.save(this.data);
  }
}

export const db = new JsonDB();
