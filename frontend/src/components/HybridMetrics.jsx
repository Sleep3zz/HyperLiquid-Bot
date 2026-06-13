export default function HybridMetrics({ metrics }) {
  if (!metrics) return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
      <div className="text-slate-500 text-center">No hybrid data</div>
    </div>
  );

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
      <h3 className="font-semibold mb-4 flex items-center gap-2 text-white">
        <span>{metrics.coin}</span>
        {metrics.paused && (
          <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
            PAUSED
          </span>
        )}
      </h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-slate-400 text-xs uppercase tracking-wider">Regime</div>
          <div className="font-medium text-white mt-1">{metrics.regime || 'N/A'}</div>
        </div>
        <div>
          <div className="text-slate-400 text-xs uppercase tracking-wider">Strategy</div>
          <div className="font-medium text-white mt-1">{metrics.activeStrategy || 'N/A'}</div>
        </div>
        <div>
          <div className="text-slate-400 text-xs uppercase tracking-wider">Daily Switches</div>
          <div className="font-medium text-white mt-1">{metrics.dailySwitches || 0}</div>
        </div>
        {metrics.pauseReason && (
          <div className="col-span-2">
            <div className="text-slate-400 text-xs uppercase tracking-wider">Pause Reason</div>
            <div className="font-medium text-red-400 mt-1 text-xs">{metrics.pauseReason}</div>
          </div>
        )}
      </div>
    </div>
  );
}
