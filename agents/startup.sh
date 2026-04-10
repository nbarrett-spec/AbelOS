#!/bin/bash

################################################################################
# Abel Lumber AI Business Engine — Agent Startup Script
#
# This script initializes any agent computer to join the distributed AI network.
# Each agent runs a specific role and communicates with the main platform.
#
# Usage:
#   ./startup.sh <agent-role>
#
# Valid roles:
#   - sales              (Sales Agent)
#   - marketing          (Marketing Agent)
#   - ops                (Operations Agent)
#   - customer-success   (Customer Success Agent)
#   - intel              (Business Intelligence Agent)
#   - coordinator        (Coordination Agent)
#
################################################################################

set -e

# ──────────────────────────────────────────────────────────────────────────────
# Configuration & Validation
# ──────────────────────────────────────────────────────────────────────────────

# Check if role argument was provided
if [ $# -eq 0 ]; then
  echo "ERROR: Agent role required."
  echo ""
  echo "Usage: $0 <agent-role>"
  echo ""
  echo "Valid roles:"
  echo "  - sales              (Sales Agent)"
  echo "  - marketing          (Marketing Agent)"
  echo "  - ops                (Operations Agent)"
  echo "  - customer-success   (Customer Success Agent)"
  echo "  - intel              (Business Intelligence Agent)"
  echo "  - coordinator        (Coordination Agent)"
  echo ""
  exit 1
fi

# Extract the agent role and validate it
AGENT_ROLE="$1"
ROLE_UPPER=$(echo "$AGENT_ROLE" | tr '[:lower:]' '[:upper:]')

# Normalize role to internal format (convert dashes to underscores)
case "$AGENT_ROLE" in
  sales|marketing|ops|intel|coordinator)
    # Valid roles (single word or normalized)
    ;;
  customer-success)
    AGENT_ROLE="customer_success"
    ;;
  *)
    echo "ERROR: Invalid agent role: $AGENT_ROLE"
    echo ""
    echo "Valid roles:"
    echo "  - sales"
    echo "  - marketing"
    echo "  - ops"
    echo "  - customer-success"
    echo "  - intel"
    echo "  - coordinator"
    echo ""
    exit 1
    ;;
esac

# ──────────────────────────────────────────────────────────────────────────────
# Environment Setup
# ──────────────────────────────────────────────────────────────────────────────

# Export the agent role and base URL for this agent's process
export AGENT_ROLE="$AGENT_ROLE"
export BASE_URL="http://localhost:3000"
export NODE_ENV="${NODE_ENV:-development}"

# Generate a unique agent instance ID (for this session)
export AGENT_INSTANCE_ID="$(uuidgen 2>/dev/null || echo "agent-${AGENT_ROLE}-$(date +%s)")"

# ──────────────────────────────────────────────────────────────────────────────
# Agent Information & Startup Message
# ──────────────────────────────────────────────────────────────────────────────

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                   Abel Lumber AI Business Engine                           ║"
echo "║                         Agent Startup Complete                            ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Agent Configuration:"
echo "  Role:            $AGENT_ROLE"
echo "  Instance ID:     $AGENT_INSTANCE_ID"
echo "  Platform URL:    $BASE_URL"
echo "  Environment:     $NODE_ENV"
echo ""
echo "Environment Variables:"
echo "  AGENT_ROLE=$AGENT_ROLE"
echo "  AGENT_INSTANCE_ID=$AGENT_INSTANCE_ID"
echo "  BASE_URL=$BASE_URL"
echo "  NODE_ENV=$NODE_ENV"
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Agent Role Description & Startup Instructions
# ──────────────────────────────────────────────────────────────────────────────

case "$AGENT_ROLE" in
  sales)
    echo "Agent Description:"
    echo "  The Sales Agent manages customer relationships, lead qualification,"
    echo "  deal tracking, and sales pipeline automation. It communicates with"
    echo "  builders about their projects and opportunities."
    echo ""
    ;;
  marketing)
    echo "Agent Description:"
    echo "  The Marketing Agent handles SEO content, campaign management,"
    echo "  market research, and permit lead outreach. It coordinates marketing"
    echo "  initiatives across digital and traditional channels."
    echo ""
    ;;
  ops)
    echo "Agent Description:"
    echo "  The Operations Agent optimizes supply chain, predicts demand,"
    echo "  manages quality control, and streamlines fulfillment. It ensures"
    echo "  operational efficiency and cost optimization."
    echo ""
    ;;
  customer_success)
    echo "Agent Description:"
    echo "  The Customer Success Agent manages customer support, issue resolution,"
    echo "  retention programs, and satisfaction metrics. It proactively identifies"
    echo "  at-risk accounts and drives customer value."
    echo ""
    ;;
  intel)
    echo "Agent Description:"
    echo "  The Intelligence Agent analyzes market data, competitor pricing,"
    echo "  builder behavior, and business metrics. It generates insights for"
    echo "  strategic decision-making across the organization."
    echo ""
    ;;
  coordinator)
    echo "Agent Description:"
    echo "  The Coordinator Agent orchestrates inter-agent communication,"
    echo "  task distribution, and workflow management. It ensures all agents"
    echo "  work together efficiently toward business objectives."
    echo ""
    ;;
esac

echo "Startup Instructions:"
echo ""
echo "1. AUTHENTICATION"
echo "   The agent must authenticate with the platform before entering its"
echo "   main loop. This establishes identity and credentials:"
echo ""
echo "   POST $BASE_URL/api/agent/authenticate"
echo "   Body: { \"role\": \"$AGENT_ROLE\", \"instanceId\": \"$AGENT_INSTANCE_ID\" }"
echo ""
echo "   Store the returned authentication token in AGENT_TOKEN environment variable."
echo ""
echo "2. HEARTBEAT & TASK LOOP"
echo "   Once authenticated, the agent enters a continuous loop:"
echo ""
echo "   a) Send heartbeat to signal availability:"
echo "      POST $BASE_URL/api/agent/heartbeat"
echo "      Header: Authorization: Bearer \$AGENT_TOKEN"
echo "      Body: { \"role\": \"$AGENT_ROLE\", \"instanceId\": \"$AGENT_INSTANCE_ID\" }"
echo ""
echo "   b) Wait for task assignment or check for pending tasks:"
echo "      GET $BASE_URL/api/agent/tasks?role=$AGENT_ROLE"
echo "      Header: Authorization: Bearer \$AGENT_TOKEN"
echo ""
echo "   c) Execute assigned task (varies by task type and role)"
echo ""
echo "   d) Report task completion:"
echo "      POST $BASE_URL/api/agent/task-result"
echo "      Header: Authorization: Bearer \$AGENT_TOKEN"
echo "      Body: { \"taskId\": \"...\", \"status\": \"COMPLETED\", \"result\": {...} }"
echo ""
echo "   e) Repeat every 5-30 seconds depending on workload"
echo ""
echo "3. ERROR HANDLING & RECOVERY"
echo "   - If authentication fails, retry with exponential backoff (max 1 minute)"
echo "   - If heartbeat fails, assume network issue; reconnect automatically"
echo "   - If task fails, report the error and request new task"
echo "   - All errors logged to stdout and platform's audit system"
echo ""
echo "4. SHUTDOWN"
echo "   Send final heartbeat with status='SHUTTING_DOWN' before exit:"
echo "      POST $BASE_URL/api/agent/heartbeat"
echo "      Body: { ..., \"status\": \"SHUTTING_DOWN\" }"
echo ""
echo "═════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Ready for agent process to start."
echo "Next step: Authenticate and begin task loop."
echo ""
