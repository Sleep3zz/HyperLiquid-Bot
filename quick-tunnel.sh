#!/bin/bash
# Quick Cloudflare Tunnel - Minimal Setup
# 
# For users who already have cloudflared authenticated
# 
# Usage: ./quick-tunnel.sh [domain]

DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${PORT:-3000}
DOMAIN=${1:-}

echo "🚀 Quick Cloudflare Tunnel Setup"
echo "=============================================================="
echo ""

# Check cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared not found. Install first:"
    echo "   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb"
    echo "   sudo dpkg -i cloudflared.deb"
    exit 1
fi

# Check authentication
if [ ! -f ~/.cloudflared/cert.pem ]; then
    echo "🔐 Not authenticated with Cloudflare."
    echo "   Run: cloudflared tunnel login"
    echo ""
    read -p "Authenticate now? (y/n): " AUTH
    if [ "$AUTH" = "y" ]; then
        cloudflared tunnel login
    else
        exit 1
    fi
fi

# Get domain if not provided
if [ -z "$DOMAIN" ]; then
    # Try to load from saved config
    if [ -f "$DASHBOARD_DIR/data/cloudflare-domain.txt" ]; then
        DOMAIN=$(cat "$DASHBOARD_DIR/data/cloudflare-domain.txt")
        echo "📋 Using saved domain: $DOMAIN"
    else
        read -p "Enter your Cloudflare domain: " DOMAIN
    fi
fi

if [ -z "$DOMAIN" ]; then
    echo "❌ Domain required"
    exit 1
fi

# Save domain
mkdir -p "$DASHBOARD_DIR/data"
echo "$DOMAIN" > "$DASHBOARD_DIR/data/cloudflare-domain.txt"

# Create temp config
CONFIG_FILE="/tmp/cloudflare-temp-config.yml"
cat > "$CONFIG_FILE" << EOF
url: http://localhost:$PORT
tunnel: temp
EOF

echo ""
echo "🌐 Starting Cloudflare Quick Tunnel..."
echo "   Domain: $DOMAIN"
echo "   Port: $PORT"
echo ""
echo "Your public URL will appear below (ending in .trycloudflare.com)"
echo "=============================================================="
echo ""

# Start the dashboard in background
echo "🚀 Starting dashboard..."
node "$DASHBOARD_DIR/webhook-dashboard.js" --port=$PORT &
DASHBOARD_PID=$!

sleep 3

# Start the tunnel
echo "🔗 Starting tunnel..."
cloudflared tunnel --url "http://localhost:$PORT" 2>&1 | while read line; do
    echo "$line"
    # Extract and display the URL
    if echo "$line" | grep -q "https://.*trycloudflare.com"; then
        URL=$(echo "$line" | grep -o "https://[^[:space:]]*trycloudflare.com")
        echo ""
        echo "=============================================================="
        echo "🎉 YOUR DASHBOARD IS LIVE!"
        echo "=============================================================="
        echo ""
        echo "🔗 Public URL: $URL"
        echo "🔒 Password:   sleep3zz"
        echo ""
        echo "=============================================================="
    fi
done &

TUNNEL_PID=$!

echo ""
echo "Press Ctrl+C to stop"

# Handle shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $TUNNEL_PID 2>/dev/null
    kill $DASHBOARD_PID 2>/dev/null
    wait
    exit 0
}

trap cleanup SIGINT SIGTERM

wait