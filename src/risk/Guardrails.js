// src/risk/Guardrails.js
class Guardrails {
    constructor(config = {}) {
        this.maxDailyLossPct = config.maxDailyLossPct || 3.0;
        this.maxDrawdownPct = config.maxDrawdownPct || 12.0;
        this.maxCapitalUsagePct = config.maxCapitalUsagePct || 80;

        this.initialCapital = config.initialCapital || 10000;
        this.peakEquity = this.initialCapital;
        this.dailyStartEquity = this.initialCapital;
        this.lastResetDay = new Date().getUTCDate();
    }

    update(currentEquity) {
        const today = new Date().getUTCDate();

        // Reset daily loss at UTC midnight
        if (today !== this.lastResetDay) {
            this.dailyStartEquity = currentEquity;
            this.lastResetDay = today;
        }

        if (currentEquity > this.peakEquity) {
            this.peakEquity = currentEquity;
        }

        const drawdown = ((this.peakEquity - currentEquity) / this.peakEquity) * 100;
        const dailyLoss = ((this.dailyStartEquity - currentEquity) / this.dailyStartEquity) * 100;

        const breached = 
            dailyLoss > this.maxDailyLossPct || 
            drawdown > this.maxDrawdownPct;

        return {
            breached,
            drawdown: drawdown.toFixed(2),
            dailyLoss: dailyLoss.toFixed(2),
            currentEquity: currentEquity.toFixed(2)
        };
    }

    isSafe(currentEquity) {
        return !this.update(currentEquity).breached;
    }

    getStatus(currentEquity) {
        return this.update(currentEquity);
    }
}

module.exports = { Guardrails };
