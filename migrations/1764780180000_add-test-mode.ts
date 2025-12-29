import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.alterTable("machines", {
    addColumns: {
      test_mode: { type: "boolean", notNull: false, default: false },
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.alterTable("machines", {
    dropColumns: ["test_mode"],
  });
}

