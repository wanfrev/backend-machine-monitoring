export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "employee"; // Rol de sistema (permisos)
  name: string;
  shift?: string; // Turno de trabajo (ej. Diurno, Nocturno)
  documentId?: string; // Cédula / ID de empleado
  jobRole?: string; // Rol visible (Operador, Supervisor de turno, etc.)
  // Lista de IDs de máquinas asignadas (relación muchos-a-muchos)
  assignedMachineIds?: string[];
}

export interface Machine {
  id: string; // e.g., "A-001"
  name: string;
  status: "active" | "inactive" | "maintenance";
  location?: string;
  lastPing?: Date;
  test_mode?: boolean;
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
