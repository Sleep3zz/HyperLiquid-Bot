const express = require('express');
const fs = require('fs');
const path = require('path');
const ParameterManager = require('./param-manager');
const WayfinderAgent = require('./../model-router/src/agents/wayfinder-agent');

const DATA_DIR = path.join(__dirname, 'data', 'paper-trading');
const app = express();
const PORT = process.argv.find(arg => arg.startsWith('--port'))?.split('=')[1] || 3456;
const PASSWORD = 'sleep3zz';

// Initialize price feed
const priceAgent = new WayfinderAgent({ autoConnect: false });
let priceCache = {};
let priceHistory = {}; // Store prices for 24h change calculation

// Fetch prices every 30 seconds
async function updatePrices() {
    try {
        const coins = ['BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'OP', 'LINK', 'AVAX', 'NEAR', 'UNI'];
        for (const coin of coins) {
            try {
                // Get current price
                const candles = await priceAgent.getHistoricalCandles(coin, '15m', 100);
                if (candles && candles.length > 0) {
                    const currentPrice = candles[candles.length - 1].c;
                    const openPrice = candles[0].o; // Price ~24h ago (100 * 15m = 25h)
                    const change24h = ((currentPrice - openPrice) / openPrice) * 100;
                    
                    priceCache[coin] = {
                        price: currentPrice,
                        change24h: change24h,
                        high24h: Math.max(...candles.map(c => c.h)),
                        low24h: Math.min(...candles.map(c => c.l)),
                        volume24h: candles.reduce((a, b) => a + b.v, 0),
                        updated: Date.now()
                    };
                }
            } catch (e) {}
        }
    } catch (e) {}
}

// Initial fetch and periodic updates
updatePrices();
setInterval(updatePrices, 30000);

// Middleware
app.use((req, res, next) => {
    const cookies = {};
    (req.headers.cookie || '').split(';').forEach(c => {
        const [n, v] = c.trim().split('=');
        cookies[n] = v;
    });
    req.cookies = cookies;
    next();
});

// Auth middleware
function checkAuth(req, res, next) {
    if (req.query.password === PASSWORD || req.cookies.auth === PASSWORD) {
        res.setHeader('Set-Cookie', `auth=${PASSWORD}; Path=/; HttpOnly`);
        return next();
    }
    res.send(`<!DOCTYPE html>
<html><head><title>Login</title><style>
body{background:#0f172a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1e293b;padding:40px;border-radius:16px;text-align:center}
input{background:#0f172a;border:1px solid #334155;color:#fff;padding:12px 16px;border-radius:8px;margin:10px 0;width:200px}
button{background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-weight:600}
</style></head>
<body><div class="box"><h2>🔐 Dashboard Login</h2>
<form><input type="password" name="password" placeholder="Password" autofocus><br><button>Access</button></form>
</div></body></html>`);
}

function getActiveTraders() {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR).filter(f => f.endsWith('-paper-trades.json')).map(f => f.replace('-paper-trades.json', ''));
}

function loadTraderData(coin) {
    const dataFile = path.join(DATA_DIR, `${coin}-paper-trades.json`);
    const equityFile = path.join(DATA_DIR, `${coin}-equity.json`);
    
    if (!fs.existsSync(dataFile)) return null;
    
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const equity = fs.existsSync(equityFile) ? JSON.parse(fs.readFileSync(equityFile, 'utf8')) : [];
    
    const winningTrades = data.trades.filter(t => t.pnl > 0);
    const totalPnL = data.trades.reduce((a, b) => a + b.pnl, 0);
    const currentEquity = data.currentEquity || data.initialCapital;
    const totalReturn = ((currentEquity - data.initialCapital) / data.initialCapital) * 100;
    
    let peak = data.initialCapital, maxDrawdown = 0;
    for (const p of equity) {
        if (p.equity > peak) peak = p.equity;
        maxDrawdown = Math.max(maxDrawdown, (peak - p.equity) / peak);
    }
    
    const returns = [];
    for (let i = 1; i < equity.length; i++) {
        returns.push((equity[i].equity - equity[i-1].equity) / equity[i-1].equity);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length || 1));
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365 * 96) : 0;
    
    const grossProfit = winningTrades.reduce((a, b) => a + b.pnl, 0);
    const grossLoss = Math.abs(data.trades.filter(t => t.pnl <= 0).reduce((a, b) => a + b.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
    
    let maxWinStreak = 0, maxLossStreak = 0, curWin = 0, curLoss = 0;
    for (const t of data.trades) {
        if (t.pnl > 0) { curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
        else { curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
    }
    
    const sorted = [...data.trades].sort((a, b) => b.pnl - a.pnl);
    
    return {
        coin, initialCapital: data.initialCapital, currentEquity, totalReturn, totalPnL,
        totalTrades: data.trades.length, winningTrades: winningTrades.length, losingTrades: data.trades.length - winningTrades.length,
        winRate: data.trades.length > 0 ? (winningTrades.length / data.trades.length) * 100 : 0,
        maxDrawdown: maxDrawdown * 100, sharpeRatio, profitFactor,
        avgWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
        avgLoss: data.trades.length - winningTrades.length > 0 ? grossLoss / (data.trades.length - winningTrades.length) : 0,
        maxWinStreak, maxLossStreak,
        bestTrade: sorted[0] || null, worstTrade: sorted[sorted.length - 1] || null,
        position: data.position, params: data.params, trades: data.trades.slice(-50),
        equity: equity.slice(-100), lastUpdated: data.lastUpdated
    };
}

// API
app.get('/api/traders', (req, res) => {
    const traders = getActiveTraders().map(c => {
        const d = loadTraderData(c);
        return d ? { coin: d.coin, currentEquity: d.currentEquity, totalReturn: d.totalReturn, totalTrades: d.totalTrades, winRate: d.winRate, sharpe: d.sharpeRatio, maxDrawdown: d.maxDrawdown, profitFactor: d.profitFactor, hasPosition: !!d.position, positionType: d.position?.type || null, unrealizedPnL: d.position?.currentPnL || 0, lastUpdated: d.lastUpdated } : null;
    }).filter(Boolean);
    
    const totalEquity = traders.reduce((a, b) => a + b.currentEquity, 0);
    res.json({ count: traders.length, totalEquity, totalReturn: ((totalEquity - traders.length * 1000) / (traders.length * 1000)) * 100, traders: traders.sort((a, b) => b.totalReturn - a.totalReturn) });
});

app.get('/api/traders/:coin', (req, res) => {
    const d = loadTraderData(req.params.coin.toUpperCase());
    if (!d) return res.status(404).json({ error: 'Not found' });
    res.json(d);
});

// Price feed endpoint
app.get('/api/prices', (req, res) => {
    res.json({
        timestamp: Date.now(),
        prices: priceCache
    });
});

// Dashboard HTML
app.get('/', checkAuth, (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Paper Trader Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#f8fafc;--muted:#94a3b8;--green:#10b981;--red:#ef4444;--blue:#3b82f6;--purple:#8b5cf6}
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Inter',system-ui;background:var(--bg);color:var(--text);min-height:100vh}
        .header{background:linear-gradient(135deg,var(--blue),var(--purple));padding:30px;text-align:center}
        .header h1{font-size:2.2rem;font-weight:700}.header p{opacity:.9;margin-top:8px}
        .container{max-width:1400px;margin:0 auto;padding:30px 20px}
        .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:30px}
        .stat{background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border)}
        .stat-label{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.5px}
        .stat-value{font-size:1.8rem;font-weight:700;margin-top:6px}
        .stat-change{font-size:.85rem;margin-top:4px;font-weight:500}
        .positive{color:var(--green)}.negative{color:var(--red)}.muted{color:var(--muted)}
        .section{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
        .section h2{font-size:1.4rem;font-weight:600}
        .btn{background:var(--card);border:1px solid var(--border);color:var(--text);padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:500}
        .btn:hover{background:var(--blue);border-color:var(--blue)}
        .traders{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}
        .card{background:var(--card);border-radius:16px;padding:24px;border:1px solid var(--border);cursor:pointer;transition:all .3s}
        .card:hover{transform:translateY(-4px);box-shadow:0 20px 40px rgba(0,0,0,.3);border-color:var(--blue)}
        .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)}
        .coin{display:flex;align-items:center;gap:12px}
        .coin-icon{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700}
        .coin h3{font-size:1.2rem}.coin span{color:var(--muted);font-size:.8rem}
        .badge{padding:6px 14px;border-radius:20px;font-size:.75rem;font-weight:600;text-transform:uppercase}
        .badge-long{background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.3)}
        .badge-short{background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3)}
        .badge-none{background:rgba(148,163,184,.15);color:var(--muted);border:1px solid rgba(148,163,184,.3)}
        .card-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px}
        .card-stat{background:rgba(15,23,42,.5);padding:14px;border-radius:10px}
        .card-stat-label{color:var(--muted);font-size:.7rem;text-transform:uppercase}.card-stat-value{font-size:1.1rem;font-weight:600;margin-top:4px}
        .mini-chart{height:70px;background:rgba(15,23,42,.5);border-radius:10px;padding:10px}
        .prices{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:24px}
        .price-card{background:var(--card);padding:16px;border-radius:12px;border:1px solid var(--border);text-align:center;transition:all .2s}
        .price-card:hover{border-color:var(--blue);transform:translateY(-2px)}
        .price-coin{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
        .price-value{font-size:1.4rem;font-weight:700;margin:4px 0}
        .price-change{font-size:.85rem;font-weight:600;padding:2px 8px;border-radius:4px;display:inline-block}
        .price-change.positive{background:rgba(16,185,129,.15);color:var(--green)}
        .price-change.negative{background:rgba(239,68,68,.15);color:var(--red)}
        .footer{position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:1px solid var(--border);padding:12px 24px;display:flex;justify-content:space-between;font-size:.85rem}
        .status{display:flex;align-items:center;gap:8px;color:var(--green)}
        .dot{width:8px;height:8px;background:var(--green);border-radius:50%;animation:pulse 2s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        .loading{text-align:center;padding:60px;color:var(--muted)}
        .spinner{width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(max-width:768px){.traders{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}}
    </style>
</head>
<body>
    <div class="header"><h1>📈 Paper Trader Dashboard</h1><p>HyperLiquid • Top 5 Coins: ARB, HYPE, ETH, UNI, BTC</p></div>
    <div class="container">
        <div class="section"><h2>💰 Live Prices (24h)</h2></div>
        <div id="prices" class="prices"><div class="loading"><div class="spinner"></div>Loading prices...</div></div>
        <div id="overview" class="stats"><div class="loading"><div class="spinner"></div>Loading...</div></div>
        <div class="section"><h2>📊 Active Traders</h2><button class="btn" onclick="loadAll()">🔄 Refresh</button></div>
        <div id="traders" class="traders"><div class="loading"><div class="spinner"></div>Loading traders...</div></div>
    </div>
    <div class="footer"><div class="status"><span class="dot"></span><span id="status">Connected</span></div><div class="muted">Last updated: <span id="updated">-</span></div></div>
    <script>
        let countdown=5;
        setInterval(()=>countdown--,1000);
        setInterval(()=>{if(countdown<=0){loadAll();countdown=5}},1000);
        
        async function loadAll(){
            await Promise.all([loadData(), loadPrices()]);
        }
        
        async function loadData(){
            try{
                const r=await fetch('/api/traders'),d=await r.json();
                renderOverview(d);
                renderTraders(d);
                document.getElementById('status').textContent='Connected';
                document.getElementById('updated').textContent=new Date().toLocaleTimeString();
            }catch(e){
                document.getElementById('status').textContent='Disconnected';
            }
        }
        
        async function loadPrices(){
            try{
                const r=await fetch('/api/prices'),d=await r.json();
                renderPrices(d.prices);
            }catch(e){}
        }
        
        function renderPrices(prices){
            const coins=['BTC','ETH','ARB','HYPE','UNI','SOL','OP','LINK','AVAX','NEAR'];
            const html=coins.map(c=>{
                const p=prices[c];
                if(!p)return'';
                const change=p.change24h>=0?'+':'-';
                const changeClass=p.change24h>=0?'positive':'negative';
                return'<div class="price-card">'+
                    '<div class="price-coin">'+c+'</div>'+
                    '<div class="price-value">$'+p.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div>'+
                    '<div class="price-change '+changeClass+'">'+change+Math.abs(p.change24h).toFixed(2)+'%</div>'+
                '</div>';
            }).filter(Boolean).join('');
            document.getElementById('prices').innerHTML=html||'<div class="loading">Loading prices...</div>';
        }
        function renderOverview(d){const t=d.traders||[],eq=d.totalEquity||0,ret=d.totalReturn||0,avg=t.length?t.reduce((a,b)=>a+b.totalReturn,0)/t.length:0,trades=t.reduce((a,b)=>a+b.totalTrades,0),active=t.filter(x=>x.hasPosition).length,sharpe=t.length?t.reduce((a,b)=>a+b.sharpe,0)/t.length:0;
            document.getElementById('overview').innerHTML=\`
            <div class="stat"><div class="stat-label">Total Equity</div><div class="stat-value">$\${eq.toFixed(2)}</div><div class="stat-change \${ret>=0?'positive':'negative'}">\${ret>=0?'▲':'▼'} \${Math.abs(ret).toFixed(2)}%</div></div>
            <div class="stat"><div class="stat-label">Avg Return</div><div class="stat-value \${avg>=0?'positive':'negative'}">\${avg>=0?'+':''}\${avg.toFixed(2)}%</div><div class="stat-change muted">per coin</div></div>
            <div class="stat"><div class="stat-label">Total Trades</div><div class="stat-value">\${trades}</div><div class="stat-change muted">\${t.length} coins</div></div>
            <div class="stat"><div class="stat-label">Active Positions</div><div class="stat-value">\${active}</div><div class="stat-change \${active>0?'positive':'muted'}">\${active>0?'Trading':'Idle'}</div></div>
            <div class="stat"><div class="stat-label">Avg Sharpe</div><div class="stat-value">\${sharpe.toFixed(2)}</div><div class="stat-change muted">risk-adjusted</div></div>\`;}
        function renderTraders(d){const t=d.traders||[];if(!t.length){document.getElementById('traders').innerHTML='<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--muted)"><h2>No Active Traders</h2><p>Start traders with: node paper-trader.js --coin BTC</p></div>';return}
            document.getElementById('traders').innerHTML=t.map(c=>\`
            <div class="card" onclick="location.href='/trader/\${c.coin}?password=${PASSWORD}'">
                <div class="card-header"><div class="coin"><div class="coin-icon">\${c.coin[0]}</div><div><h3>\${c.coin}</h3><span>\${c.hasPosition?c.positionType:'No Position'}</span></div></div><div class="badge badge-\${c.hasPosition?(c.positionType==='LONG'?'long':'short'):'none'}">\${c.hasPosition?c.positionType+' '+((c.unrealizedPnL>=0?'+':'')+c.unrealizedPnL.toFixed(2)):'IDLE'}</div></div>
                <div class="card-stats">
                    <div class="card-stat"><div class="card-stat-label">Equity</div><div class="card-stat-value">$\${c.currentEquity.toFixed(2)}</div></div>
                    <div class="card-stat"><div class="card-stat-label">Return</div><div class="card-stat-value \${c.totalReturn>=0?'positive':'negative'}">\${c.totalReturn>=0?'+':''}\${c.totalReturn.toFixed(2)}%</div></div>
                    <div class="card-stat"><div class="card-stat-label">Trades</div><div class="card-stat-value">\${c.totalTrades}</div></div>
                    <div class="card-stat"><div class="card-stat-label">Win Rate</div><div class="card-stat-value">\${c.winRate.toFixed(1)}%</div></div>
                </div>
                <div class="mini-chart"><svg viewBox="0 0 100 40" style="width:100%;height:100%"><polyline points="0,20 100,20" fill="none" stroke="\${c.totalReturn>=0?'var(--green)':'var(--red)'}" stroke-width="2"/></svg></div>
            </div>\`).join('')}
        loadAll();
    </script>
</body>
</html>`);
});

// Trader detail page
app.get('/trader/:coin', checkAuth, (req, res) => {
    const coin = req.params.coin.toUpperCase();
    const d = loadTraderData(coin);
    if (!d) return res.status(404).send('<h1>Trader not found</h1>');
    
    const equityChart = d.equity.length > 1 ? (() => {
        const vals = d.equity.map(e => e.equity);
        const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
        const pts = vals.map((v, i) => ((i / (vals.length - 1)) * 100) + ',' + (40 - ((v - min) / range) * 30)).join(' ');
        return '<svg viewBox="0 0 100 40" style="width:100%;height:100%"><polyline points="0,40 ' + pts + ' 100,40" fill="rgba(59,130,246,0.1)" stroke="var(--blue)" stroke-width="1.5"/></svg>';
    })() : '';
    
    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>\${coin} Trader | Paper Trading</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#f8fafc;--muted:#94a3b8;--green:#10b981;--red:#ef4444;--blue:#3b82f6;--purple:#8b5cf6}
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Inter',system-ui;background:var(--bg);color:var(--text);padding:20px;line-height:1.6}
        .container{max-width:1200px;margin:0 auto}
        a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
        .back{display:inline-flex;align-items:center;gap:8px;margin-bottom:20px;font-weight:500}
        h1{font-size:2rem;margin-bottom:8px;background:linear-gradient(135deg,var(--blue),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        .subtitle{color:var(--muted);margin-bottom:24px}
        .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
        .card{background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border)}
        .card h3{color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
        .card .value{font-size:1.8rem;font-weight:700}
        .positive{color:var(--green)}.negative{color:var(--red)}.muted{color:var(--muted)}
        .section{background:var(--card);border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid var(--border)}
        .section h2{font-size:1.2rem;margin-bottom:16px;display:flex;align-items:center;gap:10px}
        .chart{height:200px;background:rgba(15,23,42,.5);border-radius:8px;padding:16px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:.9rem}
        th,td{padding:12px;text-align:left;border-bottom:1px solid var(--border)}
        th{color:var(--muted);font-weight:500;font-size:.8rem;text-transform:uppercase}
        tr:hover{background:rgba(255,255,255,.02)}
        .badge{display:inline-block;padding:4px 10px;border-radius:6px;font-size:.75rem;font-weight:600}
        .badge-long{background:rgba(16,185,129,.15);color:var(--green)}.badge-short{background:rgba(239,68,68,.15);color:var(--red)}
        .badge-tp{background:rgba(16,185,129,.1);color:var(--green)}.badge-sl{background:rgba(239,68,68,.1);color:var(--red)}
        .badge-signal{background:rgba(148,163,184,.1);color:var(--muted)}
        .empty{text-align:center;padding:40px;color:var(--muted)}
        @media(max-width:768px){.grid{grid-template-columns:repeat(2,1fr)}table{font-size:.8rem}}
    </style>
</head>
<body>
    <div class="container">
        <a href="/?password=${PASSWORD}" class="back">← Back to Dashboard</a>
        <h1>\${coin} Paper Trader</h1>
        <p class="subtitle">\${d.params?.configName || 'Default'} Strategy • \${d.params?.leverage || 3}x Leverage</p>
        
        <div class="grid">
            <div class="card"><h3>Initial Capital</h3><div class="value">$\${d.initialCapital.toFixed(2)}</div></div>
            <div class="card"><h3>Current Equity</h3><div class="value">$\${d.currentEquity.toFixed(2)}</div></div>
            <div class="card"><h3>Total Return</h3><div class="value \${d.totalReturn>=0?'positive':'negative'}">\${d.totalReturn>=0?'+':''}\${d.totalReturn.toFixed(2)}%</div></div>
            <div class="card"><h3>Total P&L</h3><div class="value \${d.totalPnL>=0?'positive':'negative'}">\${d.totalPnL>=0?'+':''}$\${d.totalPnL.toFixed(2)}</div></div>
            <div class="card"><h3>Total Trades</h3><div class="value">\${d.totalTrades}</div></div>
            <div class="card"><h3>Win Rate</h3><div class="value">\${d.winRate.toFixed(1)}%</div></div>
            <div class="card"><h3>Sharpe Ratio</h3><div class="value \${d.sharpeRatio>0?'positive':'muted'}">\${d.sharpeRatio.toFixed(2)}</div></div>
            <div class="card"><h3>Max Drawdown</h3><div class="value negative">\${d.maxDrawdown.toFixed(2)}%</div></div>
            <div class="card"><h3>Profit Factor</h3><div class="value \${d.profitFactor>1?'positive':'muted'}">\${d.profitFactor.toFixed(2)}</div></div>
            <div class="card"><h3>Avg Win/Loss</h3><div class="value">\${d.winLossRatio.toFixed(2)}</div></div>
            <div class="card"><h3>Best Streak</h3><div class="value positive">\${d.maxWinStreak}W</div></div>
            <div class="card"><h3>Worst Streak</h3><div class="value negative">\${d.maxLossStreak}L</div></div>
        </div>
        
        \${d.position?\`
        <div class="section">
            <h2>📊 Current Position</h2>
            <div class="grid">
                <div class="card"><h3>Type</h3><div class="value \${d.position.type==='LONG'?'positive':'negative'}">\${d.position.type}</div></div>
                <div class="card"><h3>Entry Price</h3><div class="value">$\${d.position.entryPrice.toFixed(2)}</div></div>
                <div class="card"><h3>Position Size</h3><div class="value">\${(d.position.size*100).toFixed(0)}%</div></div>
                <div class="card"><h3>Unrealized P&L</h3><div class="value \${d.position.currentPnL>=0?'positive':'negative'}">\${d.position.currentPnL>=0?'+':''}$\${d.position.currentPnL.toFixed(2)}</div></div>
            </div>
        </div>
        \`:''}
        
        <div class="section">
            <h2>📈 Equity Curve</h2>
            <div class="chart">\${equityChart}</div>
        </div>
        
        \${d.bestTrade?\`
        <div class="section">
            <h2>🏆 Best & Worst Trades</h2>
            <div class="grid">
                <div class="card">
                    <h3>Best Trade</h3>
                    <div class="value positive">+\${d.bestTrade.pnlPercent.toFixed(2)}%</div>
                    <div class="muted">$\${d.bestTrade.pnl.toFixed(2)} • \${new Date(d.bestTrade.exitTime).toLocaleDateString()}</div>
                </div>
                <div class="card">
                    <h3>Worst Trade</h3>
                    <div class="value negative">\${d.worstTrade.pnlPercent.toFixed(2)}%</div>
                    <div class="muted">$\${d.worstTrade.pnl.toFixed(2)} • \${new Date(d.worstTrade.exitTime).toLocaleDateString()}</div>
                </div>
            </div>
        </div>
        \`:''}
        
        <div class="section">
            <h2>📝 Trade History (Last \${d.trades.length})</h2>
            \${d.trades.length?\`
            <table>
                <thead><tr><th>Type</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Return</th><th>Reason</th><th>Time</th></tr></thead>
                <tbody>
                    \${[...d.trades].reverse().map(t=>\`<tr>
                        <td><span class="badge badge-\${t.type.toLowerCase()}">\${t.type}</span></td>
                        <td>$\${t.entryPrice.toFixed(2)}</td>
                        <td>$\${t.exitPrice.toFixed(2)}</td>
                        <td class="\${t.pnl>=0?'positive':'negative'}">\${t.pnl>=0?'+':''}$\${t.pnl.toFixed(2)}</td>
                        <td class="\${t.pnlPercent>=0?'positive':'negative'}">\${t.pnlPercent>=0?'+':''}\${t.pnlPercent.toFixed(2)}%</td>
                        <td><span class="badge badge-\${t.exitReason==='TAKE_PROFIT'?'tp':t.exitReason==='STOP_LOSS'?'sl':'signal'}">\${t.exitReason.replace('_',' ')}</span></td>
                        <td>\${new Date(t.exitTime).toLocaleString()}</td>
                    </tr>\`).join('')}
                </tbody>
            </table>
            \`:'<div class="empty"><h3>No trades yet</h3><p>Trades will appear here when the strategy executes</p></div>'}
        </div>
    </div>
</body>
</html>`);
});

app.listen(PORT, () => console.log(`Dashboard v2 running on port ${PORT}`));