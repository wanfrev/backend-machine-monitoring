import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("employee_daily_sale_entries", {
    id: "id",
    employee_id: {
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
    sale_date: { type: "date", notNull: true },
    coins: { type: "integer", notNull: true, default: 0 },
    record_message: { type: "text" },
    prize_bs: { type: "numeric(12,2)" },
    lost: { type: "integer" },
    returned: { type: "integer" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("employee_daily_sale_entries", "employee_id");
  pgm.createIndex("employee_daily_sale_entries", "machine_id");
  pgm.createIndex("employee_daily_sale_entries", "sale_date");
  pgm.createIndex("employee_daily_sale_entries", "created_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("employee_daily_sale_entries");
}
