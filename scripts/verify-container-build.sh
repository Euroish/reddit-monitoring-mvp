#!/usr/bin/env bash
set -euo pipefail

POSTGRES_PASSWORD=ci_fixture_only SESSION_SECRET=ci_fixture_only \
  APP_ORIGIN=https://monitoring.example.test SITE_ADDRESS=monitoring.example.test \
  docker compose config --quiet
docker build --target runtime -t monitoring-ci:runtime .
docker build --target proxy -t monitoring-ci:proxy .

docker run --rm -i --entrypoint sh monitoring-ci:runtime -s <<'CHECK'
set -eu
for bin in python python3 chromium chromium-browser google-chrome duckdb; do
  if command -v "$bin" >/dev/null 2>&1; then
    echo "Forbidden heavy binary found in runtime image: $bin"
    exit 1
  fi
done
test -f dist/apps/api/src/server.js
test -f dist/src/storage/schema/run-migrations.js
CHECK
