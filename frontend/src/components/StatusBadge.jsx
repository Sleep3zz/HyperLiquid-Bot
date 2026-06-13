export default function StatusBadge({ type, value }) {
  const getStyles = () => {
    switch (type) {
      case 'LONG':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'SHORT':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'IDLE':
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStyles()}`}>
      {type}
      {value !== null && value !== undefined && (
        <span className="ml-1.5 font-mono">
          {value >= 0 ? '+' : ''}{value.toFixed(2)}
        </span>
      )}
    </div>
  );
}
