import { LineChart, Line, ResponsiveContainer } from 'recharts';

export default function PriceSparkline({ data = [], color = "#3b82f6" }) {
  if (!data || data.length < 2) {
    return (
      <div className="h-12 w-full flex items-center justify-center text-xs text-slate-500">
        No price history
      </div>
    );
  }

  const chartData = data.map((price, index) => ({
    index,
    price,
  }));

  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line 
            type="monotone" 
            dataKey="price" 
            stroke={color} 
            strokeWidth={2} 
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
