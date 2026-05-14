import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

const DEFAULT_EXCHANGE_RATE = 36;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "exchange_rate_config",
    {
      id: { type: "integer", primaryKey: true },
      rate: { type: "numeric(12,4)", notNull: true },
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
    },
    { ifNotExists: true },
  );

  pgm.sql(
    `INSERT INTO exchange_rate_config (id, rate)
     VALUES (1, ${DEFAULT_EXCHANGE_RATE})
     ON CONFLICT (id) DO NOTHING`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("exchange_rate_config", { ifExists: true });
}
