#!/bin/bash
# Start Webhook Dashboard with Public URL
# 
# Usage: ./start-dashboard.sh [--subdomain mybot]

DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${PORT:-3000}
SUBDOMAIN=${1:---subdomain=hyperliquid-bot}

cd "$DASHBOARD_DIR"

echo "🚀 Starting Paper Trader Dashboard..."
echo "=============================================="

# Check if localtunnel is installed
if ! command -v lt &> /dev/null; then
    echo "📦 Installing localtunnel..."
    npm install -g localtunnel
fi

# Start the dashboard server in background
echo "🌐 Starting dashboard server on port $PORT..."
node webhook-dashboard.js --port=$PORT &
DASHBOARD_PID=$!

# Wait for server to start
sleep 3

# Check if server is running
if ! kill -0 $DASHBOARD_PID 2>/dev/null; then
    echo "❌ Failed to start dashboard server"
    exit 1
fi

echo "✅ Dashboard server started (PID: $DASHBOARD_PID)"
echo ""

# Start localtunnel
echo "📡 Exposing to internet via localtunnel..."
echo "   Subdomain: ${SUBDOMAIN#--subdomain=}"
echo ""

# Store the public URL when available
lt --port $PORT $SUBDOMAIN &
TUNNEL_PID=$!

echo ""
echo "=============================================="
echo "Dashboard is starting up..."
echo ""
echo "Local:     http://localhost:$PORT"
echo "Password:  sleep3zz"
echo ""
echo "Public URL will appear above (ending in .loca.lt)"
echo "=============================================="
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Handle shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $TUNNEL_PID 2>/dev/null
    kill $DASHBOARD_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Keep script running
wait