#!/usr/bin/env node
/**
 * Pre-compute indicators using trading-signals
 * 
 * Runs once per coin, saves all indicator values to disk.
 * Backtests then read these pre-computed values (fast O(1) lookup).
 * 
 * Usage: node scripts/precompute-indicators.js --coin ETH [--interval 15m]
 */

const fs = require('fs');
const path = require('path');
const { RSI, BollingerBands, ADX } = require("trading-signals");

function loadCandles(coin, interval) {
    const filePath = path.join(__dirname, '..', 'data', 'charts', coin, `${coin}-${interval}-90d.json`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Candle file not found: ${filePath}`);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.candles || data;
}

function normalizeCandles(candles) {
    return candles
        .map(c => ({
            t: Number(c.t ?? c.openTime),
            o: Number(c.o ?? c.open),
            h: Number(c.h ?? c.high),
            l: Number(c.l ?? c.low),
            c: Number(c.c ?? c.close),
            v: Number(c.v ?? c.volume ?? 0)
        }))
        .filter(c => [c.t, c.h, c.l, c.c].every(Number.isFinite))
        .sort((a, b) => a.t - b.t);
}

function num(v) {
    if (v == null) return null;
    const n = typeof v === "object" && typeof v.valueOf === "function" 
        ? Number(v.valueOf()) 
        : Number(v);
    return Number.isFinite(n) ? n : null;
}

function safeResult(indicator) {
    try {
        return indicator.getResult();
    } catch {
        return null;
    }
}

async function precomputeIndicators(coin, interval = '15m') {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Pre-computing indicators for ${coin}/${interval}`);
    console.log('='.repeat(60));
    
    const startTime = Date.now();
    
    // Load candles
    const rawCandles = loadCandles(coin, interval);
    const candles = normalizeCandles(rawCandles);
    console.log(`Loaded ${candles.length} candles`);
    
    // Initialize indicators
    const rsi = new RSI(14);
    const bb = new BollingerBands(20, 2);
    const adx = new ADX(14);
    
    // Pre-allocate arrays
    const results = {
        coin,
        interval,
        candles: candles.length,
        params: {
            rsiPeriod: 14,
            bbPeriod: 20,
            bbStdDev: 2,
            adxPeriod: 14
        },
        values: []
    };
    
    // Process each candle
    console.log('Computing indicators...');
    const processStart = Date.now();
    
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        
        // Update indicators
        rsi.update(c.c);
        bb.update(c.c);
        adx.update({ high: c.h, low: c.l, close: c.c });
        
        // Read values (null if not warmed up)
        const rsiVal = num(safeResult(rsi));
        const bbRes = safeResult(bb);
        const adxVal = num(safeResult(adx));
        
        results.values.push({
            t: c.t,
            rsi: rsiVal,
            adx: adxVal,
            bbLower: bbRes ? num(bbRes.lower) : null,
            bbMiddle: bbRes ? num(bbRes.middle) : null,
            bbUpper: bbRes ? num(bbRes.upper) : null
        });
        
        // Progress every 1000 bars
        if ((i + 1) % 1000 === 0) {
            const elapsed = Date.now() - processStart;
            const pct = ((i + 1) / candles.length * 100).toFixed(1);
            console.log(`  ${pct}% complete (${i + 1}/${candles.length}) - ${elapsed}ms`);
        }
    }
    
    const computeTime = Date.now() - processStart;
    console.log(`\nComputed ${results.values.length} indicator sets in ${computeTime}ms`);
    
    // Save to disk
    const outputDir = path.join(__dirname, '..', 'data', 'indicators', coin);
    fs.mkdirSync(outputDir, { recursive: true });
    
    const outputFile = path.join(outputDir, `${interval}-indicators.json`);
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    
    const totalTime = Date.now() - startTime;
    console.log(`\nSaved to: ${outputFile}`);
    console.log(`Total time: ${totalTime}ms`);
    
    // Validation sample
    const sampleIdx = Math.min(4138, results.values.length - 1);
    const sample = results.values[sampleIdx];
    console.log(`\nSample (bar ${sampleIdx}):`);
    console.log(`  RSI: ${sample.rsi?.toFixed(2)}`);
    console.log(`  ADX: ${sample.adx?.toFixed(2)}`);
    console.log(`  BB.lower: ${sample.bbLower?.toFixed(2)}`);
    console.log(`  BB.upper: ${sample.bbUpper?.toFixed(2)}`);
    
    return results;
}

// CLI
async function main() {
    const args = process.argv.slice(2);
    let coin = 'ETH';
    let interval = '15m';
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--coin' || args[i] === '-c') {
            coin = args[i + 1]?.toUpperCase();
        }
        if (args[i] === '--interval' || args[i] === '-i') {
            interval = args[i + 1];
        }
    }
    
    try {
        await precomputeIndicators(coin, interval);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { precomputeIndicators };
