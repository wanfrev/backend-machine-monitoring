import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Nueva tabla de relación muchos-a-muchos entre usuarios y máquinas
  pgm.createTable("user_machines", {
    user_id: {
      type: "integer",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    machine_id: {
      type: "text",
      notNull: true,
      references: "machines",
      onDelete: "CASCADE",
    },
  });

  // Clave primaria compuesta para evitar duplicados
  pgm.addConstraint(
    "user_machines",
    "user_machines_pkey",
    "PRIMARY KEY (user_id, machine_id)"
  );

  // Migrar datos existentes desde users.assigned_machine_id, si existe
  pgm.sql(`
    INSERT INTO user_machines (user_id, machine_id)
    SELECT id, assigned_machine_id
    FROM users
    WHERE assigned_machine_id IS NOT NULL
  `);

  // Eliminar la columna de asignación única en users
  pgm.dropColumn("users", "assigned_machine_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Volver a crear la columna en users
  pgm.addColumn("users", {
    assigned_machine_id: {
      type: "text",
      references: "machines",
      onDelete: "SET NULL",
    },
  });

  // Restaurar un valor (el primero) desde user_machines
  pgm.sql(`
    UPDATE users u
    SET assigned_machine_id = sub.machine_id
    FROM (
      SELECT user_id, MIN(machine_id) AS machine_id
      FROM user_machines
      GROUP BY user_id
    ) AS sub
    WHERE u.id = sub.user_id
  `);

  // Eliminar la tabla de relación
  pgm.dropTable("user_machines");
}
