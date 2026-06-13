#!/bin/bash
# Start Paper Trader Dashboard with Cloudflare Tunnel
# For s3zapp.us

cd /home/clawdbot/.openclaw/workspace/HyperLiquid-Bot

# Kill any existing processes on port 3456
pkill -f "cloudflared.*3456" 2>/dev/null
pkill -f "webhook-dashboard.*3456" 2>/dev/null
sleep 2

# Save domain
echo "s3zapp.us" > data/cloudflare-domain.txt

echo "🚀 Starting Paper Trader Dashboard..."
echo "=============================================================="

# Start dashboard
echo "[1/3] Starting dashboard server on port 3456..."
node webhook-dashboard.js --port=3456 > /tmp/dashboard.log 2>&1 &
DASH_PID=$!
sleep 3

# Verify dashboard is responding
if curl -s http://localhost:3456/api/traders > /dev/null 2>&1; then
    echo "      ✅ Dashboard responding on localhost:3456"
else
    echo "      ❌ Dashboard not responding"
    exit 1
fi

# Start tunnel
echo "[2/3] Starting Cloudflare tunnel..."
cloudflared tunnel --url "http://localhost:3456" > /tmp/tunnel.log 2>&1 &
TUNNEL_PID=$!

# Wait for URL
echo "[3/3] Waiting for public URL..."
for i in {1..15}; do
    URL=$(grep -oP 'https://[^\s]+\.trycloudflare\.com' /tmp/tunnel.log 2>/dev/null | head -1)
    if [ ! -z "$URL" ]; then
        echo ""
        echo "╔════════════════════════════════════════════════════════════╗"
        echo "║  🎉 DASHBOARD IS LIVE!                                     ║"
        echo "╠════════════════════════════════════════════════════════════╣"
        printf "║  Dashboard: %-43s║\n" "$URL"
        printf "║  Metrics:   %-43s║\n" "$URL/metrics"
        echo "║  Password:  4EsJ9QU$7ATNWjm                                ║"
        echo "╚════════════════════════════════════════════════════════════╝"
        echo ""
        echo "PIDs: Dashboard=$DASH_PID, Tunnel=$TUNNEL_PID"
        echo "Logs: /tmp/dashboard.log, /tmp/tunnel.log"
        echo ""
        echo "Press Ctrl+C to stop"
        
        # Save PIDs for cleanup
        echo "$DASH_PID $TUNNEL_PID" > /tmp/dashboard-pids.txt
        
        wait
        exit 0
    fi
    sleep 1
done

echo ""
echo "❌ Timeout waiting for URL"
echo "Check /tmp/tunnel.log for errors"
tail -20 /tmp/tunnel.log