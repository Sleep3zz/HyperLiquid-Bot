import { useEffect, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import TraderCard from '../components/TraderCard';
import HybridMetrics from '../components/HybridMetrics';

const API_URL = import.meta.env.VITE_API_URL || 'https://trading.s3zapp.us';

export default function Dashboard() {
  const [traders, setTraders] = useState([]);
  const [hybridMetrics, setHybridMetrics] = useState({});
  const { socket, isConnected } = useSocket();

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
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
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

    return () => {
      socket.off('hybrid-update');
    };
  }, [socket]);

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold">Hybrid Dashboard</h1>
          <p className="text-slate-400">Grid + BBRSI Regime Switching • Live</p>
        </div>
        <div className={`px-4 py-1.5 rounded-full text-sm flex items-center gap-2 ${
          isConnected 
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
            : 'bg-red-500/10 text-red-400 border border-red-500/30'
        }`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Live Hybrid Metrics */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span>Live Hybrid Metrics</span>
          <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded">Real-time</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.keys(hybridMetrics).length > 0 ? (
            Object.entries(hybridMetrics).map(([coin, metrics]) => (
              <HybridMetrics key={coin} metrics={metrics} />
            ))
          ) : (
            <div className="col-span-3 text-center py-8 text-slate-400 bg-slate-900 rounded-2xl border border-slate-700">
              Waiting for hybrid strategy data...
            </div>
          )}
        </div>
      </div>

      {/* Traders Grid */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Active Traders</h2>
        <button 
          onClick={() => window.location.reload()} 
          className="text-sm px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center gap-2 transition-colors"
        >
          <i className="fa-solid fa-sync-alt"></i>
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {traders.length > 0 ? (
          traders.map(trader => (
            <TraderCard key={trader.coin} trader={trader} />
          ))
        ) : (
          <div className="col-span-full text-center py-12 text-slate-400">
            No active traders found.
          </div>
        )}
      </div>
    </div>
  );
}
