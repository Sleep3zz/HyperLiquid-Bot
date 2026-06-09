#!/bin/bash
# Start Dashboard with ngrok (simpler than cloudflared)
# 
# Usage: ./start-ngrok.sh

cd /home/clawdbot/.openclaw/workspace/HyperLiquid-Bot
PORT=3456

# Kill existing processes
pkill -f "webhook-dashboard.*$PORT" 2>/dev/null
pkill -f "ngrok.*$PORT" 2>/dev/null
sleep 2

echo "🚀 Starting Paper Trader Dashboard with ngrok"
echo "=============================================================="

# Save domain
echo "s3zapp.us" > data/cloudflare-domain.txt

# Start dashboard
echo "[1/3] Starting dashboard on port $PORT..."
node webhook-dashboard.js --port=$PORT > /tmp/dashboard.log 2>&1 &
DASH_PID=$!
sleep 3

# Verify dashboard
if ! curl -s http://localhost:$PORT/api/traders > /dev/null 2>&1; then
    echo "      ❌ Dashboard failed to start"
    exit 1
fi
echo "      ✅ Dashboard running"

# Start ngrok
echo "[2/3] Starting ngrok tunnel..."
npx ngrok http $PORT --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for ngrok to initialize
echo "[3/3] Waiting for public URL..."
for i in {1..20}; do
    URL=$(grep -oP 'https://[a-z0-9]+\.ngrok\.io' /tmp/ngrok.log 2>/dev/null | head -1)
    if [ ! -z "$URL" ]; then
        echo ""
        echo "╔════════════════════════════════════════════════════════════╗"
        echo "║  🎉 DASHBOARD IS LIVE!                                     ║"
        echo "╠════════════════════════════════════════════════════════════╣"
        printf "║  URL:       %-45s║\n" "$URL"
        echo "║  Password:  sleep3zz                                       ║"
        echo "╚════════════════════════════════════════════════════════════╝"
        echo ""
        echo "PIDs: Dashboard=$DASH_PID, ngrok=$NGROK_PID"
        echo ""
        echo "Press Ctrl+C to stop"
        
        echo "$DASH_PID $NGROK_PID" > /tmp/dashboard-pids.txt
        
        # Show the ngrok inspect interface
        echo ""
        echo "📊 Inspect traffic at: http://localhost:4040"
        echo ""
        
        wait
        exit 0
    fi
    sleep 1
done

echo ""
echo "❌ Timeout waiting for ngrok URL"
echo "Check /tmp/ngrok.log for errors:"
tail -30 /tmp/ngrok.log