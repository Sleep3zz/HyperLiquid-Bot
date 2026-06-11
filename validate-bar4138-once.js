// Single-pass bar 4138 validation (O(n) - fast)
const fs = require('fs');
const { RSI, BollingerBands, ADX } = require("trading-signals");

const data = JSON.parse(fs.readFileSync('./data/charts/ETH/ETH-15m-90d.json', 'utf8'));
const candles = data.candles || data;

const norm = candles
  .map(c => ({ t: +c.t, h: +c.h, l: +c.l, c: +c.c }))
  .filter(c => [c.h, c.l, c.c].every(Number.isFinite))
  .sort((a, b) => a.t - b.t);

console.log(`Loaded ${norm.length} normalized candles`);

const rsi = new RSI(14);
const bb = new BollingerBands(20, 2);
const adx = new ADX(14);

const TARGET = 4138;

console.log(`\nRunning single-pass to bar ${TARGET}...`);
const start = Date.now();

for (let i = 0; i < norm.length; i++) {
  rsi.update(norm[i].c);
  bb.update(norm[i].c);
  adx.update({ high: norm[i].h, low: norm[i].l, close: norm[i].c });
  
  if (i === TARGET) {
    const r = (x) => {
      try { return Number(x.getResult().valueOf()); } 
      catch { return NaN; }
    };
    const bbr = (() => {
      try { return bb.getResult(); } 
      catch { return null; }
    })();
    
    const elapsed = Date.now() - start;
    console.log(`\n=== BAR ${TARGET} (completed in ${elapsed}ms) ===`);
    console.log({
      bar: i,
      ts: norm[i].t,
      close: norm[i].c,
      rsi: r(rsi),
      adx: r(adx),
      bbUpper: bbr ? Number(bbr.upper.valueOf()) : NaN,
      bbLower: bbr ? Number(bbr.lower.valueOf()) : NaN,
    });
    
    console.log('\n=== COMPARISON WITH REAL STRATEGY ===');
    console.log('Expected: RSI=60.84, ADX=28.33, BB.upper=2011.76, BB.lower=1995.06');
    
    const result = {
      rsi: r(rsi),
      adx: r(adx),
      bbUpper: bbr ? Number(bbr.upper.valueOf()) : NaN,
      bbLower: bbr ? Number(bbr.lower.valueOf()) : NaN,
    };
    
    const checks = [
      { name: 'RSI', expected: 60.84, actual: result.rsi, tolerance: 0.5 },
      { name: 'ADX', expected: 28.33, actual: result.adx, tolerance: 0.5 },
      { name: 'BB.upper', expected: 2011.76, actual: result.bbUpper, tolerance: 0.01 },
      { name: 'BB.lower', expected: 1995.06, actual: result.bbLower, tolerance: 0.01 },
    ];
    
    let allPass = true;
    for (const c of checks) {
      const diff = Math.abs(c.actual - c.expected);
      const pass = diff <= c.tolerance;
      allPass = allPass && pass;
      console.log(`${pass ? '✓' : '✗'} ${c.name}: expected ${c.expected}, got ${c.actual?.toFixed(4)}, diff ${diff?.toFixed(4)}`);
    }
    
    console.log('\n' + (allPass ? '✅ VALIDATION PASSED' : '❌ VALIDATION FAILED'));
    break;
  }
}
