"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Activity, ShieldAlert, BarChart3, Database, Star, Plus, X } from "lucide-react";
import { createChart, IChartApi, ISeriesApi, LineSeries } from "lightweight-charts";
import { useOrderBook } from "@/hooks/useOrderBook";
import { useTradingStore } from "@/store/tradingStore";
import { PaperTradesTable } from "@/components/trading/PaperTradesTable";

const POPULAR_PAIRS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", 
  "DOGEUSDT", "BNBUSDT", "MATICUSDT", "DOTUSDT", "LINKUSDT", 
  "AVAXUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "ETCUSDT",
  "SHIBUSDT", "TRXUSDT", "XLMUSDT", "BCHUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "ARBUSDT", "SUIUSDT", "SEIUSDT",
  "PEPEUSDT", "WIFUSDT", "FETUSDT", "RNDRUSDT", "INJUSDT"
];

export default function TradingDashboard() {
  const router = useRouter();
  
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [newFav, setNewFav] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  
  const { favorites, addFavorite, removeFavorite, fetchPaperTrades } = useTradingStore();

  useEffect(() => {
    setIsMounted(true);
    fetchPaperTrades();
  }, [fetchPaperTrades]);
  
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

  // Clear chart when symbol changes
  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.setData([]);
    }
  }, [symbol]);

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

      {/* Favorites Bar */}
      {isMounted && (
        <div className="mb-6 bg-black/40 p-4 rounded-xl border border-white/5 flex flex-wrap gap-3 items-center">
          <span className="text-sm text-slate-400 font-mono flex items-center gap-2"><Star className="w-4 h-4 text-yellow-500"/> FAVORITES:</span>
          {favorites.map(fav => (
            <div 
              key={fav} 
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-mono cursor-pointer transition-colors ${symbol === fav ? 'bg-phase5/20 border-phase5/50 text-phase5' : 'bg-white/5 border-transparent text-slate-300 hover:bg-white/10'}`} 
              onClick={() => setSymbol(fav)}
            >
              {fav}
              {fav !== 'BTCUSDT' && (
                <button 
                  onClick={(e) => { e.stopPropagation(); removeFavorite(fav); }} 
                  className="ml-2 opacity-50 hover:opacity-100 hover:text-red-400 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          
          <div className="relative ml-auto flex items-center">
            <form 
              onSubmit={(e) => { 
                e.preventDefault(); 
                if (newFav.trim()) { 
                  addFavorite(newFav.trim().toUpperCase()); 
                  setSymbol(newFav.trim().toUpperCase());
                  setNewFav(""); 
                  setShowDropdown(false);
                } 
              }} 
              className="flex items-center gap-2"
            >
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Search pairs..." 
                  value={newFav} 
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                  onChange={e => {
                    setNewFav(e.target.value.toUpperCase());
                    setShowDropdown(true);
                  }}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-slate-200 outline-none focus:border-phase5/50 focus:bg-slate-800 w-48 placeholder-slate-500 transition-colors shadow-inner"
                />
                
                {showDropdown && newFav.length >= 1 && (
                  <div className="absolute top-full mt-1 left-0 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-[0_0_15px_rgba(0,0,0,0.5)] overflow-hidden z-50">
                    {POPULAR_PAIRS.filter(p => p.includes(newFav.toUpperCase()) && !favorites.includes(p)).slice(0, 5).map(p => (
                      <div 
                        key={p} 
                        onClick={() => {
                          addFavorite(p);
                          setSymbol(p);
                          setNewFav("");
                          setShowDropdown(false);
                        }}
                        className="px-3 py-2 text-sm font-mono text-slate-300 hover:bg-slate-800 hover:text-phase5 cursor-pointer border-b border-slate-800 last:border-0 transition-colors"
                      >
                        {p}
                      </div>
                    ))}
                    {POPULAR_PAIRS.filter(p => p.includes(newFav.toUpperCase()) && !favorites.includes(p)).length === 0 && (
                       <div className="px-3 py-2 text-xs font-mono text-slate-500">No popular pairs found. Press + to add anyway.</div>
                    )}
                  </div>
                )}
              </div>
              <button type="submit" className="bg-phase5/10 hover:bg-phase5/20 text-phase5 border border-phase5/20 rounded-lg p-1.5 transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        
        {/* Left Column: Charts & Metrics */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Top Metrics Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
              <div className="text-xs text-slate-500 font-mono mb-1">TARGET ASSET</div>
              <div className="text-xl font-bold">{symbol}</div>
              <div className="text-xs text-slate-400 mt-1">Bybit (Spot)</div>
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

      {/* Full Width Row: Paper Trades Ledger */}
      <div className="mt-8">
        <PaperTradesTable />
      </div>

    </div>
  );
}
