#!/bin/sh
# docker-compose.yml sets no JWT_SECRET by default, so none is kept in the repository: the first start makes a random
# one and keeps it in the api-secrets volume, so sign-ins survive a restart. A JWT_SECRET that's set always wins.
# The database password comes the same way, from the db-secrets volume.
set -e
db_password_file=/run/halcyon-db/db-password
if [ -z "$DATABASE_URL" ] && [ -s "$db_password_file" ]; then
  DATABASE_URL="postgres://halcyon:$(cat "$db_password_file")@db:5432/halcyon"
  export DATABASE_URL
fi
secret_file=/var/lib/halcyon/jwt-secret
if [ -z "$JWT_SECRET" ]; then
  if [ ! -s "$secret_file" ]; then
    (umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64"))' > "$secret_file")
  fi
  JWT_SECRET=$(cat "$secret_file")
  export JWT_SECRET
fi
exec "$@"
