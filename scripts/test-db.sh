#!/usr/bin/env bash
# Arranca un cluster PostgreSQL desechable para las pruebas de base de datos y
# exporta DATABASE_URL. Uso: source scripts/test-db.sh  (o  ./scripts/test-db.sh start|stop)
set -euo pipefail

PGDATA_DIR="${CITACIONES_PGDATA:-${TMPDIR:-/tmp}citaciones-pgdata}"
PGPORT_NUM="${CITACIONES_PGPORT:-55432}"
PGBIN="$(dirname "$(command -v initdb)")"

start() {
  if [ ! -d "$PGDATA_DIR/base" ]; then
    echo "Creando cluster en $PGDATA_DIR"
    rm -rf "$PGDATA_DIR"; mkdir -p "$PGDATA_DIR"
    "$PGBIN/initdb" -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 >/dev/null
  fi
  if ! "$PGBIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1; then
    "$PGBIN/pg_ctl" -D "$PGDATA_DIR" -o "-p $PGPORT_NUM -k $PGDATA_DIR -c listen_addresses=localhost" -l "$PGDATA_DIR/server.log" start >/dev/null
    sleep 1
  fi
  echo "postgresql://postgres@localhost:$PGPORT_NUM/postgres"
}

stop() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR" stop >/dev/null 2>&1 || true
}

case "${1:-start}" in
  start) start ;;
  stop)  stop ;;
  *) echo "uso: $0 [start|stop]" >&2; exit 2 ;;
esac
