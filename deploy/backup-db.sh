#!/usr/bin/env bash
# Daily backup of the Supabase PostgreSQL database (Supabase Free has no
# automatic backups). Run from root's crontab on the VPS, e.g.:
#
#   30 2 * * * /opt/hris-feraco/deploy/backup-db.sh >> /var/log/hris-backup.log 2>&1
#
# - Reads SUPABASE_DB_* from the project's .env (no secrets in this file).
# - pg_dump runs in a throwaway postgres:17 container, so no client install
#   or version mismatch on the VPS (pg_dump 17 can dump Postgres 15/17).
# - Output: custom-format dumps (compressed), kept KEEP_DAYS days.
#
# Restore (overwrites data - coordinate first), see docs/production.md §7.9.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/hris-feraco}"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hris}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Read one KEY=value from .env without sourcing it (values may contain
# characters that are not valid shell).
env_value() {
  local line
  line="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#\"}"; line="${line%\"}"
  line="${line#\'}"; line="${line%\'}"
  printf '%s' "$line"
}

[ -f "$ENV_FILE" ] || { log "ERROR: $ENV_FILE tidak ditemukan"; exit 1; }

DB_HOST="$(env_value SUPABASE_DB_HOST)"
DB_PORT="$(env_value SUPABASE_DB_PORT)"; DB_PORT="${DB_PORT:-5432}"
DB_NAME="$(env_value SUPABASE_DB_NAME)"; DB_NAME="${DB_NAME:-postgres}"
DB_USER="$(env_value SUPABASE_DB_USER)"
DB_PASSWORD="$(env_value SUPABASE_DB_PASSWORD)"

for v in DB_HOST DB_USER DB_PASSWORD; do
  [ -n "${!v}" ] || { log "ERROR: SUPABASE_${v} kosong di $ENV_FILE"; exit 1; }
done

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# One backup at a time.
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { log "Backup lain masih berjalan, dilewati."; exit 0; }

STAMP="$(date +%F-%H%M)"
OUT="$BACKUP_DIR/hris-$STAMP.dump"
TMP="$OUT.partial"

log "Mulai backup $DB_NAME@$DB_HOST:$DB_PORT -> $OUT"
docker run --rm \
  -e PGPASSWORD="$DB_PASSWORD" \
  -e PGSSLMODE=require \
  "$PG_IMAGE" \
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -Fc --no-owner --no-privileges --schema=public \
  > "$TMP"

# A dump that is empty/tiny means something went wrong: keep old backups.
if [ ! -s "$TMP" ] || [ "$(stat -c %s "$TMP")" -lt 1024 ]; then
  rm -f "$TMP"
  log "ERROR: hasil dump kosong/terlalu kecil, backup gagal."
  exit 1
fi
mv "$TMP" "$OUT"
chmod 600 "$OUT"
log "Selesai: $(du -h "$OUT" | cut -f1)"

# Retention: delete dumps older than KEEP_DAYS days.
find "$BACKUP_DIR" -maxdepth 1 -name 'hris-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete \
  | sed 's/^/Hapus backup lama: /' || true
log "Total backup tersimpan: $(find "$BACKUP_DIR" -maxdepth 1 -name 'hris-*.dump' | wc -l)"
