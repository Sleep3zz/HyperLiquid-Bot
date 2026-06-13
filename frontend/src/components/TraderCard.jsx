import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';

export default function TraderCard({ trader }) {
  return (
    <Link 
      to={`/trader/${trader.coin}`}
      className="block bg-slate-900 border border-slate-700 hover:border-blue-500 transition-all duration-200 rounded-2xl p-5 group"
    >
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight">{trader.coin}</h3>
          <p className="text-sm text-slate-400 mt-0.5">
            {trader.hasPosition ? 'In Position' : 'No Position'}
          </p>
        </div>

        <StatusBadge 
          type={trader.hasPosition ? trader.positionType : 'IDLE'} 
          value={trader.hasPosition ? trader.unrealizedPnL : null} 
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-400">Equity</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">
            ${trader.currentEquity?.toFixed(2)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-slate-400">Return</div>
          <div className={`text-2xl font-semibold mt-1 tabular-nums ${trader.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trader.totalReturn >= 0 ? '+' : ''}{trader.totalReturn?.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Hybrid Status Preview */}
      {trader.hybrid && (
        <div className="mt-5 pt-4 border-t border-slate-700 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Hybrid</span>
            <span className="font-medium text-purple-400">{trader.hybrid.regime}</span>
          </div>
          
          {trader.hybrid.paused && (
            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">PAUSED</span>
          )}
        </div>
      )}
    </Link>
  );
}
