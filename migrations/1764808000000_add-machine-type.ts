import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.alterTable("machines", {
    addColumns: {
      type: { type: "text" },
    },
  });

  // Backfill from existing IDs/names (current convention: Maquina_Boxeo_XX / Maquina_Agilidad_XX)
  pgm.sql(`
    UPDATE machines
    SET type = CASE
      WHEN id ILIKE 'Maquina_Boxeo_%' THEN 'boxeo'
      WHEN id ILIKE 'Maquina_Agilidad_%' THEN 'agilidad'
      WHEN name ILIKE '%boxeo%' THEN 'boxeo'
      WHEN name ILIKE '%agilidad%' THEN 'agilidad'
      ELSE 'default'
    END
    WHERE type IS NULL OR BTRIM(type) = '';
  `);

  pgm.alterColumn("machines", "type", {
    notNull: true,
    default: "default",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.alterTable("machines", {
    dropColumns: ["type"],
  });
}
