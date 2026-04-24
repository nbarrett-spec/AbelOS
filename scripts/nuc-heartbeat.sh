#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# nuc-heartbeat.sh — Push health data from NUC coordinator → Aegis
#
# Runs every 60s via cron or systemd timer on the NUC coordinator.
# Posts a health snapshot to the Aegis heartbeat endpoint so the
# executive dashboard can show NUC status without Tailscale routing.
#
# Required env vars:
#   AEGIS_URL              — e.g. https://app.abellumber.com
#   ENGINE_BRIDGE_TOKEN    — shared secret (same as Aegis's ENGINE_BRIDGE_TOKEN)
#   NUC_NODE_ID            — e.g. "coordinator" (default)
#   NUC_BRAIN_PORT         — local brain engine port (default: 8400)
#
# Install as cron:
#   * * * * * /opt/abel/nuc-heartbeat.sh >> /var/log/nuc-heartbeat.log 2>&1
#
# Or as systemd timer (recommended):
#   See nuc-heartbeat.service / nuc-heartbeat.timer
# ──────────────────────────────────────────────────────────────────────────

set -euo pipefail

AEGIS_URL="${AEGIS_URL:-https://app.abellumber.com}"
ENGINE_BRIDGE_TOKEN="${ENGINE_BRIDGE_TOKEN:?ENGINE_BRIDGE_TOKEN is required}"
NUC_NODE_ID="${NUC_NODE_ID:-coordinator}"
NUC_NODE_ROLE="${NUC_NODE_ROLE:-coordinator}"
NUC_BRAIN_PORT="${NUC_BRAIN_PORT:-8400}"

HEARTBEAT_URL="${AEGIS_URL}/api/v1/engine/heartbeat"
LOCAL_HEALTH_URL="http://127.0.0.1:${NUC_BRAIN_PORT}/brain/health"

# ── Gather local health data ──────────────────────────────────────────────

HEALTH_JSON=$(curl -sf --max-time 5 "${LOCAL_HEALTH_URL}" 2>/dev/null || echo '{}')

# Extract fields from local health response
ENGINE_VERSION=$(echo "${HEALTH_JSON}" | jq -r '.engineVersion // .version // ""' 2>/dev/null || echo '')
MODULE_STATUS=$(echo "${HEALTH_JSON}" | jq -c '.moduleStatus // .modules // {}' 2>/dev/null || echo '{}')
UPTIME_SECONDS=$(echo "${HEALTH_JSON}" | jq -r '.uptimeSeconds // empty' 2>/dev/null || echo '')

# Determine status based on module health
STATUS="online"
if [ "${HEALTH_JSON}" = '{}' ]; then
  STATUS="error"
elif echo "${MODULE_STATUS}" | jq -e 'to_entries | map(.value) | any(. == "error")' >/dev/null 2>&1; then
  STATUS="error"
elif echo "${MODULE_STATUS}" | jq -e 'to_entries | map(.value) | any(. == "degraded")' >/dev/null 2>&1; then
  STATUS="degraded"
fi

# Self-reported latency (time to query local health endpoint)
START_MS=$(date +%s%3N 2>/dev/null || echo "0")
curl -sf --max-time 2 "${LOCAL_HEALTH_URL}" >/dev/null 2>&1 || true
END_MS=$(date +%s%3N 2>/dev/null || echo "0")
LATENCY_MS=$(( END_MS - START_MS ))
[ "${LATENCY_MS}" -lt 0 ] && LATENCY_MS=0

# Build uptime field
UPTIME_FIELD=""
if [ -n "${UPTIME_SECONDS}" ] && [ "${UPTIME_SECONDS}" != "null" ]; then
  UPTIME_FIELD="\"uptimeSeconds\": ${UPTIME_SECONDS},"
fi

# ── Push to Aegis ─────────────────────────────────────────────────────────

PAYLOAD=$(cat <<ENDJSON
{
  "nodeId": "${NUC_NODE_ID}",
  "nodeRole": "${NUC_NODE_ROLE}",
  "engineVersion": "${ENGINE_VERSION}",
  "status": "${STATUS}",
  "moduleStatus": ${MODULE_STATUS},
  "latencyMs": ${LATENCY_MS},
  ${UPTIME_FIELD}
  "meta": {
    "hostname": "$(hostname)",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
ENDJSON
)

HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 10 \
  -X POST "${HEARTBEAT_URL}" \
  -H "Authorization: Bearer ${ENGINE_BRIDGE_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-Workspace-Id: abel-lumber" \
  -H "X-Source: nuc-heartbeat" \
  -d "${PAYLOAD}")

if [ "${HTTP_CODE}" = "200" ]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] heartbeat OK (status=${STATUS}, latency=${LATENCY_MS}ms)"
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] heartbeat FAILED (http=${HTTP_CODE})" >&2
  exit 1
fi
