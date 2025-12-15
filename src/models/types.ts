export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "employee";
  name: string;
  shift?: string;
  documentId?: string;
  jobRole?: string;
  assignedMachineId?: string;
  zone?: string; // Prefijo de localización para supervisores
}

export interface Machine {
  id: string; // e.g., "A-001"
  name: string;
  status: "active" | "inactive" | "maintenance";
  location?: string;
  lastPing?: Date;
}

export interface MachineEvent {
  id: string;
  machineId: string;
  type:
    | "coin_inserted"
    | "machine_on"
    | "machine_off"
    | "game_start"
    | "game_end"
    | "ping";
  timestamp: string; // ISO string
  data?: any;
}
