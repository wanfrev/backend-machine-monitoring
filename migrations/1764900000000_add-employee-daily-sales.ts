import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("employee_daily_sales", {
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
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
  });

  pgm.addConstraint(
    "employee_daily_sales",
    "employee_daily_sales_unique_employee_machine_date",
    "UNIQUE (employee_id, machine_id, sale_date)",
  );

  pgm.addConstraint(
    "employee_daily_sales",
    "employee_daily_sales_coins_nonnegative",
    "CHECK (coins >= 0)",
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("employee_daily_sales");
}
