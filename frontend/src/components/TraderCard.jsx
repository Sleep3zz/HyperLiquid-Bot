import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';

export default function TraderCard({ trader }) {
  return (
    <Link 
      to={`/trader/${trader.coin}`}
      className="block bg-slate-900 border border-slate-700 hover:border-blue-500 transition-all rounded-2xl p-5 hover:shadow-lg"
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold">{trader.coin}</h3>
          <p className="text-sm text-slate-400">
            {trader.hasPosition ? 'In Position' : 'Idle'}
          </p>
        </div>
        
        <StatusBadge 
          type={trader.hasPosition ? trader.positionType : 'IDLE'} 
          value={trader.hasPosition ? trader.unrealizedPnL : null} 
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-slate-400">Equity</div>
          <div className="text-xl font-semibold">
            ${trader.currentEquity?.toFixed(2)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Return</div>
          <div className={`text-xl font-semibold ${trader.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trader.totalReturn >= 0 ? '+' : ''}{trader.totalReturn?.toFixed(2)}%
          </div>
        </div>
      </div>

      {trader.hybrid && (
        <div className="mt-4 pt-4 border-t border-slate-700 flex items-center gap-2 text-sm">
          <span className="text-slate-400">Hybrid:</span>
          <span className="font-medium">{trader.hybrid.regime}</span>
          {trader.hybrid.paused && (
            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">PAUSED</span>
          )}
        </div>
      )}
    </Link>
  );
}
