import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';

export default function TraderCard({ trader, price }) {
  return (
    <Link 
      to={`/trader/${trader.coin}`}
      className="block bg-slate-900 border border-slate-700 hover:border-blue-500 transition-all duration-200 rounded-2xl p-5 group"
    >
      <div className="flex justify-between items-start mb-4">
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

      {/* Price Section */}
      {price && (
        <div className="mb-4 p-3 bg-slate-950 rounded-xl border border-slate-700">
          <div className="flex justify-between items-baseline">
            <div>
              <div className="text-xs text-slate-400">Current Price</div>
              <div className="text-xl font-semibold tabular-nums">
                ${price.price?.toLocaleString()}
              </div>
            </div>
            <div className={`text-sm font-medium px-2 py-0.5 rounded ${price.change24h >= 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
              {price.change24h >= 0 ? '+' : ''}{price.change24h?.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* Equity & Return */}
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

      {/* Hybrid Preview */}
      {trader.hybrid && (
        <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-between text-sm">
          <div>
            <span className="text-slate-400">Hybrid: </span>
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
