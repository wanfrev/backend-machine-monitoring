import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Convert any legacy 'supervisor' roles to 'employee'
  pgm.sql("UPDATE users SET role = 'employee' WHERE role = 'supervisor'");

  // Update role constraint to only allow 'admin' and 'employee'
  pgm.dropConstraint("users", "users_role_check");
  pgm.addConstraint(
    "users",
    "users_role_check",
    "CHECK (role IN ('admin','employee'))"
  );

  // Add employee-specific fields
  pgm.addColumn("users", {
    document_id: { type: "text" }, // Cédula / ID de empleado
    job_role: { type: "text" }, // Rol visible (Operador, Supervisor de turno, etc.)
    assigned_machine_id: {
      type: "text",
      references: "machines",
      onDelete: "SET NULL",
    },
  });

  // Cada cédula debería ser única si se usa
  pgm.addConstraint("users", "users_document_id_unique", "UNIQUE(document_id)");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Quitar unicidad de cédula y columnas nuevas
  pgm.dropConstraint("users", "users_document_id_unique");
  pgm.dropColumn("users", ["document_id", "job_role", "assigned_machine_id"]);

  // Volver al constraint original de rol
  pgm.dropConstraint("users", "users_role_check");

  // Volver a mapear empleados a 'supervisor' si se revierte
  pgm.sql("UPDATE users SET role = 'supervisor' WHERE role = 'employee'");

  pgm.addConstraint(
    "users",
    "users_role_check",
    "CHECK (role IN ('admin','supervisor'))"
  );
}
