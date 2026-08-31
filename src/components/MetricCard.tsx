import React, { useState } from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  isPositive?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  isPositive = true
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`p-6 rounded-2xl border transition-all duration-300 ${
        isHovered
          ? 'bg-slate-900 border-indigo-500 shadow-lg shadow-indigo-500/20 translate-y-[-2px]'
          : 'bg-slate-950 border-slate-800 shadow-sm'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-400">{title}</span>
        {change && (
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              isPositive
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}
          >
            {change}
          </span>
        )}
      </div>
      <div className="mt-4">
        <h3 className="text-2xl font-bold tracking-tight text-white">{value}</h3>
      </div>
    </div>
  );
};

export default MetricCard;
