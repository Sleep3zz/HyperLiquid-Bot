import { TrendingUp, TrendingDown, Activity, DollarSign } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TraderCard({ trader }) {
  const navigate = useNavigate();
  const isPositive = trader.totalReturn >= 0;

  return (
    <div 
      onClick={() => navigate(`/trader/${trader.coin}`)}
      className="bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 transition-all p-5 rounded-2xl cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-lg text-white">
            {trader.coin[0]}
          </div>
          <div>
            <div className="font-semibold text-lg text-white">{trader.coin}</div>
            <div className={`text-sm ${trader.hasPosition ? 'text-emerald-400' : 'text-slate-400'}`}>
              {trader.hasPosition ? `In Position (${trader.position?.type || 'LONG'})` : 'Idle'}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{trader.totalReturn.toFixed(2)}%
          </div>
          <div className="text-xs text-slate-400">Return</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-slate-800/50 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
            <DollarSign size={12} />
            Equity
          </div>
          <div className="font-semibold text-white">${trader.currentEquity.toFixed(0)}</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
            <Activity size={12} />
            Trades
          </div>
          <div className="font-semibold text-white">{trader.totalTrades}</div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
            {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            Win Rate
          </div>
          <div className="font-semibold text-white">{trader.winRate.toFixed(1)}%</div>
        </div>
      </div>

      {trader.hybrid && (
        <div className="border-t border-slate-700 pt-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Regime:</span>
            <span className="text-purple-400 font-medium">{trader.hybrid.regime}</span>
          </div>
          {trader.hybrid.paused && (
            <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
              PAUSED
            </span>
          )}
        </div>
      )}
    </div>
  );
}
