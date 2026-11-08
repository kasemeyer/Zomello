#!/bin/sh
# With ZOMELLO_DB_REPLICA set (an abs://account@container/path address), the database lives in
# Azure Blob Storage: pull it back before starting — a fresh container has an empty disk, and
# starting without restoring would replicate a brand-new empty database OVER the real one — then
# run the server under Litestream so every change streams back out. The account key comes from
# LITESTREAM_AZURE_ACCOUNT_KEY. Without ZOMELLO_DB_REPLICA this is a plain Zomello Server.
set -e
if [ -n "$ZOMELLO_DB_REPLICA" ] && [ $# -eq 0 ]; then
  DB="${ZOMELLO_DATA:-/data}/zomello.db"
  litestream restore -if-db-not-exists -if-replica-exists -o "$DB" "$ZOMELLO_DB_REPLICA"
  exec litestream replicate -exec "zomello-server" "$DB" "$ZOMELLO_DB_REPLICA"
fi
exec zomello-server "$@"
