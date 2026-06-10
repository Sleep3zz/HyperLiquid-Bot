/**
 * diagnoseBbrsi — diagnostic harness to verify why 0 trades occur
 *
 * Run this to distinguish between:
 * 1. Indicator format errors (data passing issue)
 * 2. Condition logic (market not hitting extremes)
 * 3. Data problems (insufficient candles, NaN values)
 */
const { loadCandles } = require('../utils/dataManager');
const { calculateBollingerBands, calculateRSI, calculateADX } = require('./indicators');

async function diagnoseBbrsi(coin = 'BTC', interval = '15m') {
    console.log(`\n=== BBRSI Diagnostic: ${coin}/${interval} ===\n`);
    
    // 1. Load data
    const candles = loadCandles(coin, interval);
    console.log(`Loaded ${candles.length} candles (~${(candles.length/96).toFixed(1)} days)`);
    console.log(`Date range: ${new Date(candles[0].t).toISOString()} to ${new Date(candles[candles.length-1].t).toISOString()}`);
    
    if (candles.length < 100) {
        console.log('❌ ERROR: Insufficient candles for diagnosis');
        return;
    }
    
    // 2. Test indicators directly
    console.log('\n--- Indicator Health Check ---');
    const testSlice = candles.slice(0, 200);
    
    try {
        const bb = calculateBollingerBands(testSlice, 20, 2);
        console.log('Bollinger Bands:', {
            lower: bb.lower?.toFixed(2) || 'FAILED',
            middle: bb.middle?.toFixed(2) || 'FAILED',
            upper: bb.upper?.toFixed(2) || 'FAILED'
        });
        console.log('  BB finite?', Number.isFinite(bb.lower) && Number.isFinite(bb.middle) && Number.isFinite(bb.upper));
    } catch(e) {
        console.log('❌ BB Error:', e.message);
    }
    
    try {
        const rsi = calculateRSI(testSlice, 14);
        console.log('RSI:', rsi?.toFixed(2) || 'FAILED');
        console.log('  RSI finite?', Number.isFinite(rsi));
    } catch(e) {
        console.log('❌ RSI Error:', e.message);
    }
    
    try {
        const adx = calculateADX(testSlice, 14);
        console.log('ADX:', adx?.toFixed(2) || 'FAILED');
        console.log('  ADX finite?', Number.isFinite(adx));
    } catch(e) {
        console.log('❌ ADX Error:', e.message);
    }
    
    // 3. Analyze full dataset for extremes
    console.log('\n--- Market Condition Analysis ---');
    
    const batchSize = 100;
    const batches = Math.floor(candles.length / batchSize);
    
    let rsiValues = [];
    let adxValues = [];
    let bbPositionValues = [];
    
    for (let i = 0; i < batches; i++) {
        const batch = candles.slice(i * batchSize, (i + 1) * batchSize);
        
        try {
            const bb = calculateBollingerBands(batch, 20, 2);
            const rsi = calculateRSI(batch, 14);
            const adx = calculateADX(batch, 14);
            const currentPrice = batch[batch.length - 1].c;
            
            if (Number.isFinite(rsi)) rsiValues.push(rsi);
            if (Number.isFinite(adx)) adxValues.push(adx);
            
            if (bb.upper > bb.lower) {
                const position = (currentPrice - bb.lower) / (bb.upper - bb.lower);
                bbPositionValues.push(position);
            }
        } catch(e) {
            // Skip failed batches
        }
    }
    
    console.log(`Analyzed ${rsiValues.length} batches of ${batchSize} candles`);
    
    if (rsiValues.length > 0) {
        const minRsi = Math.min(...rsiValues);
        const maxRsi = Math.max(...rsiValues);
        console.log(`\nRSI Range: ${minRsi.toFixed(2)} to ${maxRsi.toFixed(2)}`);
        console.log(`  Oversold (< 35) occurrences: ${rsiValues.filter(v => v < 35).length}`);
        console.log(`  Overbought (> 65) occurrences: ${rsiValues.filter(v => v > 65).length}`);
        console.log(`  Extremes (< 30 or > 70): ${rsiValues.filter(v => v < 30 || v > 70).length}`);
    } else {
        console.log('\n❌ No valid RSI values computed');
    }
    
    if (adxValues.length > 0) {
        const minAdx = Math.min(...adxValues);
        const maxAdx = Math.max(...adxValues);
        console.log(`\nADX Range: ${minAdx.toFixed(2)} to ${maxAdx.toFixed(2)}`);
        console.log(`  Trending (> 25): ${adxValues.filter(v => v > 25).length}`);
        console.log(`  Ranging (< 20): ${adxValues.filter(v => v < 20).length}`);
    } else {
        console.log('\n❌ No valid ADX values computed');
    }
    
    if (bbPositionValues.length > 0) {
        const outsideLower = bbPositionValues.filter(v => v < 0).length;
        const outsideUpper = bbPositionValues.filter(v => v > 1).length;
        const insideBands = bbPositionValues.filter(v => v >= 0 && v <= 1).length;
        console.log(`\nBollinger Band Position:`);
        console.log(`  Below lower band: ${outsideLower}`);
        console.log(`  Inside bands: ${insideBands}`);
        console.log(`  Above upper band: ${outsideUpper}`);
    }
    
    // 4. Count potential signal opportunities
    console.log('\n--- Signal Opportunity Analysis ---');
    let longOpportunities = 0;
    let shortOpportunities = 0;
    
    for (let i = 50; i < candles.length - 1; i++) {
        const lookback = candles.slice(0, i + 1);
        const current = candles[i];
        const next = candles[i + 1];
        
        try {
            const bb = calculateBollingerBands(lookback, 20, 2);
            const rsi = calculateRSI(lookback, 14);
            const adx = calculateADX(lookback, 14);
            const prev = candles[i - 1];
            
            // Mean-reversion LONG conditions
            const priceBelowBB = current.c < bb.lower;
            const rsiOversold = rsi < 35;
            const adxLow = adx < 20;
            const bouncedUp = prev.c <= bb.lower && current.c > bb.lower;
            
            if (priceBelowBB && rsiOversold && adxLow && bouncedUp) {
                longOpportunities++;
            }
            
            // Mean-reversion SHORT conditions
            const priceAboveBB = current.c > bb.upper;
            const rsiOverbought = rsi > 65;
            const bouncedDown = prev.c >= bb.upper && current.c < bb.upper;
            
            if (priceAboveBB && rsiOverbought && adxLow && bouncedDown) {
                shortOpportunities++;
            }
        } catch(e) {
            // Skip
        }
    }
    
    console.log(`Long signal opportunities: ${longOpportunities}`);
    console.log(`Short signal opportunities: ${shortOpportunities}`);
    console.log(`Total opportunities: ${longOpportunities + shortOpportunities}`);
    
    // 5. Summary
    console.log('\n=== DIAGNOSIS ===');
    
    if (rsiValues.length === 0 || adxValues.length === 0) {
        console.log('❌ CRITICAL: Indicators failing - check data format');
    } else if (longOpportunities + shortOpportunities === 0) {
        console.log('⚠️  Market did not produce entry conditions in this period');
        console.log('   Consider: longer timeframe, different coins, or parameter adjustment');
    } else {
        console.log(`✅ Found ${longOpportunities + shortOpportunities} signal opportunities`);
        console.log('   If backtest shows 0 trades, check backtest harness logic');
    }
}

// Run if called directly
if (require.main === module) {
    const coin = process.argv[2] || 'BTC';
    diagnoseBbrsi(coin);
}

module.exports = { diagnoseBbrsi };
