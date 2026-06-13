export default function HybridMetrics({ metrics, coin }) {
  if (!metrics) return null;

  const getRegimeColor = (regime) => {
    switch (regime) {
      case 'TRENDING': return 'text-emerald-400';
      case 'RANGING': return 'text-blue-400';
      case 'HIGH_VOLATILITY': return 'text-orange-400';
      case 'TRANSITIONING': return 'text-yellow-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 hover:border-purple-500 transition-colors rounded-2xl p-5">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="font-semibold text-lg">{coin}</div>
          <div className={`text-sm font-medium ${getRegimeColor(metrics.regime)}`}>
            {metrics.regime}
          </div>
        </div>

        {metrics.paused && (
          <span className="text-xs bg-red-500/20 text-red-400 px-2.5 py-1 rounded-full border border-red-500/30">
            PAUSED
          </span>
        )}
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Active Strategy</span>
          <span className="font-medium text-purple-400">{metrics.activeStrategy}</span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Daily Switches</span>
          <span className="font-medium">{metrics.dailySwitches || 0}</span>
        </div>
      </div>
    </div>
  );
}
