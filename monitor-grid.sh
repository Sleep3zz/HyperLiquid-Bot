#!/bin/bash

# Simple GridStrategy Monitor
# Usage: ./monitor-grid.sh [container-name]
# 
# Color coding:
#   Green  = Position close realized (good)
#   Yellow = Fallback PnL (warning)
#   Red    = WARN/ERROR
#   Cyan   = Debug messages
#   White  = Regular GRID logs

CONTAINER_NAME=${1:-trading-bot}

echo "========================================"
echo " GridStrategy Monitor"
echo "========================================"
echo "Container: $CONTAINER_NAME"
echo "Press Ctrl+C to stop"
echo "========================================"
echo ""

# Check if container exists
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "ERROR: Container '$CONTAINER_NAME' not found"
    echo ""
    echo "Available containers:"
    docker ps --format "  - {{.Names}}"
    exit 1
fi

# Tail logs with color coding
docker logs -f "$CONTAINER_NAME" 2>&1 | grep --line-buffered -E '\[GRID\]|\[GRID-DEBUG\]' | while read -r line; do
    timestamp=$(date '+%H:%M:%S')
    
    # Color coding for important events
    if echo "$line" | grep -q "Position close realized"; then
        # Green - successful PnL capture
        echo -e "\033[32m[$timestamp] $line\033[0m"
    elif echo "$line" | grep -q "fallback"; then
        # Yellow - fallback PnL (couldn't capture from fills)
        echo -e "\033[33m[$timestamp] $line\033[0m"
    elif echo "$line" | grep -qE "WARN|ERROR|Error|error"; then
        # Red - warnings and errors
        echo -e "\033[31m[$timestamp] $line\033[0m"
    elif echo "$line" | grep -q "\[GRID-DEBUG\]"; then
        # Cyan - debug messages
        echo -e "\033[36m[$timestamp] $line\033[0m"
    else
        # White - regular GRID logs
        echo "[$timestamp] $line"
    fi
done
