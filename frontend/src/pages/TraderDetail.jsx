import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import EquityChart from '../components/EquityChart';

const API_URL = import.meta.env.VITE_API_URL || 'https://trading.s3zapp.us';

export default function TraderDetail() {
  const { coin } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_URL}/api/traders/${coin}`);
        const result = await res.json();
        setData(result);
      } catch (error) {
        console.error('Failed to fetch trader data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [coin]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p>Loading trader data...</p>
        </div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Trader not found</h1>
        <p className="text-slate-400">No data available for {coin}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">{coin} Trader</h1>
        <p className="text-slate-400 mt-1">
          {data.params?.configName || 'Hybrid Strategy'} • Last updated: {new Date(data.lastUpdated).toLocaleString()}
        </p>
      </div>

      {/* Key Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-700">
          <div className="text-sm text-slate-400">Current Equity</div>
          <div className="text-3xl font-semibold mt-1">${data.currentEquity?.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-700">
          <div className="text-sm text-slate-400">Total Return</div>
          <div className={`text-3xl font-semibold mt-1 ${data.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.totalReturn >= 0 ? '+' : ''}{data.totalReturn?.toFixed(2)}%
          </div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-700">
          <div className="text-sm text-slate-400">Win Rate</div>
          <div className="text-3xl font-semibold mt-1">{data.winRate?.toFixed(1)}%</div>
        </div>
        <div className="bg-slate-900 p-5 rounded-2xl border border-slate-700">
          <div className="text-sm text-slate-400">Max Drawdown</div>
          <div className="text-3xl font-semibold mt-1 text-red-400">{data.maxDrawdown?.toFixed(2)}%</div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Equity Curve</h2>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">
          <EquityChart equity={data.equity} />
        </div>
      </div>

      {/* Hybrid Status */}
      {data.hybrid && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Hybrid Strategy Status</h2>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-sm text-slate-400">Current Regime</div>
                <div className="text-2xl font-semibold mt-1">{data.hybrid.regime}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Active Strategy</div>
                <div className="text-2xl font-semibold mt-1">{data.hybrid.activeStrategy}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Daily Switches</div>
                <div className="text-2xl font-semibold mt-1">{data.hybrid.dailySwitches}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400">Status</div>
                <div className={`text-2xl font-semibold mt-1 ${data.hybrid.paused ? 'text-red-400' : 'text-emerald-400'}`}>
                  {data.hybrid.paused ? 'Paused' : 'Active'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
