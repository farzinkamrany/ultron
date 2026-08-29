import { useState, useEffect } from 'react';

export default function MinimalClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const persianDate = time.toLocaleDateString('fa-IR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const gregorianDate = time.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl shadow-xl w-full max-w-xs mx-auto my-4">
      <div className="text-4xl font-mono font-bold text-white tracking-widest">
        {timeString}
      </div>
      <div className="text-xs text-slate-400 mt-2 font-mono">
        {persianDate}
      </div>
      <div className="text-[10px] text-slate-500 mt-1 font-mono uppercase">
        {gregorianDate}
      </div>
    </div>
  );
}
