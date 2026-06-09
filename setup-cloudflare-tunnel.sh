#!/bin/bash
# Cloudflare Tunnel Setup for Paper Trader Dashboard
# 
# This script sets up a permanent Cloudflare tunnel for your dashboard
# 
# Prerequisites:
#   - Cloudflare account
#   - Domain added to Cloudflare
#   - cloudflared installed
#
# Usage: ./setup-cloudflare-tunnel.sh

DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${PORT:-3000}
TUNNEL_NAME="hyperliquid-dashboard"

echo "🚀 Cloudflare Tunnel Setup for Paper Trader Dashboard"
echo "=============================================================="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "📦 Installing cloudflared..."
    
    # Detect architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ]; then
        CF_ARCH="amd64"
    elif [ "$ARCH" = "aarch64" ]; then
        CF_ARCH="arm64"
    else
        CF_ARCH="amd64"
    fi
    
    # Download and install
    curl -L --output cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb"
    sudo dpkg -i cloudflared.deb
    rm cloudflared.deb
    
    echo "✅ cloudflared installed"
    echo ""
fi

# Check if already authenticated
if [ ! -f ~/.cloudflared/cert.pem ]; then
    echo "🔐 Cloudflare Authentication Required"
    echo ""
    echo "You need to authenticate cloudflared with your Cloudflare account."
    echo "This will open a browser window for you to log in."
    echo ""
    read -p "Press Enter to continue..."
    echo ""
    
    cloudflared tunnel login
    
    if [ ! -f ~/.cloudflared/cert.pem ]; then
        echo "❌ Authentication failed. Please try again."
        exit 1
    fi
    
    echo "✅ Authenticated with Cloudflare"
    echo ""
fi

# List existing tunnels
echo "📋 Checking existing tunnels..."
cloudflared tunnel list

# Create or use existing tunnel
if cloudflared tunnel list | grep -q "$TUNNEL_NAME"; then
    echo ""
    echo "✅ Tunnel '$TUNNEL_NAME' already exists"
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
else
    echo ""
    echo "🔧 Creating new tunnel: $TUNNEL_NAME"
    cloudflared tunnel create "$TUNNEL_NAME"
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
fi

echo ""
echo "Tunnel ID: $TUNNEL_ID"
echo ""

# Get user's domain
read -p "Enter your Cloudflare domain (e.g., yourdomain.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "❌ Domain is required"
    exit 1
fi

# Configure tunnel
echo ""
echo "🔧 Configuring tunnel..."

CONFIG_FILE="$DASHBOARD_DIR/cloudflared-config.yml"

cat > "$CONFIG_FILE" << EOF
tunnel: $TUNNEL_ID
credentials-file: ~/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: trading.$DOMAIN
    service: http://localhost:$PORT
  - hostname: dashboard.$DOMAIN
    service: http://localhost:$PORT
  - service: http_status:404
EOF

echo "✅ Configuration saved to: $CONFIG_FILE"
echo ""

# Create DNS records
echo "🌐 Creating DNS records..."
cloudflared tunnel route dns "$TUNNEL_NAME" "trading.$DOMAIN"
cloudflared tunnel route dns "$TUNNEL_NAME" "dashboard.$DOMAIN"

echo ""
echo "✅ DNS records created:"
echo "   - trading.$DOMAIN"
echo "   - dashboard.$DOMAIN"
echo ""

# Create systemd service for auto-start
SERVICE_FILE="/tmp/cloudflared-$TUNNEL_NAME.service"

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Cloudflare Tunnel for Paper Trader Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/cloudflared tunnel --config "$CONFIG_FILE" run
Restart=always
RestartSec=5
User=$USER

[Install]
WantedBy=multi-user.target
EOF

echo "🔧 Systemd service created"
echo ""
echo "To install the service (optional):"
echo "  sudo cp $SERVICE_FILE /etc/systemd/system/"
echo "  sudo systemctl enable cloudflared-$TUNNEL_NAME"
echo "  sudo systemctl start cloudflared-$TUNNEL_NAME"
echo ""

# Create start script
START_SCRIPT="$DASHBOARD_DIR/start-cloudflare-dashboard.sh"

cat > "$START_SCRIPT" << EOF
#!/bin/bash
# Start Cloudflare Tunnel for Dashboard

cd "$DASHBOARD_DIR"

# Start dashboard
echo "🚀 Starting dashboard on port $PORT..."
node webhook-dashboard.js --port=$PORT &
DASHBOARD_PID=\$!

# Start tunnel
echo "🌐 Starting Cloudflare tunnel..."
cloudflared tunnel --config "$CONFIG_FILE" run &
TUNNEL_PID=\$!

echo ""
echo "=============================================================="
echo "✅ Dashboard running!"
echo ""
echo "Local:      http://localhost:$PORT"
echo "Cloudflare: https://trading.$DOMAIN"
echo "            https://dashboard.$DOMAIN"
echo ""
echo "Password:   sleep3zz"
echo "=============================================================="
echo ""
echo "Press Ctrl+C to stop"

# Handle shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill \$TUNNEL_PID 2>/dev/null
    kill \$DASHBOARD_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

wait
EOF

chmod +x "$START_SCRIPT"

echo "✅ Start script created: $START_SCRIPT"
echo ""

# Summary
echo "=============================================================="
echo "🎉 SETUP COMPLETE!"
echo "=============================================================="
echo ""
echo "Your dashboard will be available at:"
echo "  https://trading.$DOMAIN"
echo "  https://dashboard.$DOMAIN"
echo ""
echo "Password: sleep3zz"
echo ""
echo "To start the dashboard with Cloudflare tunnel:"
echo "  $START_SCRIPT"
echo ""
echo "Or manually:"
echo "  # Terminal 1: Start dashboard"
echo "  node webhook-dashboard.js"
echo ""
echo "  # Terminal 2: Start tunnel"
echo "  cloudflared tunnel --config $CONFIG_FILE run"
echo ""
echo "=============================================================="
echo ""
echo "💡 To run automatically on boot:"
echo "  sudo systemctl enable --now cloudflared-$TUNNEL_NAME"
echo ""

# Save domain info
mkdir -p "$DASHBOARD_DIR/data"
echo "$DOMAIN" > "$DASHBOARD_DIR/data/cloudflare-domain.txt"
echo "$TUNNEL_ID" > "$DASHBOARD_DIR/data/cloudflare-tunnel-id.txt"

echo "✅ Configuration saved to data/ directory"
echo ""