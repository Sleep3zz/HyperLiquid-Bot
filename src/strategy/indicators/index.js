const { RSI, BollingerBands, ADX } = require("trading-signals")
// const data = require("../../backtesting/data/BTC-PERP/BTC-PERP-1m.json")
// const last25 = data.slice(-50)
// const config = require("config")

// const indicators = config.get("indicators")
// const rsiPeriod = indicators.rsi.period
// const adxPeriod = indicators.adx.period
// const bollingerPeriod = indicators.bollinger.period
// const bollingerStdDev = indicators.bollinger.stdDev

function calculateBollingerBands(data, period, stdDev) {
    const bb = new BollingerBands(period, stdDev)
    let closes = []

    // Feed all closing prices
    for (let i = 0; i < data.length; i++) {
        closes.push(parseFloat(data[i].c))
        bb.update(closes[i])
    }

    // Get the last result
    const result = bb.getResult()

    return {
        lower: parseFloat(result.lower.valueOf()), // Convert to actual number
        middle: parseFloat(result.middle.valueOf()),
        upper: parseFloat(result.upper.valueOf()),
    }
}

function calculateADX(data, period) {
    const adx = new ADX(period)

    // Feed the data
    for (let i = 0; i < data.length; i++) {
        adx.update({
            high: parseFloat(data[i].h),
            low: parseFloat(data[i].l),
            close: parseFloat(data[i].c),
        })
    }

    // Get the last result and convert to number between 0-100
    const result = adx.getResult()
    return parseFloat(result.valueOf()) // Convert to actual number
}

function calculateRSI(data, period) {
    const rsi = new RSI(period)
    let closes = []

    // Feed all closing prices
    for (let i = 0; i < data.length; i++) {
        closes.push(parseFloat(data[i].c))
        rsi.update(closes[i])
    }

    // Get the last result and convert to number between 0-100
    const result = rsi.getResult()
    return parseFloat(result.valueOf()) // Convert to actual number
}

// Simple ATR calculation using Wilder's smoothing
function calculateATR(highs, lows, closes, period) {
    if (highs.length < period + 1) return 0;
    
    let trValues = [];
    for (let i = 1; i < highs.length; i++) {
        const tr1 = highs[i] - lows[i];
        const tr2 = Math.abs(highs[i] - closes[i - 1]);
        const tr3 = Math.abs(lows[i] - closes[i - 1]);
        trValues.push(Math.max(tr1, tr2, tr3));
    }
    
    // Simple moving average of true ranges
    const sum = trValues.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

// Test function to verify outputs
async function testIndicators(data) {
    const indicators = require("config").get("indicators")

    const bb = calculateBollingerBands(
        data,
        indicators.bollinger.period,
        indicators.bollinger.stdDev,
    )
    console.log("Bollinger Bands:", {
        lower: bb.lower,
        middle: bb.middle,
        upper: bb.upper,
    })

    const adx = calculateADX(data, indicators.adx.period)
    console.log("ADX:", adx)

    const rsi = calculateRSI(data, indicators.rsi.period)
    console.log("RSI:", rsi)
}

// testIndicators(last25).catch(console.error)

module.exports = {
    calculateBollingerBands,
    calculateADX,
    calculateRSI,
    calculateATR,
}
