#!/bin/bash
# Setup script for HyperLiquidAlgoBot Wayfinder integration

set -e

echo "========================================"
echo "HyperLiquidAlgoBot Setup"
echo "========================================"
echo ""

# Check Wayfinder SDK path
WAYFINDER_SDK="/home/clawdbot/wayfinder-paths-sdk"
if [ ! -d "$WAYFINDER_SDK" ]; then
    echo "✗ Wayfinder SDK not found at $WAYFINDER_SDK"
    exit 1
fi

echo "✓ Wayfinder SDK found: $WAYFINDER_SDK"

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo ""
    echo "Creating .env file..."
    cat > .env << EOF
# Wayfinder SDK Configuration
WAYFINDER_SDK_PATH=$WAYFINDER_SDK
WAYFINDER_WALLET_LABEL=main

# Trading Mode (set to false for live trading)
DRY_RUN=true

# Debug mode
DEBUG=true
EOF
    echo "✓ Created .env file"
    echo "  ⚠ Please edit .env and add your Hyperliquid credentials"
else
    echo "✓ .env file already exists"
fi

echo ""
echo "Configuration Summary:"
echo "  WAYFINDER_SDK_PATH: $WAYFINDER_SDK"
echo "  WAYFINDER_WALLET_LABEL: main"
echo "  DRY_RUN: true (safe mode)"
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your credentials:"
echo "     AGENT_PRIVATE_KEY_TEST=your_key"
echo "     AGENT_ADDRESS=your_address"
echo "     NETWORK_TYPE=testnet"
echo ""
echo "  2. Test the integration:"
echo "     node test-wayfinder.js"
echo ""
echo "  3. Run backtest with ML optimization:"
echo "     node src/backtesting/ml_optimize.js --market BTC-PERP"
echo ""
echo "  4. For live trading (after testing):"
echo "     Set DRY_RUN=false in .env"
echo "     npm run live -- --use-wayfinder"
echo ""
echo "========================================"
