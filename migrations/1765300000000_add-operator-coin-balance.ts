import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

const INITIAL_OPERATOR_COINS = 200;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("users", {
    operator_coin_balance: {
      type: "integer",
      notNull: true,
      default: INITIAL_OPERATOR_COINS,
    },
  });

  pgm.addConstraint(
    "users",
    "users_operator_coin_balance_nonnegative",
    "CHECK (operator_coin_balance >= 0)"
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropConstraint("users", "users_operator_coin_balance_nonnegative");
  pgm.dropColumn("users", "operator_coin_balance");
}
