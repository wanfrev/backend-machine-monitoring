import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("coins", {
    id: "id",
    machine_id: {
      type: "text",
      notNull: true,
      references: "machines",
      onDelete: "CASCADE",
    },
    timestamp: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    event_id: {
      type: "integer",
      references: "machine_events(id)",
      onDelete: "SET NULL",
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("coins");
}
