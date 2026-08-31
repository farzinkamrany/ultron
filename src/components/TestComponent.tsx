import React from 'react';

interface TestComponentProps {
  title?: string;
  status?: 'active' | 'pending' | 'error';
}

export const TestComponent: React.FC<TestComponentProps> = ({
  title = "Ultron Tactical Badge",
  status = "active",
}) => {
  const statusColors = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    error: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };

  return (
    <div className="flex items-center gap-3 p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-lg backdrop-blur-md">
      <div className="relative flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-mono uppercase tracking-wider text-slate-400">System Status</span>
        <span className="text-sm font-semibold text-slate-100">{title}</span>
      </div>
      <span className={`ml-auto px-2.5 py-1 text-xs font-mono rounded-md border ${statusColors[status]}`}>
        {status.toUpperCase()}
      </span>
    </div>
  );
};

export default TestComponent;