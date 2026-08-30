"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Activity, ShieldAlert, BarChart3, Database } from "lucide-react";
import { createChart, IChartApi, ISeriesApi, LineSeries } from "lightweight-charts";
import { useOrderBook } from "@/hooks/useOrderBook";

export default function TradingDashboard() {
  const router = useRouter();
  const symbol = "BTCUSDT";
  
  // Custom WebSocket Hook
  const orderBook = useOrderBook(symbol);
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Initialize TradingView Lightweight Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });

    chartRef.current = chart;
    seriesRef.current = lineSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update chart data when lastPrice changes
  useEffect(() => {
    if (seriesRef.current && orderBook.lastPrice !== '0.00') {
      // For a real app, use the actual timestamp from the server. 
      // Using local time for Phase 1 simulation.
      const timestamp = Math.floor(Date.now() / 1000);
      seriesRef.current.update({
        time: timestamp as any,
        value: parseFloat(orderBook.lastPrice),
      });
    }
  }, [orderBook.lastPrice]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.push('/')}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors border border-transparent hover:border-white/10"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-phase5 flex items-center gap-2">
              <BarChart3 className="w-6 h-6" /> ULTRON TRADING ENGINE
            </h1>
            <p className="text-xs text-slate-400 font-mono tracking-widest mt-1">PHASE 1: MARKET OBSERVATION</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs font-mono bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
            <span className={`w-2 h-2 rounded-full ${orderBook.isConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-red-500'}`} />
            {orderBook.isConnected ? 'DATA STREAM ACTIVE' : 'RECONNECTING...'}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Charts & Metrics */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Top Metrics Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <div className="text-xs text-slate-500 font-mono mb-1">TARGET ASSET</div>
              <div className="text-xl font-bold">{symbol}</div>
              <div className="text-xs text-slate-400 mt-1">CoinEx (Spot)</div>
            </div>
            
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <div className="text-xs text-slate-500 font-mono mb-1">MID PRICE</div>
              <div className="text-xl font-bold text-white">${parseFloat(orderBook.lastPrice).toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
            </div>
            
            <div className="bg-black/40 border border-phase5/20 p-4 rounded-xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-phase5/5 group-hover:bg-phase5/10 transition-colors" />
              <div className="relative">
                <div className="text-xs text-phase5/70 font-mono mb-1">CURRENT SPREAD</div>
                <div className="text-xl font-bold text-phase5">${orderBook.spread}</div>
              </div>
            </div>
          </div>

          {/* Chart Container */}
          <div className="bg-black/40 border border-white/5 rounded-xl p-4 h-[450px] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-bold text-slate-300 font-mono flex items-center gap-2">
                <Activity className="w-4 h-4 text-phase5" /> LIVE PRICE ACTION
              </h2>
            </div>
            <div ref={chartContainerRef} className="flex-1 w-full relative" />
          </div>

        </div>

        {/* Right Column: Order Book */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          <div className="bg-black/40 border border-white/5 rounded-xl p-4 flex-1">
            <h2 className="text-sm font-bold text-slate-300 font-mono flex items-center gap-2 mb-6 pb-2 border-b border-white/5">
              <Database className="w-4 h-4 text-phase2" /> LIVE ORDER BOOK
            </h2>
            
            <div className="flex justify-between text-xs font-mono text-slate-500 mb-2 px-2">
              <span>PRICE (USDT)</span>
              <span>AMOUNT</span>
            </div>

            {/* Asks (Sells) - Render reversed so lowest ask is at bottom */}
            <div className="space-y-1 mb-4 flex flex-col-reverse">
              {orderBook.asks.map(([price, amount], idx) => {
                const relativeSize = Math.min((parseFloat(amount) / 2) * 100, 100);
                return (
                  <div key={`ask-${price}-${idx}`} className="flex justify-between text-sm font-mono relative py-1 px-2">
                    <div className="absolute top-0 right-0 h-full bg-red-500/10" style={{ width: `${relativeSize}%` }} />
                    <span className="text-red-400 relative z-10">{parseFloat(price).toFixed(2)}</span>
                    <span className="text-slate-300 relative z-10">{parseFloat(amount).toFixed(4)}</span>
                  </div>
                );
              })}
            </div>

            {/* Spread Indicator */}
            <div className="py-2 my-2 border-y border-white/5 flex items-center justify-center gap-2 text-xs font-mono text-phase5 bg-phase5/5 rounded">
              <span>SPREAD: ${orderBook.spread}</span>
            </div>

            {/* Bids (Buys) */}
            <div className="space-y-1 mt-4">
              {orderBook.bids.map(([price, amount], idx) => {
                const relativeSize = Math.min((parseFloat(amount) / 2) * 100, 100);
                return (
                  <div key={`bid-${price}-${idx}`} className="flex justify-between text-sm font-mono relative py-1 px-2">
                    <div className="absolute top-0 right-0 h-full bg-green-500/10" style={{ width: `${relativeSize}%` }} />
                    <span className="text-green-400 relative z-10">{parseFloat(price).toFixed(2)}</span>
                    <span className="text-slate-300 relative z-10">{parseFloat(amount).toFixed(4)}</span>
                  </div>
                );
              })}
            </div>

          </div>

          <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-400 mb-1">PAPER TRADING ONLY</h3>
              <p className="text-xs text-red-400/80 leading-relaxed">
                Execution engine is currently locked. Observing live market data only. API keys are strictly read-only.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
