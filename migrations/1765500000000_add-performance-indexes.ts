import { MigrationBuilder } from "node-pg-migrate";

export const shorthands = {};

// Índices para las consultas calientes del dashboard y del endpoint IoT.
// Hasta ahora machine_events y coins no tenían ningún índice (Postgres no crea
// índices automáticos para las FK), así que cada consulta recorría la tabla completa.
//
// Se crean con CONCURRENTLY para no bloquear las escrituras de las Raspberry
// mientras se construyen. Eso exige correr fuera de una transacción, y
// IF NOT EXISTS hace la migración segura de repetir.
//
// OJO: si un CREATE INDEX CONCURRENTLY se interrumpe, Postgres deja un índice
// INVALID con ese nombre y IF NOT EXISTS lo salta en silencio. Para detectarlo:
//   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
// y luego DROP INDEX <nombre> y volver a correr la migración.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction();

  // Última vez encendida/apagada por máquina (getMachines), power-logs,
  // último coin para el dedupe por tiempo, historial por máquina.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS machine_events_machine_type_ts_idx
    ON machine_events (machine_id, type, "timestamp" DESC)
  `);

  // Listado de notificaciones (/api/iot/events) y consultas por rango de fechas
  // sin filtrar por máquina.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS machine_events_ts_idx
    ON machine_events ("timestamp" DESC)
  `);

  // Dedupe por id_unico en cada moneda que llega de las máquinas.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS machine_events_coin_id_unico_idx
    ON machine_events (machine_id, (data->>'id_unico'))
    WHERE type = 'coin_inserted'
  `);

  // Monedas por máquina y día (ingresos diarios/semanales/mensuales).
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS coins_machine_ts_idx
    ON coins (machine_id, "timestamp")
  `);

  // Monedas de todas las máquinas en un rango (endpoint agregado del dashboard).
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS coins_ts_idx
    ON coins ("timestamp")
  `);

  // EXISTS (SELECT 1 FROM coins WHERE event_id = ...) en el historial de máquina.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS coins_event_id_idx
    ON coins (event_id)
  `);

  // Búsqueda inversa: qué usuarios tienen asignada una máquina (push, supervisores).
  // La PK (user_id, machine_id) solo cubre la búsqueda por usuario.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS user_machines_machine_id_idx
    ON user_machines (machine_id)
  `);

  // Ventas registradas por las operadoras filtradas por rango de fecha.
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS employee_daily_sales_sale_date_idx
    ON employee_daily_sales (sale_date)
  `);

  // coins.unique_id lo usa el endpoint IoT pero ninguna migración lo crea
  // (se agregó fuera de las migraciones). Solo se indexa si la columna existe.
  const uniqueIdColumn = await pgm.db.select(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'coins'
       AND column_name = 'unique_id'`,
  );
  if (uniqueIdColumn.length > 0) {
    pgm.sql(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS coins_machine_unique_id_idx
      ON coins (machine_id, unique_id)
    `);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.noTransaction();

  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS coins_machine_unique_id_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS employee_daily_sales_sale_date_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS user_machines_machine_id_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS coins_event_id_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS coins_ts_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS coins_machine_ts_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS machine_events_coin_id_unico_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS machine_events_ts_idx");
  pgm.sql("DROP INDEX CONCURRENTLY IF EXISTS machine_events_machine_type_ts_idx");
}
