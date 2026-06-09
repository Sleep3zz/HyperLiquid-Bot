#!/bin/bash
# Expose Dashboard - Interactive Setup
# 
# Usage: ./expose-dashboard.sh

DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${PORT:-3000}

echo "🌐 Dashboard Exposure Setup"
echo "=============================================================="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "📦 Installing cloudflared..."
    curl -L --output /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
    sudo dpkg -i /tmp/cloudflared.deb
    rm /tmp/cloudflared.deb
fi

# Check authentication
if [ ! -f ~/.cloudflared/cert.pem ]; then
    echo "🔐 You need to authenticate with Cloudflare first."
    echo ""
    echo "This will open a browser for you to log in to Cloudflare."
    echo ""
    read -p "Press Enter to open browser and authenticate..."
    
    cloudflared tunnel login
    
    if [ ! -f ~/.cloudflared/cert.pem ]; then
        echo "❌ Authentication failed"
        exit 1
    fi
    echo "✅ Authenticated!"
    echo ""
fi

echo "Choose exposure method:"
echo ""
echo "[1] Quick Temporary URL (random.trycloudflare.com)"
echo "    - Fastest setup, no domain needed"
echo "    - URL changes each time you restart"
echo ""
echo "[2] Your Custom Domain (trading.yourdomain.com)"
echo "    - Permanent URL"
echo "    - Requires domain in Cloudflare"
echo ""
read -p "Enter 1 or 2: " CHOICE

if [ "$CHOICE" = "1" ]; then
    # Quick tunnel
    echo ""
    echo "🚀 Starting dashboard with quick tunnel..."
    echo "=============================================================="
    echo ""
    
    # Start dashboard
    node "$DASHBOARD_DIR/webhook-dashboard.js" --port=$PORT &
    DASHBOARD_PID=$!
    
    sleep 3
    
    echo "🔗 Starting Cloudflare tunnel..."
    echo "Waiting for public URL..."
    echo ""
    
    cloudflared tunnel --url "http://localhost:$PORT" 2>&1 | tee /tmp/tunnel.log | while read line; do
        if echo "$line" | grep -q "trycloudflare.com"; then
            URL=$(echo "$line" | grep -oP 'https://[^\s]+trycloudflare\.com' | head -1)
            if [ ! -z "$URL" ]; then
                echo ""
                echo "╔══════════════════════════════════════════════════════════════╗"
                echo "║  🎉 YOUR DASHBOARD IS LIVE!                                  ║"
                echo "╠══════════════════════════════════════════════════════════════╣"
                echo "║                                                              ║"
                echo "║  URL:       $URL"
                echo "║  Password:  sleep3zz                                         ║"
                echo "║                                                              ║"
                echo "╚══════════════════════════════════════════════════════════════╝"
                echo ""
                echo "Press Ctrl+C to stop"
            fi
        fi
    done &
    
    TUNNEL_PID=$!
    
    cleanup() {
        echo ""
        echo "🛑 Stopping..."
        kill $TUNNEL_PID 2>/dev/null
        kill $DASHBOARD_PID 2>/dev/null
        exit 0
    }
    
    trap cleanup SIGINT SIGTERM
    wait
    
elif [ "$CHOICE" = "2" ]; then
    # Custom domain
    read -p "Enter your Cloudflare domain (e.g., yourdomain.com): " DOMAIN
    
    if [ -z "$DOMAIN" ]; then
        echo "❌ Domain required"
        exit 1
    fi
    
    # Save domain
    mkdir -p "$DASHBOARD_DIR/data"
    echo "$DOMAIN" > "$DASHBOARD_DIR/data/cloudflare-domain.txt"
    
    # Check if tunnel exists
    TUNNEL_NAME="hyperliquid-dashboard"
    
    if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
        echo "✅ Existing tunnel found"
        TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
    else
        echo "🔧 Creating new tunnel..."
        cloudflared tunnel create "$TUNNEL_NAME"
        TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
        
        # Create DNS record
        echo "🌐 Creating DNS record: trading.$DOMAIN"
        cloudflared tunnel route dns "$TUNNEL_NAME" "trading.$DOMAIN"
    fi
    
    # Create config
    CONFIG_FILE="$DASHBOARD_DIR/cloudflared-dashboard.yml"
    cat > "$CONFIG_FILE" << EOF
tunnel: $TUNNEL_ID
credentials-file: ~/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: trading.$DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
EOF
    
    echo ""
    echo "🚀 Starting dashboard..."
    node "$DASHBOARD_DIR/webhook-dashboard.js" --port=$PORT &
    DASHBOARD_PID=$!
    
    sleep 3
    
    echo "🔗 Starting Cloudflare tunnel..."
    cloudflared tunnel --config "$CONFIG_FILE" run &
    TUNNEL_PID=$!
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  🎉 YOUR DASHBOARD IS LIVE!                                  ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║                                                              ║"
    echo "║  URL:       https://trading.$DOMAIN"
    echo "║  Password:  sleep3zz                                         ║"
    echo "║                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Press Ctrl+C to stop"
    
    cleanup() {
        echo ""
        echo "🛑 Stopping..."
        kill $TUNNEL_PID 2>/dev/null
        kill $DASHBOARD_PID 2>/dev/null
        exit 0
    }
    
    trap cleanup SIGINT SIGTERM
    wait
    
else
    echo "❌ Invalid choice"
    exit 1
fi