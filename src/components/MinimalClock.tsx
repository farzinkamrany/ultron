import React,{useState,useEffect} from 'react';

const MinimalClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const dateString = time.toLocaleDateString('fa-IR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-2xl shadow-2xl transition-all duration-300 hover:border-blue-500/30">
      <div className="text-4xl font-mono font-bold text-white tracking-widest tabular-nums">
        {timeString}
      </div>
      <div className="mt-2 text-sm text-gray-400 font-light">
        {dateString}
      </div>
    </div>
  );
};

export default MinimalClock;