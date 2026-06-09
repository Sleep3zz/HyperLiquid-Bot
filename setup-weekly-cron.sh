#!/bin/bash
# Setup Weekly Parameter Update Cron Job
# 
# Usage: ./setup-weekly-cron.sh

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$BOT_DIR/weekly-update.log"

# Check if cron is available
if ! command -v crontab &> /dev/null; then
    echo "❌ crontab not found. Please install cron:"
    echo "   sudo apt-get install cron  (Debian/Ubuntu)"
    echo "   sudo yum install cronie      (CentOS/RHEL)"
    exit 1
fi

echo "Setting up weekly parameter update..."
echo "Bot directory: $BOT_DIR"
echo "Log file: $LOG_FILE"

# Create cron entry
CRON_ENTRY="0 0 * * 0 cd $BOT_DIR && node weekly-update.js >> $LOG_FILE 2>&1"

# Add to crontab
echo "Adding cron job (runs every Sunday at midnight)..."
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

# Verify
echo ""
echo "✅ Cron job added!"
echo ""
echo "Current crontab entries:"
crontab -l | grep -E "(weekly-update|COMMAND)"
echo ""
echo "To manually run the update:"
echo "  cd $BOT_DIR && node weekly-update.js"
echo ""
echo "To view logs:"
echo "  tail -f $LOG_FILE"
echo ""
echo "To remove the cron job:"
echo "  crontab -e"
echo "  # Delete the line containing 'weekly-update'"