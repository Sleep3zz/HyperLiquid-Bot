import { useEffect, useState } from 'react';
import { Activity, RefreshCw, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';
import { useSocket } from '../hooks/useSocket';
import TraderCard from '../components/TraderCard';
import HybridMetrics from '../components/HybridMetrics';

export default function Dashboard() {
  const [traders, setTraders] = useState([]);
  const [hybridMetrics, setHybridMetrics] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const { socket, isConnected } = useSocket();

  const fetchData = async () => {
    try {
      const res = await fetch('/api/traders');
      const data = await res.json();
      setTraders(data.traders || []);
      
      // Parse hybrid metrics from traders data
      const metrics = {};
      data.traders?.forEach(trader => {
        if (trader.hybrid) {
          metrics[trader.coin] = {
            coin: trader.coin,
            ...trader.hybrid
          };
        }
      });
      setHybridMetrics(metrics);
    } catch (err) {
      console.error('Failed to fetch traders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  // Real-time updates via Socket.io
  useEffect(() => {
    if (!socket) return;

    socket.on('hybrid-update', (data) => {
      setHybridMetrics(prev => ({
        ...prev,
        [data.coin]: data
      }));
    });

    return () => socket.off('hybrid-update');
  }, [socket]);

  const totalEquity = traders.reduce((sum, t) => sum + (t.currentEquity || 0), 0);
  const avgReturn = traders.length 
    ? traders.reduce((sum, t) => sum + (t.totalReturn || 0), 0) / traders.length 
    : 0;
  const activePositions = traders.filter(t => t.hasPosition).length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="animate-spin" />
          <span>Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold text-white flex items-center gap-3">
            <BarChart3 className="text-blue-500" size={36} />
            Hybrid Dashboard
          </h1>
          <p className="text-slate-400 mt-2">Grid + BBRSI Regime Switching</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={fetchData}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw size={20} className="text-slate-300" />
          </button>
          <div className={`px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 ${
            isConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <DollarSign size={16} />
            Total Equity
          </div>
          <div className="text-3xl font-semibold text-white">${totalEquity.toFixed(0)}</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <TrendingUp size={16} />
            Avg Return
          </div>
          <div className={`text-3xl font-semibold ${avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <Activity size={16} />
            Active Traders
          </div>
          <div className="text-3xl font-semibold text-white">{traders.length}</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-2">
            <BarChart3 size={16} />
            Positions
          </div>
          <div className={`text-3xl font-semibold ${activePositions > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
            {activePositions}
          </div>
        </div>
      </div>

      {/* Live Hybrid Metrics */}
      {Object.keys(hybridMetrics).length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
            <Activity className="text-purple-400" />
            Live Hybrid Metrics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(hybridMetrics).map(([coin, metrics]) => (
              <HybridMetrics key={coin} metrics={metrics} />
            ))}
          </div>
        </div>
      )}

      {/* Traders Grid */}
      <h2 className="text-xl font-semibold mb-4 text-white flex items-center gap-2">
        <BarChart3 className="text-blue-400" />
        Active Traders
      </h2>
      {traders.length === 0 ? (
        <div className="text-center py-16 bg-slate-900 rounded-2xl border border-slate-800">
          <div className="text-slate-500 text-lg mb-2">No Active Traders</div>
          <p className="text-slate-600">Start a trader to see data here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {traders.map(trader => (
            <TraderCard key={trader.coin} trader={trader} />
          ))}
        </div>
      )}
    </div>
  );
}
