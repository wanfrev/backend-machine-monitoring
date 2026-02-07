import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("employee_daily_sales", {
    lost: { type: "integer", notNull: true, default: 0 },
    returned: { type: "integer", notNull: true, default: 0 },
  });

  pgm.addConstraint(
    "employee_daily_sales",
    "employee_daily_sales_lost_nonnegative",
    "CHECK (lost >= 0)",
  );

  pgm.addConstraint(
    "employee_daily_sales",
    "employee_daily_sales_returned_nonnegative",
    "CHECK (returned >= 0)",
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint(
    "employee_daily_sales",
    "employee_daily_sales_lost_nonnegative",
  );
  pgm.dropConstraint(
    "employee_daily_sales",
    "employee_daily_sales_returned_nonnegative",
  );
  pgm.dropColumns("employee_daily_sales", ["lost", "returned"]);
}
