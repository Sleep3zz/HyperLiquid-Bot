import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Activity, DollarSign, Percent, Award } from 'lucide-react';
import EquityChart from '../components/EquityChart';

export default function TraderDetail() {
  const { coin } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/traders/${coin}`);
        const traderData = await res.json();
        setData(traderData);
      } catch (err) {
        console.error('Failed to fetch trader:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [coin]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400">Loading trader data...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-2">Trader not found</div>
          <button 
            onClick={() => navigate('/')}
            className="text-blue-400 hover:underline"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isPositive = data.totalReturn >= 0;
  const isWinning = data.winRate >= 50;

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <button 
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Dashboard
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-2xl text-white">
          {coin[0]}
        </div>
        <div>
          <h1 className="text-4xl font-bold text-white">{coin}</h1>
          <p className="text-slate-400">Paper Trading Performance</p>
        </div>
        <div className="ml-auto text-right">
          <div className={`text-4xl font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{data.totalReturn.toFixed(2)}%
          </div>
          <div className="text-slate-400">Total Return</div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <DollarSign size={16} />
            Initial Capital
          </div>
          <div className="text-2xl font-semibold text-white">${data.initialCapital.toFixed(0)}</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <DollarSign size={16} />
            Current Equity
          </div>
          <div className="text-2xl font-semibold text-white">${data.currentEquity.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <Activity size={16} />
            Total Trades
          </div>
          <div className="text-2xl font-semibold text-white">{data.totalTrades}</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <Percent size={16} />
            Win Rate
          </div>
          <div className={`text-2xl font-semibold ${isWinning ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.winRate.toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <TrendingDown size={16} />
            Max Drawdown
          </div>
          <div className="text-2xl font-semibold text-red-400">{data.maxDrawdown.toFixed(2)}%</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <TrendingUp size={16} />
            Sharpe Ratio
          </div>
          <div className={`text-2xl font-semibold ${data.sharpeRatio > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
            {data.sharpeRatio.toFixed(2)}
          </div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <Award size={16} />
            Profit Factor
          </div>
          <div className={`text-2xl font-semibold ${data.profitFactor > 1 ? 'text-emerald-400' : 'text-slate-400'}`}>
            {data.profitFactor.toFixed(2)}
          </div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <DollarSign size={16} />
            Total P&L
          </div>
          <div className={`text-2xl font-semibold ${data.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.totalPnL >= 0 ? '+' : ''}${data.totalPnL.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Equity Chart */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 mb-8">
        <h2 className="text-xl font-semibold text-white mb-4">Equity Curve</h2>
        <EquityChart equity={data.equity} />
      </div>

      {/* Current Position */}
      {data.position && (
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">Current Position</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-slate-400 text-sm">Type</div>
              <div className={`text-xl font-semibold ${data.position.type === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                {data.position.type}
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-sm">Entry Price</div>
              <div className="text-xl font-semibold text-white">${data.position.entryPrice?.toFixed(2) || 'N/A'}</div>
            </div>
            <div>
              <div className="text-slate-400 text-sm">Size</div>
              <div className="text-xl font-semibold text-white">{((data.position.size || 0) * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-slate-400 text-sm">Unrealized P&L</div>
              <div className={`text-xl font-semibold ${(data.position.currentPnL || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(data.position.currentPnL || 0) >= 0 ? '+' : ''}${(data.position.currentPnL || 0).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trade History */}
      {data.trades && data.trades.length > 0 && (
        <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
          <h2 className="text-xl font-semibold text-white mb-4">Recent Trades</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-400 text-sm border-b border-slate-700">
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Entry</th>
                  <th className="pb-3">Exit</th>
                  <th className="pb-3">P&L</th>
                  <th className="pb-3">Return</th>
                </tr>
              </thead>
              <tbody>
                {[...data.trades].reverse().slice(0, 10).map((trade, i) => (
                  <tr key={i} className="border-b border-slate-800/50 last:border-0">
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        trade.type === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {trade.type}
                      </span>
                    </td>
                    <td className="py-3 text-slate-300">${trade.entryPrice?.toFixed(2)}</td>
                    <td className="py-3 text-slate-300">${trade.exitPrice?.toFixed(2)}</td>
                    <td className={`py-3 font-medium ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                    </td>
                    <td className={`py-3 font-medium ${trade.pnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
