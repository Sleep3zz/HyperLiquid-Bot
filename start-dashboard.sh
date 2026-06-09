#!/bin/bash
# Start Paper Trader Dashboard with Permanent Cloudflare Tunnel
# URL: https://trading.s3zapp.us

cd /home/clawdbot/.openclaw/workspace/HyperLiquid-Bot

PORT=3456
TUNNEL_NAME="hyperliquid-dashboard"
DOMAIN="s3zapp.us"
TUNNEL_ID="3e32e5c8-6625-44e6-b24d-96996e3a02df"

# Kill existing processes
pkill -f "webhook-dashboard.*$PORT" 2>/dev/null
pkill -f "cloudflared.*$PORT" 2>/dev/null
sleep 2

echo "🚀 Starting Paper Trader Dashboard"
echo "=============================================================="
echo "Domain: $DOMAIN"
echo "URL: https://trading.$DOMAIN"
echo ""

# Create config file if not exists
CONFIG_FILE="cloudflared-dashboard.yml"
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << EOF
tunnel: $TUNNEL_ID
credentials-file: ~/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: trading.$DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
EOF
    echo "✅ Created config: $CONFIG_FILE"
fi

# Start dashboard
echo "[1/2] Starting dashboard server on port $PORT..."
node webhook-dashboard.js --port=$PORT > /tmp/dashboard.log 2>&1 &
DASH_PID=$!
sleep 3

# Verify dashboard is responding
if ! curl -s http://localhost:$PORT/api/traders > /dev/null 2>&1; then
    echo "      ❌ Dashboard failed to start"
    echo "      Check /tmp/dashboard.log"
    exit 1
fi
echo "      ✅ Dashboard running on localhost:$PORT"

# Start tunnel
echo "[2/2] Starting Cloudflare tunnel..."
cloudflared tunnel --config "$CONFIG_FILE" run > /tmp/tunnel.log 2>&1 &
TUNNEL_PID=$!

sleep 5

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🎉 DASHBOARD IS LIVE!                                     ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║                                                            ║"
echo "║  🌐 URL: https://trading.s3zapp.us                        ║"
echo "║                                                            ║"
echo "║  🔒 Password: sleep3zz                                     ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Dashboard PID: $DASH_PID"
echo "Tunnel PID:    $TUNNEL_PID"
echo ""
echo "Logs:"
echo "  Dashboard: tail -f /tmp/dashboard.log"
echo "  Tunnel:    tail -f /tmp/tunnel.log"
echo ""
echo "Press Ctrl+C to stop"

# Save PIDs
echo "$DASH_PID $TUNNEL_PID" > /tmp/dashboard-pids.txt

# Handle shutdown
cleanup() {
    echo ""
    echo "🛑 Stopping dashboard..."
    kill $TUNNEL_PID 2>/dev/null
    kill $DASH_PID 2>/dev/null
    wait
    echo "✅ Stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

wait