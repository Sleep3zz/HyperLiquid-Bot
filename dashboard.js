#!/usr/bin/env node
/**
 * Paper Trader Dashboard
 * 
 * Web-based dashboard for monitoring paper trading performance
 * 
 * Usage: node dashboard.js [--port 3000]
 * 
 * Features:
 * - Real-time P&L monitoring
 * - Trade history
 * - Equity curve chart
 * - Position status
 * - Multi-coin support
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const ParameterManager = require('./param-manager');

const DATA_DIR = path.join(__dirname, 'data', 'paper-trading');
const app = express();
const PORT = process.argv.find(arg => arg.startsWith('--port'))?.split('=')[1] || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dashboard-public')));

// Get list of active paper traders
function getActiveTraders() {
    if (!fs.existsSync(DATA_DIR)) return [];
    
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('-paper-trades.json'));
    return files.map(f => f.replace('-paper-trades.json', ''));
}

// Load trader data
function loadTraderData(coin) {
    const dataFile = path.join(DATA_DIR, `${coin}-paper-trades.json`);
    const equityFile = path.join(DATA_DIR, `${coin}-equity.json`);
    
    if (!fs.existsSync(dataFile)) return null;
    
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const equity = fs.existsSync(equityFile) 
        ? JSON.parse(fs.readFileSync(equityFile, 'utf8')) 
        : [];
    
    // Calculate metrics
    const winningTrades = data.trades.filter(t => t.pnl > 0);
    const totalPnL = data.trades.reduce((a, b) => a + b.pnl, 0);
    const currentEquity = data.currentEquity || data.initialCapital;
    const totalReturn = ((currentEquity - data.initialCapital) / data.initialCapital) * 100;
    
    // Calculate max drawdown
    let peak = data.initialCapital;
    let maxDrawdown = 0;
    for (const point of equity) {
        if (point.equity > peak) peak = point.equity;
        const dd = (peak - point.equity) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }
    
    return {
        coin,
        initialCapital: data.initialCapital,
        currentEquity,
        totalReturn,
        totalPnL,
        totalTrades: data.trades.length,
        winningTrades: winningTrades.length,
        losingTrades: data.trades.length - winningTrades.length,
        winRate: data.trades.length > 0 ? (winningTrades.length / data.trades.length) * 100 : 0,
        maxDrawdown: maxDrawdown * 100,
        position: data.position,
        params: data.params,
        trades: data.trades.slice(-20), // Last 20 trades
        equity: equity.slice(-100), // Last 100 points
        lastUpdated: data.lastUpdated
    };
}

// API Routes

// Get all traders summary
app.get('/api/traders', (req, res) => {
    const traders = getActiveTraders().map(coin => {
        const data = loadTraderData(coin);
        if (!data) return null;
        return {
            coin: data.coin,
            currentEquity: data.currentEquity,
            totalReturn: data.totalReturn,
            totalTrades: data.totalTrades,
            winRate: data.winRate,
            hasPosition: !!data.position,
            positionType: data.position?.type || null
        };
    }).filter(Boolean);
    
    res.json({
        count: traders.length,
        traders: traders.sort((a, b) => b.totalReturn - a.totalReturn)
    });
});

// Get specific trader details
app.get('/api/traders/:coin', (req, res) => {
    const data = loadTraderData(req.params.coin.toUpperCase());
    if (!data) {
        return res.status(404).json({ error: 'Trader not found' });
    }
    res.json(data);
});

// Get optimal params for a coin
app.get('/api/params/:coin', (req, res) => {
    const params = ParameterManager.getOptimalParams(req.params.coin.toUpperCase());
    res.json(params);
});

// Get all optimal params
app.get('/api/params', (req, res) => {
    const params = ParameterManager.getAllOptimalParams();
    res.json(params);
});

// Serve dashboard HTML
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Paper Trader Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0e27;
            color: #fff;
            line-height: 1.6;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2rem;
            margin-bottom: 5px;
        }
        
        .header p {
            opacity: 0.9;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: #151b3d;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #2a3352;
        }
        
        .stat-card h3 {
            color: #8b92b4;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 10px;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
        }
        
        .positive { color: #4ade80; }
        .negative { color: #f87171; }
        .neutral { color: #94a3b8; }
        
        .traders-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        
        .trader-card {
            background: #151b3d;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #2a3352;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .trader-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        }
        
        .trader-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #2a3352;
        }
        
        .trader-coin {
            font-size: 1.5rem;
            font-weight: bold;
        }
        
        .position-badge {
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
        }
        
        .position-long {
            background: rgba(74, 222, 128, 0.2);
            color: #4ade80;
        }
        
        .position-short {
            background: rgba(248, 113, 113, 0.2);
            color: #f87171;
        }
        
        .position-none {
            background: rgba(148, 163, 184, 0.2);
            color: #94a3b8;
        }
        
        .trader-stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-bottom: 15px;
        }
        
        .trader-stat {
            background: #0f152e;
            padding: 10px;
            border-radius: 8px;
        }
        
        .trader-stat-label {
            font-size: 0.75rem;
            color: #8b92b4;
            margin-bottom: 5px;
        }
        
        .trader-stat-value {
            font-size: 1.1rem;
            font-weight: bold;
        }
        
        .equity-chart {
            height: 100px;
            background: #0f152e;
            border-radius: 8px;
            padding: 10px;
            position: relative;
            overflow: hidden;
        }
        
        .chart-line {
            stroke: #667eea;
            stroke-width: 2;
            fill: none;
        }
        
        .config-info {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #2a3352;
            font-size: 0.85rem;
            color: #8b92b4;
        }
        
        .config-info span {
            display: inline-block;
            margin-right: 15px;
        }
        
        .refresh-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #667eea;
            color: white;
            border: none;
            padding: 15px 25px;
            border-radius: 50px;
            font-size: 1rem;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            transition: transform 0.2s;
        }
        
        .refresh-btn:hover {
            transform: scale(1.05);
        }
        
        .loading {
            text-align: center;
            padding: 50px;
            color: #8b92b4;
        }
        
        .error {
            background: rgba(248, 113, 113, 0.1);
            border: 1px solid rgba(248, 113, 113, 0.3);
            color: #f87171;
            padding: 20px;
            border-radius: 8px;
            margin: 20px;
        }
        
        @media (max-width: 768px) {
            .traders-grid {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📈 Paper Trader Dashboard</h1>
        <p>Real-time monitoring of paper trading performance</p>
    </div>
    
    <div class="container">
        <div id="overview" class="stats-grid">
            <div class="loading">Loading overview...</div>
        </div>
        
        <div id="traders" class="traders-grid">
            <div class="loading">Loading traders...</div>
        </div>
    </div>
    
    <button class="refresh-btn" onclick="loadData()">🔄 Refresh</button>
    
    <script>
        let autoRefresh = setInterval(loadData, 5000);
        
        async function loadData() {
            try {
                const response = await fetch('/api/traders');
                const data = await response.json();
                
                renderOverview(data);
                renderTraders(data);
            } catch (err) {
                document.getElementById('overview').innerHTML = 
                    '<div class="error">Failed to load data: ' + err.message + '</div>';
            }
        }
        
        function renderOverview(data) {
            const traders = data.traders || [];
            const totalEquity = traders.reduce((a, b) => a + b.currentEquity, 0);
            const avgReturn = traders.length > 0 
                ? traders.reduce((a, b) => a + b.totalReturn, 0) / traders.length 
                : 0;
            const totalTrades = traders.reduce((a, b) => a + b.totalTrades, 0);
            const activePositions = traders.filter(t => t.hasPosition).length;
            
            const html = \`
                <div class="stat-card">
                    <h3>Active Traders</h3>
                    <div class="stat-value neutral">\${traders.length}</div>
                </div>
                <div class="stat-card">
                    <h3>Total Equity</h3>
                    <div class="stat-value neutral">$\${totalEquity.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <h3>Avg Return</h3>
                    <div class="stat-value \${avgReturn >= 0 ? 'positive' : 'negative'}">
                        \${avgReturn >= 0 ? '+' : ''}\${avgReturn.toFixed(2)}%
                    </div>
                </div>
                <div class="stat-card">
                    <h3>Total Trades</h3>
                    <div class="stat-value neutral">\${totalTrades}</div>
                </div>
                <div class="stat-card">
                    <h3>Active Positions</h3>
                    <div class="stat-value \${activePositions > 0 ? 'positive' : 'neutral'}">\${activePositions}</div>
                </div>
                <div class="stat-card">
                    <h3>Win Rate</h3>
                    <div class="stat-value neutral">
                        \${traders.length > 0 ? (traders.reduce((a, b) => a + b.winRate, 0) / traders.length).toFixed(1) : 0}%
                    </div>
                </div>
            \`;
            
            document.getElementById('overview').innerHTML = html;
        }
        
        function renderTraders(data) {
            const traders = data.traders || [];
            
            if (traders.length === 0) {
                document.getElementById('traders').innerHTML = 
                    '<div class="error">No active paper traders. Start one with: node paper-trader.js --coin BTC</div>';
                return;
            }
            
            const html = traders.map(t => \`
                <div class="trader-card" onclick="window.open('/trader/\${t.coin}', '_blank')">
                    <div class="trader-header">
                        <div class="trader-coin">\${t.coin}</div>
                        <div class="position-badge position-\${t.hasPosition ? (t.positionType === 'LONG' ? 'long' : 'short') : 'none'}">
                            \${t.hasPosition ? t.positionType : 'NO POSITION'}
                        </div>
                    </div>
                    
                    <div class="trader-stats">
                        <div class="trader-stat">
                            <div class="trader-stat-label">Equity</div>
                            <div class="trader-stat-value">$\${t.currentEquity.toFixed(2)}</div>
                        </div>
                        <div class="trader-stat">
                            <div class="trader-stat-label">Return</div>
                            <div class="trader-stat-value \${t.totalReturn >= 0 ? 'positive' : 'negative'}">
                                \${t.totalReturn >= 0 ? '+' : ''}\${t.totalReturn.toFixed(2)}%
                            </div>
                        </div>
                        <div class="trader-stat">
                            <div class="trader-stat-label">Trades</div>
                            <div class="trader-stat-value">\${t.totalTrades}</div>
                        </div>
                        <div class="trader-stat">
                            <div class="trader-stat-label">Win Rate</div>
                            <div class="trader-stat-value">\${t.winRate.toFixed(1)}%</div>
                        </div>
                    </div>
                    
                    <div class="equity-chart">
                        <svg viewBox="0 0 300 80" preserveAspectRatio="none">
                            <!-- Simplified sparkline would go here -->
                            <line x1="0" y1="40" x2="300" y2="40" stroke="#2a3352" stroke-width="1"/>
                        </svg>
                    </div>
                </div>
            \`).join('');
            
            document.getElementById('traders').innerHTML = html;
        }
        
        // Initial load
        loadData();
    </script>
</body>
</html>`);
});

// Individual trader detail page
app.get('/trader/:coin', (req, res) => {
    const coin = req.params.coin.toUpperCase();
    const data = loadTraderData(coin);
    
    if (!data) {
        return res.status(404).send('<h1>Trader not found</h1>');
    }
    
    // Generate equity chart data
    const equityData = data.equity.map(e => ({
        time: new Date(e.timestamp).toLocaleTimeString(),
        equity: e.equity
    }));
    
    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${coin} Paper Trader</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0e27;
            color: #fff;
            padding: 20px;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #667eea; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat {
            background: #151b3d;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #2a3352;
        }
        .stat-label { color: #8b92b4; font-size: 0.85rem; margin-bottom: 5px; }
        .stat-value { font-size: 1.5rem; font-weight: bold; }
        .positive { color: #4ade80; }
        .negative { color: #f87171; }
        .trades {
            background: #151b3d;
            border-radius: 8px;
            padding: 20px;
            margin-top: 20px;
            border: 1px solid #2a3352;
        }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #2a3352; }
        th { color: #8b92b4; font-weight: normal; }
        .back { display: inline-block; margin-bottom: 20px; color: #667eea; text-decoration: none; }
        .back:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back">← Back to Dashboard</a>
        <h1>${coin} Paper Trader</h1>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-label">Initial Capital</div>
                <div class="stat-value">$${data.initialCapital.toFixed(2)}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Current Equity</div>
                <div class="stat-value">$${data.currentEquity.toFixed(2)}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Total Return</div>
                <div class="stat-value ${data.totalReturn >= 0 ? 'positive' : 'negative'}">
                    ${data.totalReturn >= 0 ? '+' : ''}${data.totalReturn.toFixed(2)}%
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">Total Trades</div>
                <div class="stat-value">${data.totalTrades}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Win Rate</div>
                <div class="stat-value">${data.winRate.toFixed(1)}%</div>
            </div>
            <div class="stat">
                <div class="stat-label">Max Drawdown</div>
                <div class="stat-value negative">${data.maxDrawdown.toFixed(2)}%</div>
            </div>
        </div>
        
        ${data.position ? `
        <div class="stats">
            <div class="stat">
                <div class="stat-label">Current Position</div>
                <div class="stat-value ${data.position.type === 'LONG' ? 'positive' : 'negative'}">${data.position.type}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Entry Price</div>
                <div class="stat-value">$${data.position.entryPrice.toFixed(2)}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Unrealized P&L</div>
                <div class="stat-value ${data.position.currentPnL >= 0 ? 'positive' : 'negative'}">
                    $${data.position.currentPnL.toFixed(2)}
                </div>
            </div>
        </div>
        ` : '<p>No open position</p>'}
        
        <div class="trades">
            <h2>Recent Trades</h2>
            <table>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>P&L</th>
                        <th>Reason</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.trades.slice().reverse().map(t => `
                        <tr>
                            <td>${t.type}</td>
                            <td>$${t.entryPrice.toFixed(2)}</td>
                            <td>$${t.exitPrice.toFixed(2)}</td>
                            <td class="${t.pnl >= 0 ? 'positive' : 'negative'}">
                                ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}
                            </td>
                            <td>${t.exitReason}</td>
                            <td>${new Date(t.exitTime).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>`);
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Paper Trader Dashboard running on http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('Available endpoints:');
    console.log(`  Dashboard: http://localhost:${PORT}`);
    console.log(`  API:       http://localhost:${PORT}/api/traders`);
    console.log('='.repeat(60));
    console.log('To start a paper trader:');
    console.log('  node paper-trader.js --coin BTC --capital 1000');
    console.log('='.repeat(60) + '\n');
});