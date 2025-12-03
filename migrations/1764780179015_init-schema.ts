import { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = {};

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('users', {
    id: 'id',
    username: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    shift: { type: 'text' },
  });

  pgm.createTable('machines', {
    id: { type: 'text', primaryKey: true },
    name: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true },
    location: { type: 'text' },
    last_ping: { type: 'timestamptz' },
  });

  pgm.createTable('machine_events', {
    id: 'id',
    machine_id: {
      type: 'text',
      notNull: true,
      references: 'machines',
      onDelete: 'cascade',
    },
    type: { type: 'text', notNull: true },
    timestamp: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    data: { type: 'jsonb' },
  });

  pgm.addConstraint('users', 'users_role_check', "CHECK (role IN ('admin','supervisor'))");
  pgm.addConstraint(
    'machines',
    'machines_status_check',
    "CHECK (status IN ('active','inactive','maintenance'))",
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('machine_events');
  pgm.dropTable('machines');
  pgm.dropTable('users');
}