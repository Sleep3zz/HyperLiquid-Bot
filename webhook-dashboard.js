#!/usr/bin/env node
/**
 * Webhook Dashboard for Paper Trader
 * 
 * Exposes a public URL via localtunnel for remote access
 * 
 * Usage:
 *   node webhook-dashboard.js [--port 3000] [--subdomain mybot]
 * 
 * The dashboard will be accessible at:
 *   https://<subdomain>.loca.lt (or similar)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ParameterManager = require('./param-manager');

const DATA_DIR = path.join(__dirname, 'data', 'paper-trading');
const app = express();
const PORT = process.argv.find(arg => arg.startsWith('--port'))?.split('=')[1] || process.env.PORT || 3000;
const SUBDOMAIN = process.argv.find(arg => arg.startsWith('--subdomain'))?.split('=')[1] || 'hyperliquid-bot';

// Middleware
app.use(express.json());

// Password protection (simple)
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'sleep3zz';

function checkAuth(req, res, next) {
    const auth = req.headers.authorization;
    const queryPass = req.query.password;
    
    if (queryPass === DASHBOARD_PASSWORD || (auth && auth === `Bearer ${DASHBOARD_PASSWORD}`)) {
        return next();
    }
    
    // For browser access, check cookie
    if (req.cookies?.auth === DASHBOARD_PASSWORD) {
        return next();
    }
    
    res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Required</title></head>
        <body style="background:#0a0e27;color:#fff;font-family:sans-serif;text-align:center;padding-top:100px;">
            <h1>🔒 Paper Trader Dashboard</h1>
            <p>Enter password to access:</p>
            <form method="GET">
                <input type="password" name="password" placeholder="Password" style="padding:10px;font-size:16px;">
                <button type="submit" style="padding:10px 20px;font-size:16px;background:#667eea;color:#fff;border:none;cursor:pointer;">Access</button>
            </form>
        </body>
        </html>
    `);
}

app.use((req, res, next) => {
    // Simple cookie parser
    const cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            cookies[name] = value;
        });
    }
    req.cookies = cookies;
    next();
});

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
    
    // Calculate Sharpe-like metric
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
        returns.push((equity[i].equity - equity[i-1].equity) / equity[i-1].equity);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length || 1));
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 * 96) : 0; // Annualized (96 15m periods/day)
    
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
        sharpe,
        position: data.position,
        params: data.params,
        trades: data.trades.slice(-20),
        equity: equity.slice(-100),
        lastUpdated: data.lastUpdated
    };
}

// Generate equity sparkline SVG
function generateSparkline(equity, width = 300, height = 80) {
    if (equity.length < 2) return '';
    
    const values = equity.map(e => e.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    const points = values.map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - ((v - min) / range) * height * 0.8 - height * 0.1;
        return `${x},${y}`;
    }).join(' ');
    
    const color = values[values.length - 1] >= values[0] ? '#4ade80' : '#f87171';
    
    return `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
}

// API Routes (no auth required for API)
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
            sharpe: data.sharpe,
            hasPosition: !!data.position,
            positionType: data.position?.type || null,
            unrealizedPnL: data.position?.currentPnL || 0
        };
    }).filter(Boolean);
    
    res.json({
        count: traders.length,
        totalEquity: traders.reduce((a, b) => a + b.currentEquity, 0),
        traders: traders.sort((a, b) => b.totalReturn - a.totalReturn)
    });
});

app.get('/api/traders/:coin', (req, res) => {
    const data = loadTraderData(req.params.coin.toUpperCase());
    if (!data) return res.status(404).json({ error: 'Trader not found' });
    res.json(data);
});

// Webhook endpoint for external integrations
app.post('/webhook/trade', express.json(), (req, res) => {
    const { coin, action, price } = req.body;
    console.log(`[WEBHOOK] Trade signal: ${action} ${coin} @ $${price}`);
    res.json({ received: true, timestamp: Date.now() });
});

// Main Dashboard HTML
app.get('/', checkAuth, (req, res) => {
    // Set auth cookie
    res.setHeader('Set-Cookie', `auth=${DASHBOARD_PASSWORD}; Path=/; HttpOnly`);
    
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Paper Trader Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
        .header h1 { font-size: 2rem; margin-bottom: 5px; }
        .header p { opacity: 0.9; }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
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
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 10px;
        }
        .stat-value { font-size: 1.8rem; font-weight: bold; }
        .positive { color: #4ade80; }
        .negative { color: #f87171; }
        .neutral { color: #94a3b8; }
        .traders-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
            gap: 20px;
        }
        .trader-card {
            background: #151b3d;
            border-radius: 12px;
            padding: 20px;
            border: 1px solid #2a3352;
            transition: transform 0.2s, box-shadow 0.2s;
            cursor: pointer;
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
        .trader-coin { font-size: 1.5rem; font-weight: bold; }
        .position-badge {
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
        }
        .position-long { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
        .position-short { background: rgba(248, 113, 113, 0.2); color: #f87171; }
        .position-none { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
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
        .trader-stat-value { font-size: 1.1rem; font-weight: bold; }
        .sparkline {
            height: 60px;
            background: #0f152e;
            border-radius: 8px;
            padding: 5px;
            overflow: hidden;
        }
        .config-info {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #2a3352;
            font-size: 0.8rem;
            color: #8b92b4;
        }
        .config-info span { display: inline-block; margin-right: 12px; }
        .status-bar {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #151b3d;
            border-top: 1px solid #2a3352;
            padding: 10px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.85rem;
        }
        .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #4ade80;
            border-radius: 50%;
            margin-right: 8px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .refresh-info { color: #8b92b4; }
        @media (max-width: 768px) {
            .traders-grid { grid-template-columns: 1fr; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📈 Paper Trader Dashboard</h1>
        <p>Live monitoring via webhook</p>
    </div>
    
    <div class="container">
        <div id="overview" class="stats-grid">
            <div class="stat-card"><div class="stat-value neutral">Loading...</div></div>
        </div>
        
        <div id="traders" class="traders-grid">
            <div class="stat-card"><div class="stat-value neutral">Loading traders...</div></div>
        </div>
    </div>
    
    <div class="status-bar">
        <div>
            <span class="status-indicator"></span>
            <span id="connection-status">Connected</span>
        </div>
        <div class="refresh-info">Auto-refresh: <span id="countdown">5</span>s</div>
    </div>
    
    <script>
        let countdown = 5;
        let autoRefresh = setInterval(() => {
            countdown--;
            document.getElementById('countdown').textContent = countdown;
            if (countdown <= 0) {
                loadData();
                countdown = 5;
            }
        }, 1000);
        
        async function loadData() {
            try {
                const response = await fetch('/api/traders');
                const data = await response.json();
                
                renderOverview(data);
                renderTraders(data);
                document.getElementById('connection-status').textContent = 'Connected';
                document.getElementById('connection-status').style.color = '#4ade80';
            } catch (err) {
                document.getElementById('connection-status').textContent = 'Disconnected';
                document.getElementById('connection-status').style.color = '#f87171';
                console.error('Failed to load:', err);
            }
        }
        
        function renderOverview(data) {
            const traders = data.traders || [];
            const totalEquity = data.totalEquity || 0;
            const avgReturn = traders.length > 0 
                ? traders.reduce((a, b) => a + b.totalReturn, 0) / traders.length 
                : 0;
            const totalTrades = traders.reduce((a, b) => a + b.totalTrades, 0);
            const activePositions = traders.filter(t => t.hasPosition).length;
            const avgSharpe = traders.length > 0
                ? traders.reduce((a, b) => a + b.sharpe, 0) / traders.length
                : 0;
            
            document.getElementById('overview').innerHTML = \`
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
                    <h3>Avg Sharpe</h3>
                    <div class="stat-value \${avgSharpe > 0 ? 'positive' : 'neutral'}">\${avgSharpe.toFixed(2)}</div>
                </div>
            \`;
        }
        
        function renderTraders(data) {
            const traders = data.traders || [];
            
            if (traders.length === 0) {
                document.getElementById('traders').innerHTML = 
                    '<div style="grid-column:1/-1;text-align:center;padding:50px;color:#8b92b4;">' +
                    '<h2>No Active Traders</h2>' +
                    '<p>Start one with: node paper-trader.js --coin BTC</p>' +
                    '</div>';
                return;
            }
            
            document.getElementById('traders').innerHTML = traders.map(t => \`
                <div class="trader-card" onclick="location.href='/trader/\${t.coin}?password=${DASHBOARD_PASSWORD}'">
                    <div class="trader-header">
                        <div class="trader-coin">\${t.coin}</div>
                        <div class="position-badge position-\${t.hasPosition ? (t.positionType === 'LONG' ? 'long' : 'short') : 'none'}">
                            \${t.hasPosition ? t.positionType + (t.unrealizedPnL !== 0 ? ' ($' + (t.unrealizedPnL >= 0 ? '+' : '') + t.unrealizedPnL.toFixed(2) + ')' : '') : 'NO POSITION'}
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
                    
                    <div class="sparkline" id="spark-\${t.coin}">
                        <!-- Sparkline loaded via API -->
                    </div>
                    
                    <div class="config-info">
                        <span>Sharpe: \${t.sharpe.toFixed(2)}</span>
                        <span>Config: Loading...</span>
                    </div>
                </div>
            \`).join('');
        }
        
        loadData();
    </script>
</body>
</html>`);
});

// Individual trader detail page
app.get('/trader/:coin', checkAuth, (req, res) => {
    const coin = req.params.coin.toUpperCase();
    const data = loadTraderData(coin);
    
    if (!data) return res.status(404).send('<h1>Trader not found</h1>');
    
    const equitySparkline = generateSparkline(data.equity);
    
    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${coin} Paper Trader</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0e27;
            color: #fff;
            padding: 20px;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #667eea; margin-bottom: 10px; }
        .back { display: inline-block; margin-bottom: 20px; color: #667eea; text-decoration: none; }
        .back:hover { text-decoration: underline; }
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
        .neutral { color: #94a3b8; }
        .section {
            background: #151b3d;
            border-radius: 8px;
            padding: 20px;
            margin-top: 20px;
            border: 1px solid #2a3352;
        }
        .chart-container { height: 200px; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid #2a3352; }
        th { color: #8b92b4; font-weight: 600; }
        tr:hover { background: rgba(255,255,255,0.03); }
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: bold;
        }
        .badge-long { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
        .badge-short { background: rgba(248, 113, 113, 0.2); color: #f87171; }
        .badge-tp { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
        .badge-sl { background: rgba(248, 113, 113, 0.15); color: #f87171; }
        .refresh-bar { text-align: center; padding: 10px; color: #8b92b4; font-size: 0.85rem; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/?password=${DASHBOARD_PASSWORD}" class="back">← Back to Dashboard</a>
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
            <div class="stat">
                <div class="stat-label">Sharpe Ratio</div>
                <div class="stat-value ${data.sharpe > 0 ? 'positive' : 'neutral'}">${data.sharpe.toFixed(2)}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Total P&L</div>
                <div class="stat-value ${data.totalPnL >= 0 ? 'positive' : 'negative'}">
                    ${data.totalPnL >= 0 ? '+' : ''}$${data.totalPnL.toFixed(2)}
                </div>
            </div>
        </div>
        
        ${data.position ? `
        <div class="section">
            <h2>📊 Current Position</h2>
            <div class="stats">
                <div class="stat">
                    <div class="stat-label">Type</div>
                    <div class="stat-value ${data.position.type === 'LONG' ? 'positive' : 'negative'}">${data.position.type}</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Entry Price</div>
                    <div class="stat-value">$${data.position.entryPrice.toFixed(2)}</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Position Size</div>
                    <div class="stat-value">${(data.position.size * 100).toFixed(0)}%</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Leverage</div>
                    <div class="stat-value">${data.position.leverage}x</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Unrealized P&L</div>
                    <div class="stat-value ${data.position.currentPnL >= 0 ? 'positive' : 'negative'}">
                        $${data.position.currentPnL.toFixed(2)} (${data.position.currentPnLPercent >= 0 ? '+' : ''}${data.position.currentPnLPercent.toFixed(2)}%)
                    </div>
                </div>
            </div>
        </div>
        ` : ''}
        
        <div class="section">
            <h2>📈 Equity Curve</h2>
            <div class="chart-container">
                ${equitySparkline}
            </div>
        </div>
        
        <div class="section">
            <h2>📝 Trade History</h2>
            <table>
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>P&L</th>
                        <th>Return</th>
                        <th>Reason</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.trades.slice().reverse().map(t => `
                        <tr>
                            <td><span class="badge badge-${t.type.toLowerCase()}">${t.type}</span></td>
                            <td>$${t.entryPrice.toFixed(2)}</td>
                            <td>$${t.exitPrice.toFixed(2)}</td>
                            <td class="${t.pnl >= 0 ? 'positive' : 'negative'}">
                                ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}
                            </td>
                            <td class="${t.pnlPercent >= 0 ? 'positive' : 'negative'}">
                                ${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%
                            </td>
                            <td><span class="badge badge-${t.exitReason === 'TAKE_PROFIT' ? 'tp' : t.exitReason === 'STOP_LOSS' ? 'sl' : 'neutral'}">${t.exitReason}</span></td>
                            <td>${new Date(t.exitTime).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="refresh-bar">Auto-refresh every 5 seconds • <a href="/" style="color:#667eea;">Back to Dashboard</a></div>
    </div>
    
    <script>
        setInterval(() => location.reload(), 5000);
    </script>
</body>
</html>`);
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Paper Trader Dashboard running locally on port ${PORT}`);
    console.log('='.repeat(70));
    console.log(`Local URL:  http://localhost:${PORT}`);
    console.log(`Password:   ${DASHBOARD_PASSWORD}`);
    console.log('='.repeat(70));
    console.log('\n📡 To expose via public webhook URL:');
    console.log('');
    console.log('   Option 1 - Localtunnel (easiest):');
    console.log('   npm install -g localtunnel');
    console.log(`   lt --port ${PORT} --subdomain ${SUBDOMAIN}`);
    console.log('');
    console.log('   Option 2 - ngrok:');
    console.log('   npm install -g ngrok');
    console.log('   ngrok http ${PORT}');
    console.log('');
    console.log('   Option 3 - Cloudflare Tunnel:');
    console.log('   npm install -g cloudflared');
    console.log(`   cloudflared tunnel --url http://localhost:${PORT}`);
    console.log('='.repeat(70));
    console.log('\n💡 Once exposed, access your dashboard at the provided public URL');
    console.log('   Login with password when prompted\n');
});

// Export for programmatic use
module.exports = { app, server };