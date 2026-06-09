#!/bin/bash
# Start Paper Traders for Top 5 Coins
# ARB, HYPE, ETH, UNI, BTC

cd /home/clawdbot/.openclaw/workspace/HyperLiquid-Bot

COINS=("ARB" "HYPE" "ETH" "UNI" "BTC")
CAPITAL=1000
PORT_BASE=3456

echo "🚀 Starting Paper Traders for Top 5 Coins"
echo "=============================================================="
echo "Coins: ${COINS[*]}"
echo "Capital per coin: $CAPITAL"
echo ""

# Kill any existing paper traders
pkill -f "paper-trader.js" 2>/dev/null
sleep 2

# Start dashboard first (on port 3456)
echo "[1/6] Starting dashboard on port $PORT_BASE..."
node webhook-dashboard.js --port=$PORT_BASE > /tmp/dashboard.log 2>&1 &
DASH_PID=$!
sleep 3

if curl -s http://localhost:$PORT_BASE/api/traders > /dev/null 2>&1; then
    echo "      ✅ Dashboard running"
else
    echo "      ❌ Dashboard failed to start"
    exit 1
fi

# Start paper traders for each coin (they don't need separate ports, just the dashboard)
# Actually, the paper traders write to data files, dashboard reads from them
echo ""
echo "Starting paper traders..."

for i in "${!COINS[@]}"; do
    COIN="${COINS[$i]}"
    echo "[$(($i+2))/6] Starting $COIN paper trader..."
    
    node paper-trader.js --coin "$COIN" --capital $CAPITAL > "/tmp/paper-trader-$COIN.log" 2>&1 &
    echo $! > "/tmp/paper-trader-$COIN.pid"
    
    sleep 2
    echo "      ✅ $COIN started"
done

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🎉 PAPER TRADERS STARTED!                                 ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║                                                            ║"
echo "║  Dashboard: https://trading.s3zapp.us                     ║"
echo "║  Password:  sleep3zz                                       ║"
echo "║                                                            ║"
echo "║  Active Coins:                                             ║"
echo "║  • ARB  - Mean-Reversion (4x lev, 12% pos)                 ║"
echo "║  • HYPE - Mean-Reversion (4x lev, 12% pos)                 ║"
echo "║  • ETH  - Mean-Reversion (4x lev, 12% pos)                 ║"
echo "║  • UNI  - Mean-Reversion (4x lev, 12% pos)                 ║"
echo "║  • BTC  - Mean-Reversion (4x lev, 12% pos)                 ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "To stop all traders:"
echo "  pkill -f 'paper-trader.js'"
echo "  pkill -f 'webhook-dashboard'"
echo ""

# Save all PIDs
echo "$DASH_PID" > /tmp/dashboard.pid

echo "Press Ctrl+C to stop all"

wait