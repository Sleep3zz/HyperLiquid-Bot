#!/usr/bin/env node
/**
 * Pre-compute indicators for PUMP
 */

const fs = require('fs');
const path = require('path');
const { RSI, BollingerBands, ADX } = require('trading-signals');

const chartFile = path.join(__dirname, '..', 'data', 'charts', 'PUMP', 'PUMP-15m-90d.json');
const outDir = path.join(__dirname, '..', 'data', 'indicators', 'PUMP');

if (!fs.existsSync(chartFile)) {
  console.log('❌ No chart data found for PUMP');
  process.exit(1);
}

console.log('🔄 Computing indicators for PUMP...');

const chart = JSON.parse(fs.readFileSync(chartFile, 'utf8'));
const candles = chart.candles;

console.log(`📊 Processing ${candles.length} candles`);

const bb = new BollingerBands(20, 2);
const rsi = new RSI(14);
const adx = new ADX(14);

const values = [];

for (const c of candles) {
  bb.update(c.c);
  rsi.update(c.c);
  adx.update({ high: c.h, low: c.l, close: c.c });
  
  let bbResult = null;
  let rsiVal = null;
  let adxVal = null;
  
  try {
    bbResult = bb.getResult();
    rsiVal = parseFloat(rsi.getResult().valueOf());
    adxVal = parseFloat(adx.getResult().valueOf());
  } catch (e) {}
  
  values.push({
    t: c.t,
    price: c.c,
    rsi: rsiVal,
    bbLower: bbResult ? parseFloat(bbResult.lower.valueOf()) : null,
    bbMiddle: bbResult ? parseFloat(bbResult.middle.valueOf()) : null,
    bbUpper: bbResult ? parseFloat(bbResult.upper.valueOf()) : null,
    adx: adxVal
  });
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const output = {
  coin: 'PUMP',
  interval: '15m',
  candles: candles.length,
  params: {
    rsiPeriod: 14,
    bbPeriod: 20,
    bbStdDev: 2,
    adxPeriod: 14
  },
  values
};

const outFile = path.join(outDir, '15m-indicators.json');
fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

console.log(`✅ Saved ${values.length} indicator sets to ${outFile}`);
