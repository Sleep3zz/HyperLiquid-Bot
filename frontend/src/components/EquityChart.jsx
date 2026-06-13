import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function EquityChart({ equity }) {
  if (!equity || equity.length < 2) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 bg-slate-950 rounded-xl">
        Not enough equity data yet
      </div>
    );
  }

  const chartData = equity.map((point, index) => ({
    index,
    equity: point.equity,
    time: new Date(point.timestamp || Date.now()).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <XAxis dataKey="index" hide />
          <YAxis domain={['auto', 'auto']} />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1e293b', 
              border: 'none',
              borderRadius: '8px',
              color: '#f8fafc'
            }} 
          />
          <Line 
            type="monotone" 
            dataKey="equity" 
            stroke="#3b82f6" 
            strokeWidth={2.5} 
            dot={false}
            activeDot={{ r: 5, fill: '#3b82f6' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
