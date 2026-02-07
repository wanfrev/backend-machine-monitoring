import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("employee_weekly_reports", {
    id: "id",
    employee_id: {
      type: "integer",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    week_end_date: { type: "date", notNull: true },

    boxeo_coins: { type: "integer", notNull: true, default: 0 },
    boxeo_lost: { type: "integer", notNull: true, default: 0 },
    boxeo_returned: { type: "integer", notNull: true, default: 0 },

    agilidad_coins: { type: "integer", notNull: true, default: 0 },
    agilidad_lost: { type: "integer", notNull: true, default: 0 },
    agilidad_returned: { type: "integer", notNull: true, default: 0 },

    remaining_coins: { type: "integer", notNull: true, default: 0 },

    pago_movil: { type: "numeric(12,2)", notNull: true, default: 0 },
    dolares: { type: "numeric(12,2)", notNull: true, default: 0 },
    bolivares: { type: "numeric(12,2)", notNull: true, default: 0 },
    premio: { type: "numeric(12,2)", notNull: true, default: 0 },
    total: { type: "numeric(12,2)", notNull: true, default: 0 },

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
    "employee_weekly_reports",
    "employee_weekly_reports_unique_employee_week",
    "UNIQUE (employee_id, week_end_date)",
  );

  pgm.addConstraint(
    "employee_weekly_reports",
    "employee_weekly_reports_nonnegative",
    "CHECK (\
      boxeo_coins >= 0 AND boxeo_lost >= 0 AND boxeo_returned >= 0 AND\
      agilidad_coins >= 0 AND agilidad_lost >= 0 AND agilidad_returned >= 0 AND\
      remaining_coins >= 0 AND\
      pago_movil >= 0 AND dolares >= 0 AND bolivares >= 0 AND premio >= 0 AND total >= 0\
    )",
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("employee_weekly_reports");
}
