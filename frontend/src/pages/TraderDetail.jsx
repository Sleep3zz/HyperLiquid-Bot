import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import EquityChart from '../components/EquityChart';

const API_URL = import.meta.env.VITE_API_URL || 'https://trading.s3zapp.us';

export default function TraderDetail() {
  const { coin } = useParams();
  const [data, setData] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [traderRes, pricesRes] = await Promise.all([
          fetch(`${API_URL}/api/traders/${coin}`),
          fetch(`${API_URL}/api/prices`)
        ]);

        const traderData = await traderRes.json();
        const prices = await pricesRes.json();

        setData(traderData);
        setPriceData(prices.prices?.[coin] || null);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000); // 5 second refresh for live prices
    return () => clearInterval(interval);
  }, [coin]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading trader data...</p>
        </div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center pt-20">
        <h1 className="text-3xl font-bold mb-2">Trader not found</h1>
        <p className="text-slate-400">No data available for {coin}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold flex items-center gap-3">
          {coin} Trader
        </h1>
        <p className="text-slate-400 mt-1">
          {data.params?.configName || 'Hybrid Strategy'} • Last updated: {new Date(data.lastUpdated).toLocaleString()}
        </p>
      </div>

      {/* Current Market Price */}
      {priceData && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <i className="fa-solid fa-chart-line text-blue-400"></i>
            Current Market Data
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400">Current Price</div>
              <div className="text-3xl font-semibold mt-1 tabular-nums">
                ${priceData.price?.toLocaleString()}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400">24h Change</div>
              <div className={`text-3xl font-semibold mt-1 ${priceData.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {priceData.change24h >= 0 ? '+' : ''}{priceData.change24h?.toFixed(2)}%
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400">24h High</div>
              <div className="text-3xl font-semibold mt-1 tabular-nums text-emerald-400">
                ${priceData.high24h?.toLocaleString()}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400">24h Low</div>
              <div className="text-3xl font-semibold mt-1 tabular-nums text-red-400">
                ${priceData.low24h?.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Stats */}
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

      {/* Hybrid Strategy Status */}
      {data.hybrid && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <i className="fa-solid fa-robot text-purple-400 text-2xl"></i>
            <h2 className="text-2xl font-semibold">Hybrid Strategy Status</h2>
            {data.hybrid.paused && (
              <span className="ml-2 px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded-full border border-red-500/30">
                PAUSED
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400 mb-1">Current Regime</div>
              <div className={`text-3xl font-semibold ${
                data.hybrid.regime === 'TRENDING' ? 'text-emerald-400' :
                data.hybrid.regime === 'RANGING' ? 'text-blue-400' :
                data.hybrid.regime === 'HIGH_VOLATILITY' ? 'text-orange-400' : 'text-slate-400'
              }`}>
                {data.hybrid.regime}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400 mb-1">Active Strategy</div>
              <div className="text-3xl font-semibold text-purple-400">
                {data.hybrid.activeStrategy}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400 mb-1">Daily Switches</div>
              <div className="text-3xl font-semibold mt-1">{data.hybrid.dailySwitches || 0}</div>
            </div>

            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
              <div className="text-sm text-slate-400 mb-1">Status</div>
              <div className={`text-3xl font-semibold ${data.hybrid.paused ? 'text-red-400' : 'text-emerald-400'}`}>
                {data.hybrid.paused ? 'Paused' : 'Active'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Equity Curve */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Equity Curve</h2>
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">
          <EquityChart equity={data.equity} />
        </div>
      </div>
    </div>
  );
}
