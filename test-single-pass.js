// Test single-pass approach on smaller bar first
const fs = require('fs');
const { RSI, BollingerBands, ADX } = require("trading-signals");

const data = JSON.parse(fs.readFileSync('./data/charts/ETH/ETH-15m-90d.json', 'utf8'));
const candles = data.candles || data;

const norm = candles
  .map(c => ({ t: +c.t, h: +c.h, l: +c.l, c: +c.c }))
  .filter(c => [c.h, c.l, c.c].every(Number.isFinite))
  .sort((a, b) => a.t - b.t);

console.log(`Loaded ${norm.length} normalized candles`);

// Test on bar 100 first
console.log('\n=== Test: Bar 100 ===');
let rsi = new RSI(14);
let bb = new BollingerBands(20, 2);
let adx = new ADX(14);

let start = Date.now();
for (let i = 0; i <= 100; i++) {
  rsi.update(norm[i].c);
  bb.update(norm[i].c);
  adx.update({ high: norm[i].h, low: norm[i].l, close: norm[i].c });
}
let elapsed = Date.now() - start;

const r = (x) => { try { return Number(x.getResult().valueOf()); } catch { return NaN; } };
const bbr = (() => { try { return bb.getResult(); } catch { return null; } })();

console.log(`Completed in ${elapsed}ms`);
console.log({ rsi: r(rsi), adx: r(adx), bbUpper: bbr ? Number(bbr.upper.valueOf()) : NaN });

// Test on bar 500
console.log('\n=== Test: Bar 500 ===');
rsi = new RSI(14);
bb = new BollingerBands(20, 2);
adx = new ADX(14);

start = Date.now();
for (let i = 0; i <= 500; i++) {
  rsi.update(norm[i].c);
  bb.update(norm[i].c);
  adx.update({ high: norm[i].h, low: norm[i].l, close: norm[i].c });
}
elapsed = Date.now() - start;

const bbr2 = (() => { try { return bb.getResult(); } catch { return null; } })();
console.log(`Completed in ${elapsed}ms`);
console.log({ rsi: r(rsi), adx: r(adx), bbUpper: bbr2 ? Number(bbr2.upper.valueOf()) : NaN });

// Test on bar 1000
console.log('\n=== Test: Bar 1000 ===');
rsi = new RSI(14);
bb = new BollingerBands(20, 2);
adx = new ADX(14);

start = Date.now();
for (let i = 0; i <= 1000; i++) {
  rsi.update(norm[i].c);
  bb.update(norm[i].c);
  adx.update({ high: norm[i].h, low: norm[i].l, close: norm[i].c });
}
elapsed = Date.now() - start;

const bbr3 = (() => { try { return bb.getResult(); } catch { return null; } })();
console.log(`Completed in ${elapsed}ms`);
console.log({ rsi: r(rsi), adx: r(adx), bbUpper: bbr3 ? Number(bbr3.upper.valueOf()) : NaN });

// Now try bar 4138
console.log('\n=== Test: Bar 4138 (the phantom trade bar) ===');
rsi = new RSI(14);
bb = new BollingerBands(20, 2);
adx = new ADX(14);

start = Date.now();
for (let i = 0; i <= 4138; i++) {
  rsi.update(norm[i].c);
  bb.update(norm[i].c);
  adx.update({ high: norm[i].h, low: norm[i].l, close: norm[i].c });
}
elapsed = Date.now() - start;

const bbr4 = (() => { try { return bb.getResult(); } catch { return null; } })();
console.log(`Completed in ${elapsed}ms`);
const result = {
  rsi: r(rsi),
  adx: r(adx),
  bbUpper: bbr4 ? Number(bbr4.upper.valueOf()) : NaN,
  bbLower: bbr4 ? Number(bbr4.lower.valueOf()) : NaN,
};
console.log(result);

console.log('\n=== COMPARISON ===');
console.log('Expected: RSI=60.84, ADX=28.33, BB.upper=2011.76, BB.lower=1995.06');
console.log(`Got:      RSI=${result.rsi?.toFixed(2)}, ADX=${result.adx?.toFixed(2)}, BB.upper=${result.bbUpper?.toFixed(2)}, BB.lower=${result.bbLower?.toFixed(2)}`);
