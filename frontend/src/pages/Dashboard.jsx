import { useEffect, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import TraderCard from '../components/TraderCard';
import HybridMetrics from '../components/HybridMetrics';

const API_URL = import.meta.env.VITE_API_URL || 'https://trading.s3zapp.us';

export default function Dashboard() {
  const [traders, setTraders] = useState([]);
  const [hybridMetrics, setHybridMetrics] = useState({});
  const { socket, isConnected } = useSocket();

  // Fetch traders data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_URL}/api/traders`);
        const data = await res.json();
        setTraders(data.traders || []);
      } catch (error) {
        console.error('Failed to fetch traders:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Real-time Hybrid updates via Socket.io
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

  // Count regimes for summary
  const regimeCounts = Object.values(hybridMetrics).reduce((acc, m) => {
    const regime = m.regime || 'UNKNOWN';
    acc[regime] = (acc[regime] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold">Hybrid Dashboard</h1>
          <p className="text-slate-400 mt-1">Grid + BBRSI Regime Switching • Live</p>
        </div>
        <div className={`px-4 py-1.5 rounded-full text-sm flex items-center gap-2 border ${
          isConnected 
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
            : 'bg-red-500/10 text-red-400 border-red-500/30'
        }`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          {isConnected ? 'Live Connected' : 'Disconnected'}
        </div>
      </div>

      {/* === PROMINENT HYBRID METRICS SECTION === */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <i className="fa-solid fa-robot text-purple-400"></i>
              Live Hybrid Strategy Status
            </h2>
            <p className="text-sm text-slate-400 mt-1">Real-time regime detection across all coins</p>
          </div>
          {Object.keys(hybridMetrics).length > 0 && (
            <div className="flex gap-2 text-sm">
              {Object.entries(regimeCounts).map(([regime, count]) => (
                <div key={regime} className="px-3 py-1 bg-slate-900 border border-slate-700 rounded-full text-xs">
                  {regime}: <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.keys(hybridMetrics).length > 0 ? (
            Object.entries(hybridMetrics).map(([coin, metrics]) => (
              <HybridMetrics key={coin} metrics={metrics} coin={coin} />
            ))
          ) : (
            <div className="col-span-full bg-slate-900 border border-slate-700 rounded-2xl p-8 text-center">
              <div className="text-slate-400">
                Waiting for hybrid strategy data...<br />
                <span className="text-xs">Start your hybrid traders to see live regime updates.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Traders Section */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold">Active Traders</h2>
        <button 
          onClick={() => window.location.reload()} 
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm rounded-xl transition-colors"
        >
          <i className="fa-solid fa-sync-alt"></i>
          <span>Refresh</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {traders.length > 0 ? (
          traders.map(trader => (
            <TraderCard key={trader.coin} trader={trader} />
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-400 bg-slate-900 rounded-2xl border border-slate-700">
            No active traders found.<br />
            <span className="text-xs">Start traders with: node hybrid-paper-trader.js</span>
          </div>
        )}
      </div>
    </div>
  );
}
