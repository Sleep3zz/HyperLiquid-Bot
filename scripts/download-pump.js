#!/usr/bin/env node
/**
 * Download PUMP candle data
 */

const fs = require('fs');
const path = require('path');
const WayfinderAgent = require('../../model-router/src/agents/wayfinder-agent');

const DATA_DIR = path.join(__dirname, '..', 'data', 'charts', 'PUMP');

async function downloadPumpData() {
    console.log('=== Downloading PUMP/15m data ===\n');
    
    const agent = new WayfinderAgent({ autoConnect: false });
    
    try {
        // Fetch 90 days of data (100 candles per request, ~96 per day)
        const candles = await agent.getHistoricalCandles('PUMP', '15m', 5760);
        
        console.log(`Fetched ${candles.length} candles`);
        
        if (candles.length === 0) {
            console.log('No data returned');
            return;
        }
        
        // Ensure directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        
        // Format for chart storage
        const chartData = {
            metadata: {
                coin: 'PUMP',
                interval: '15m',
                candles: candles.length,
                days: (candles.length / 96).toFixed(1),
                startTime: new Date(candles[0].t).toISOString(),
                endTime: new Date(candles[candles.length - 1].t).toISOString(),
                downloadedAt: new Date().toISOString()
            },
            candles: candles.map(c => ({
                t: Number(c.t),
                o: Number(c.o),
                h: Number(c.h),
                l: Number(c.l),
                c: Number(c.c),
                v: Number(c.v)
            }))
        };
        
        // Save to file
        const filePath = path.join(DATA_DIR, 'PUMP-15m-90d.json');
        fs.writeFileSync(filePath, JSON.stringify(chartData, null, 2));
        
        console.log(`\n✅ Saved ${candles.length} candles to ${filePath}`);
        console.log(`Date range: ${chartData.metadata.startTime.split('T')[0]} to ${chartData.metadata.endTime.split('T')[0]}`);
        console.log(`Latest price: $${candles[candles.length - 1].c}`);
        
    } catch (err) {
        console.error('Error:', err.message);
    }
}

downloadPumpData();
