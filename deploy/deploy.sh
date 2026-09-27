#!/usr/bin/env bash
# Deploy del backend en el servidor: respalda la base, trae cambios,
# corre migraciones pendientes, compila y reinicia pm2.
#   ./deploy/deploy.sh
#
# Rollback manual si algo sale mal (no es automatico, a diferencia del
# frontend, porque revertir una migracion ya aplicada requiere criterio):
#   git log --oneline -5              # ver el commit anterior
#   git reset --hard <commit-anterior>
#   npm run build && pm2 restart backend-monitoring
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/backend-machine-monitoring}"
APP_NAME="${APP_NAME:-backend-monitoring}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/machines}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR"
[ -d .git ] || die "$APP_DIR no es un repositorio git"

if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Hay cambios sin commit en el servidor. Revisa con: git -C $APP_DIR status"
fi

log "Respaldando la base de datos"
"$APP_DIR/deploy/backup-db.sh"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE="$(git rev-parse --short HEAD)"

log "Trayendo cambios de origin/$BRANCH"
git fetch origin "$BRANCH"
git merge --ff-only "origin/$BRANCH" || die "No se pudo avanzar en fast-forward"
AFTER="$(git rev-parse --short HEAD)"
echo "Commit: $BEFORE -> $AFTER"

LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
HASH_FILE="node_modules/.deploy-lock-hash"
if [ ! -d node_modules ] || [ "$(cat "$HASH_FILE" 2>/dev/null || true)" != "$LOCK_HASH" ]; then
  log "Instalando dependencias"
  npm ci --no-audit --no-fund
  echo "$LOCK_HASH" > "$HASH_FILE"
else
  log "Dependencias sin cambios"
fi

log "Corriendo migraciones pendientes"
npm run migrate -- up

log "Compilando"
npm run build

log "Reiniciando $APP_NAME"
pm2 restart "$APP_NAME"

sleep 2
log "Verificando"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" || echo "000")"
if [ "$CODE" = "000" ]; then
  echo "AVISO: $HEALTH_URL no respondio. Revisa: pm2 logs $APP_NAME --lines 30 --nostream" >&2
else
  echo "Servidor responde ($CODE en $HEALTH_URL)"
fi

log "Deploy terminado ($AFTER)"
