import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function EquityChart({ equity }) {
  if (!equity || equity.length === 0) return (
    <div className="h-64 w-full bg-slate-900 rounded-xl flex items-center justify-center text-slate-500">
      No equity data available
    </div>
  );

  const chartData = equity.map((point, index) => ({
    time: index,
    equity: point.equity,
  }));

  return (
    <div className="h-64 w-full bg-slate-900 rounded-xl p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="time" hide />
          <YAxis 
            domain={['auto', 'auto']} 
            stroke="#94a3b8"
            tickFormatter={(value) => `$${value.toFixed(0)}`}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1e293b', 
              border: '1px solid #334155',
              borderRadius: '8px'
            }}
            formatter={(value) => [`$${value.toFixed(2)}`, 'Equity']}
          />
          <Line 
            type="monotone" 
            dataKey="equity" 
            stroke="#3b82f6" 
            strokeWidth={2} 
            dot={false} 
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
