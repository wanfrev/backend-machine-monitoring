import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "coin_values",
    {
      type: { type: "text", primaryKey: true },
      value: { type: "numeric", notNull: true },
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
    },
    { ifNotExists: true },
  );

  // Defaults to match current frontend logic: Boxeo & Agilidad = 1, others fallback to 2.
  pgm.sql(
    `INSERT INTO coin_values (type, value)
     VALUES ('boxeo', 1), ('agilidad', 1), ('default', 2)
     ON CONFLICT (type) DO NOTHING`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("coin_values", { ifExists: true });
}
