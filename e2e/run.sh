#!/usr/bin/env bash
# Browser tests against their own throwaway stack: a separate Compose project on its own ports and volumes, so a stack
# you already have running is left alone. Its database is deleted afterwards. Arguments go to `playwright test`.
#   npm run test:e2e
#   npm run test:e2e -- tests/order-flow.spec.ts --headed
set -euo pipefail

cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=halcyon-e2e
export WEB_PORT="${E2E_WEB_PORT:-3100}" API_PORT="${E2E_API_PORT:-4100}" DB_PORT="${E2E_DB_PORT:-5534}"

trap 'docker compose down -v --remove-orphans' EXIT
docker compose up --build --detach --wait

export E2E_BASE_URL="http://localhost:$WEB_PORT"
# The web service has no healthcheck, so --wait can return just before it's listening.
curl --silent --show-error --fail --output /dev/null --retry 30 --retry-delay 1 --retry-connrefused "$E2E_BASE_URL"
export E2E_ADMIN_EMAIL=e2e-admin@example.com
E2E_ADMIN_PASSWORD="$(docker compose exec -T api sh docker-entrypoint.sh node dist/db/create-admin.js "$E2E_ADMIN_EMAIL" "E2E Admin" | awk '/^Password:/ { print $2 }')"
export E2E_ADMIN_PASSWORD

cd e2e
npx playwright test "$@"
