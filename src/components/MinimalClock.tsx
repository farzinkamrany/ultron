import { useState, useEffect } from 'react';

export default function MinimalClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const persianDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    dateStyle: 'full',
  }).format(time);

  return (
    <div className=\"flex flex-col items-center justify-center p-4 bg-black/40 border border-white/10 rounded-2xl backdrop-blur-md shadow-2xl mb-6\">
      <div className=\"text-4xl font-mono font-bold text-phase1 tracking-widest\">
        {timeString}
      </div>
      <div className=\"text-sm text-slate-400 mt-2 font-medium\">
        {persianDate}
      </div>
    </div>
  );
}
