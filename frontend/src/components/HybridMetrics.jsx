export default function HybridMetrics({ metrics }) {
  if (!metrics) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Hybrid Status</h3>
        {metrics.paused && (
          <span className="text-xs bg-red-500/20 text-red-400 px-2.5 py-1 rounded-full">PAUSED</span>
        )}
      </div>
      
      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Regime</span>
          <span className="font-medium">{metrics.regime || 'N/A'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Active Strategy</span>
          <span className="font-medium">{metrics.activeStrategy || 'N/A'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Daily Switches</span>
          <span className="font-medium">{metrics.dailySwitches || 0}</span>
        </div>
      </div>
    </div>
  );
}
