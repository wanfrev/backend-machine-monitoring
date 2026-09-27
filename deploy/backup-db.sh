#!/usr/bin/env bash
# Respaldo diario de la base de datos de Postgres.
# Cron sugerido (todos los dias 3:00 AM):
#   0 3 * * * /root/backend-machine-monitoring/deploy/backup-db.sh >> /var/log/backup-db.log 2>&1
set -euo pipefail

DB_NAME="${DB_NAME:-box}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F-%H%M)"
OUT="$BACKUP_DIR/$DB_NAME-$STAMP.sql.gz"
TMP="$OUT.tmp"

runuser -u postgres -- pg_dump "$DB_NAME" | gzip > "$TMP"

if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  echo "ERROR: el respaldo salio vacio" >&2
  exit 1
fi

mv "$TMP" "$OUT"
find "$BACKUP_DIR" -name "$DB_NAME-*.sql.gz" -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) respaldo listo: $OUT ($(du -h "$OUT" | cut -f1))"
