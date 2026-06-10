#!/bin/bash
# Start Dashboard with Quick Cloudflare Tunnel
# 
# For s3zapp.us - Creates temporary public URL
# 
# Usage: ./start-s3zapp.sh

DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3456
DOMAIN="s3zapp.us"

echo "🚀 Starting Paper Trader Dashboard for $DOMAIN"
echo "=============================================================="
echo ""

# Save domain
mkdir -p "$DASHBOARD_DIR/data"
echo "$DOMAIN" > "$DASHBOARD_DIR/data/cloudflare-domain.txt"

# Check cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "📦 Installing cloudflared..."
    curl -L --output /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" 2>/dev/null
    sudo dpkg -i /tmp/cloudflared.deb 2>/dev/null
fi

# Start dashboard
echo "🌐 Starting dashboard on port $PORT..."
node "$DASHBOARD_DIR/webhook-dashboard.js" --port=$PORT &
DASHBOARD_PID=$!

sleep 3

# Start quick tunnel
echo "🔗 Starting Cloudflare Quick Tunnel..."
echo "   Your URL will appear below..."
echo ""

cloudflared tunnel --url "http://localhost:$PORT" 2>&1 | while read line; do
    echo "$line"
    # Extract URL
    if echo "$line" | grep -q "trycloudflare.com"; then
        URL=$(echo "$line" | grep -oP 'https://[^\s]+\.trycloudflare\.com' | head -1)
        if [ ! -z "$URL" ]; then
            echo ""
            echo "╔══════════════════════════════════════════════════════════════╗"
            echo "║  🎉 DASHBOARD IS LIVE!                                       ║"
            echo "╠══════════════════════════════════════════════════════════════╣"
            echo "║                                                              ║"
            printf "║  URL:       %-49s║\n" "$URL"
            echo "║  Password:  sleep3zz                                         ║"
            echo "║                                                              ║"
            echo "╚══════════════════════════════════════════════════════════════╝"
            echo ""
            echo "📝 Note: For permanent URL (trading.s3zapp.us):"
            echo "   Run: cloudflared tunnel login"
            echo "   Then: ./setup-cloudflare-tunnel.sh"
            echo ""
        fi
    fi
done &

TUNNEL_PID=$!

echo "Press Ctrl+C to stop"

# Handle shutdown
cleanup() {
    echo ""
    echo "🛑 Stopping..."
    kill $TUNNEL_PID 2>/dev/null
    kill $DASHBOARD_PID 2>/dev/null
    wait
    exit 0
}

trap cleanup SIGINT SIGTERM
wait