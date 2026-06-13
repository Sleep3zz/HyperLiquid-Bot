export default function HybridMetrics({ metrics, coin }) {
  if (!metrics) return null;

  const regimeColor = {
    TRENDING: 'text-emerald-400',
    RANGING: 'text-blue-400',
    HIGH_VOLATILITY: 'text-orange-400',
    TRANSITIONING: 'text-yellow-400',
    UNKNOWN: 'text-slate-400'
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 hover:border-purple-500 transition-colors">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="font-semibold text-lg">{coin}</div>
          <div className={`text-sm font-medium ${regimeColor[metrics.regime] || 'text-slate-400'}`}>
            {metrics.regime}
          </div>
        </div>
        {metrics.paused && (
          <span className="text-xs bg-red-500/20 text-red-400 px-2.5 py-1 rounded-full">PAUSED</span>
        )}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Strategy</span>
          <span className="font-medium">{metrics.activeStrategy}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Daily Switches</span>
          <span className="font-medium">{metrics.dailySwitches}</span>
        </div>
      </div>
    </div>
  );
}
