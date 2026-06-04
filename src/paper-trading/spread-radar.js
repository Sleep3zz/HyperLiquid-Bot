/**
 * SpreadRadar - Monitor trading opportunities across markets
 */
class SpreadRadar {
    constructor(config = {}) {
        this.logger = config.logger || console;
        this.deltaLab = config.deltaLabClient;
        this.wayfinder = config.wayfinderCommander;
        
        this.symbols = config.symbols || ['BTC', 'ETH', 'SOL', 'HYPE'];
        this.updateInterval = config.updateInterval || 30000;
        this.minSpread = config.minSpread || 0.001;
        
        this.priceHistory = new Map();
        this.fundingHistory = new Map();
        this.opportunities = [];
        this.alerts = [];
        
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.logger.info('[SPREAD RADAR] Starting monitoring...');
        await this.scan();
        this.interval = setInterval(() => this.scan(), this.updateInterval);
    }

    stop() {
        this.isRunning = false;
        if (this.interval) clearInterval(this.interval);
        this.logger.info('[SPREAD RADAR] Stopped');
    }

    async scan() {
        this.logger.info('[SPREAD RADAR] Scanning markets...');
        
        for (const symbol of this.symbols) {
            try {
                const [price, fundingRate] = await Promise.all([
                    this.deltaLab.getPrice(symbol),
                    this.deltaLab.getFundingRate(symbol)
                ]);

                if (!this.priceHistory.has(symbol)) {
                    this.priceHistory.set(symbol, []);
                }
                this.priceHistory.get(symbol).push({ price, timestamp: Date.now() });

                const history = this.priceHistory.get(symbol);
                if (history.length > 100) history.shift();

                await this.analyzeSymbol(symbol, { price, fundingRate });
            } catch (error) {
                this.logger.error(`[SPREAD RADAR] Error scanning ${symbol}: ${error.message}`);
            }
        }

        this.rankOpportunities();
    }

    async analyzeSymbol(symbol, data) {
        const opportunities = [];
        
        const fundingOpp = this.analyzeFundingOpportunity(symbol, data);
        if (fundingOpp) opportunities.push(fundingOpp);

        const volOpp = this.analyzeVolatilityOpportunity(symbol, data);
        if (volOpp) opportunities.push(volOpp);

        opportunities.forEach(opp => {
            this.opportunities.push({
                ...opp,
                id: `${symbol}-${opp.type}-${Date.now()}`,
                timestamp: Date.now()
            });
        });

        const cutoff = Date.now() - 300000;
        this.opportunities = this.opportunities.filter(o => o.timestamp > cutoff);
    }

    analyzeFundingOpportunity(symbol, data) {
        const { fundingRate } = data;
        if (fundingRate === null) return null;

        const history = this.fundingHistory.get(symbol);
        if (!history || history.length < 10) return null;

        const avgFunding = history.slice(-10).reduce((sum, h) => sum + h.rate, 0) / 10;
        
        if (Math.abs(fundingRate) > 0.0005) {
            return {
                symbol,
                type: 'FUNDING',
                side: fundingRate > 0 ? 'SHORT' : 'LONG',
                score: Math.abs(fundingRate) * 1000,
                metrics: { currentRate: fundingRate, avgRate: avgFunding },
                reason: `Extreme funding: ${(fundingRate * 100).toFixed(4)}%`
            };
        }
        return null;
    }

    analyzeVolatilityOpportunity(symbol, data) {
        const history = this.priceHistory.get(symbol);
        if (!history || history.length < 20) return null;

        const prices = history.slice(-20).map(h => h.price);
        const returns = [];
        
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }

        const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length);
        
        if (volatility > 0.001) {
            return {
                symbol,
                type: 'VOLATILITY',
                side: 'NEUTRAL',
                score: volatility * 10000,
                metrics: { currentVol: volatility },
                reason: `Volatility spike: ${(volatility * 100).toFixed(2)}%`
            };
        }
        return null;
    }

    rankOpportunities() {
        const ranked = this.opportunities
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        if (ranked.length === 0) {
            console.log('\n[SPREAD RADAR] No significant opportunities');
            return;
        }

        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║           Spread Radar Opportunities           ║');
        console.log('╚════════════════════════════════════════════════╝');
        
        ranked.forEach((opp, i) => {
            console.log(`${i + 1}. ${opp.symbol} | ${opp.type} | ${opp.side} | Score: ${opp.score.toFixed(1)}`);
            console.log(`   ${opp.reason}`);
        });
        console.log('');
    }

    getOpportunities() {
        return this.opportunities.sort((a, b) => b.score - a.score);
    }
}

module.exports = SpreadRadar;
