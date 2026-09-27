#!/usr/bin/env bash
set -u

base="${BASE_URL:-http://127.0.0.1:${PORT:-5000}}"
output="${OUTPUT_FILE:-/tmp/mock-trader-route-results.tsv}"
: > "$output"
failures=0

status_expected() {
  local status="$1"
  local expected="$2"
  grep -Eq "(^|[^0-9])${status}([^0-9]|$)" <<< "$expected"
}

check() {
  local method="$1"
  local path="$2"
  local expected="$3"
  local data="${4-}"
  local body status curl_failed=0
  body="$(mktemp)"

  if [[ -n "$data" ]]; then
    status="$(curl --max-time 10 -sS -X "$method" \
      -H "content-type: application/json" \
      -H "idempotency-key: route-verification" \
      -o "$body" -w "%{http_code}" \
      --data "$data" "$base$path")" || curl_failed=$?
  else
    status="$(curl --max-time 10 -sS -X "$method" \
      -o "$body" -w "%{http_code}" "$base$path")" || curl_failed=$?
  fi

  printf "%s\t%s\t%s\t%s\t%s\n" \
    "$method" \
    "$path" \
    "$status" \
    "$expected" \
    "$(tr "\n\t" "  " < "$body" | cut -c1-180)" >> "$output"
  rm -f "$body"
  if (( curl_failed != 0 )) || ! status_expected "$status" "$expected"; then
    failures=$((failures + 1))
  fi
}

check_websocket() {
  local body headers status
  body="$(mktemp)"
  headers="$(mktemp)"
  status="$(curl --max-time 2 -sS \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -D "$headers" -o "$body" -w "%{http_code}" \
    "$base/ws/market")" || true
  printf "GET\t/ws/market\t%s\t401 without session\t%s\n" \
    "$status" \
    "$(tr "\n\t" "  " < "$body" | cut -c1-180)" >> "$output"
  rm -f "$body" "$headers"
  if [[ "$status" != "101" && "$status" != "401" ]]; then
    failures=$((failures + 1))
  fi
}

check GET "/" "200"
check GET "/health" "200"
check GET "/ready" "200 or 503"

for prefix in "/api/v1"; do
  check GET "$prefix/market/stats" "200"
  check GET "$prefix/market/instruments/search?q=RELIANCE&limit=1" "200"
  check GET "$prefix/market/instruments/RELIANCE" "200"
  check GET "$prefix/market/quotes?ids=RELIANCE&mode=QUOTE" "200 or 502"
  check GET "$prefix/market/candles/RELIANCE" "404"
done

check GET "/api/v1/auth/get-session" "200"
check POST "/api/v1/auth/sign-in/email" "400" "{}"

check GET "/api/v1/me/portfolio" "401 without session"
check GET "/api/v1/me" "401 without session"
check POST "/api/v1/me/accounts" "401 without session"
check GET "/api/v1/accounts/route-check" "401 without session"
check GET "/api/v1/accounts/route-check/activity" "401 without session"
check GET "/api/v1/accounts/route-check/positions" "401 without session"
check GET "/api/v1/accounts/route-check/orders" "401 without session"
check POST "/api/v1/accounts/route-check/orders" "401 without session" \
  '{"instrumentId":"RELIANCE","side":"buy","type":"market","quantity":1}'
check GET "/api/v1/accounts/route-check/trades" "401 without session"
check POST "/api/v1/orders/route-check/cancel" "401 without session" \
  '{"reason":"route verification"}'

check GET "/api/v1/competitions" "404"
check GET "/api/v1/competitions/route-check/leaderboard" "404"

check GET "/api/v1/admin/risk-reviews" "401 without session"
check POST "/api/v1/admin/risk-reviews/route-check/resolve" \
  "401 without session" \
  '{"status":"approved","notes":"route verification"}'
check GET "/api/v1/admin/fraud-alerts" "401 without session"
check POST "/api/v1/admin/fraud-alerts/route-check/resolve" \
  "401 without session" \
  '{"status":"resolved","notes":"route verification"}'
check POST "/api/v1/admin/accounts/route-check/leaderboard-eligibility" \
  "401 without session" \
  '{"eligible":false,"reason":"route verification"}'
check POST \
  "/api/v1/admin/competition-participants/route-check/disqualify" \
  "401 without session" \
  '{"reason":"route verification"}'

check GET "/docs" "302"
check GET "/docs/" "302"
check GET "/docs/index.html" "200"
check GET "/docs/api" "200"
check GET "/docs/api.html" "200"
check GET "/openapi.json" "200"
check GET "/docs/dev" "200"
check GET "/docs/dev.html" "200"
check GET "/docs/deploy" "200"
check GET "/docs/deploy.html" "200"
check GET "/docs/md/api" "200"
check GET "/docs/md/api.md" "200"
check GET "/docs/md/dev" "200"
check GET "/docs/md/dev.md" "200"
check GET "/docs/md/deploy" "200"
check GET "/docs/md/deploy.md" "200"
check GET "/docs/md/frontend-handoff" "200"

check_websocket

column -t -s $'\t' "$output" 2>/dev/null || cat "$output"

if (( failures > 0 )); then
  printf '%s route verification check(s) failed\n' "$failures" >&2
  exit 1
fi
