"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useTradingStore } from "@/store/tradingStore";
import { Activity, TrendingUp, TrendingDown, Target, Clock, Wallet, AlertTriangle, Percent, X, Calendar, ArrowRight } from "lucide-react";
import { EquityCurve } from "@/components/charts/EquityCurve";

export default function PnLDashboard() {
  const { trades, fetchPaperTrades } = useTradingStore();
  const [visibleCount, setVisibleCount] = useState(10);
  const [selectedTrade, setSelectedTrade] = useState<any>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 10, trades.length));
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    return () => observer.disconnect();
  }, [trades.length]);

  useEffect(() => {
    fetchPaperTrades();
    const interval = setInterval(fetchPaperTrades, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [fetchPaperTrades]);

  const stats = useMemo(() => {
    const closedTrades = trades.filter((t) => t.status === "WON" || t.status === "LOST");
    const wonTrades = trades.filter((t) => t.status === "WON");
    const activeTrades = trades.filter((t) => t.status === "OPEN");

    const winRate = closedTrades.length > 0 ? (wonTrades.length / closedTrades.length) * 100 : 0;
    
    const totalPnl = closedTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);

    // Calculate Max Drawdown & Profit Factor
    let peak = 0;
    let maxDd = 0;
    let running = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    const sortedClosed = [...closedTrades].sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeA - timeB;
    });

    for (const trade of sortedClosed) {
      const pnl = trade.pnl || 0;
      running += pnl;
      
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDd) maxDd = dd;

      if (pnl > 0) grossProfit += pnl;
      if (pnl < 0) grossLoss += Math.abs(pnl);
    }

    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? "MAX" : "0.00") : (grossProfit / grossLoss).toFixed(2);

    return {
      winRate: winRate.toFixed(1),
      totalPnl: totalPnl.toFixed(2),
      activePositions: activeTrades.length,
      maxDrawdown: maxDd.toFixed(2),
      profitFactor,
    };
  }, [trades]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 pb-20">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ultron Quant</h1>
            <p className="text-muted-foreground text-sm">Algorithmic Trading Dashboard</p>
          </div>
          <Activity className="text-primary w-8 h-8 opacity-80" />
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Win Rate</span>
              <Target className="w-4 h-4 text-primary" />
            </div>
            <div className="text-2xl font-bold flex items-baseline space-x-1">
              <span>{stats.winRate}</span>
              <span className="text-xs font-normal text-muted-foreground">%</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Total PnL</span>
              <Wallet className="w-4 h-4 text-primary" />
            </div>
            <div className={`text-2xl font-bold flex items-baseline space-x-1 ${parseFloat(stats.totalPnl) >= 0 ? "text-green-500" : "text-red-500"}`}>
              <span>{parseFloat(stats.totalPnl) > 0 ? "+" : ""}{stats.totalPnl}</span>
              <span className="text-xs font-normal opacity-80">USDT</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Active</span>
              <Clock className="w-4 h-4 text-primary" />
            </div>
            <div className="text-2xl font-bold text-primary">
              {stats.activePositions}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Max DD</span>
              <AlertTriangle className="w-4 h-4 text-orange-500" />
            </div>
            <div className="text-2xl font-bold text-orange-500 flex items-baseline space-x-1">
              <span>-{stats.maxDrawdown}</span>
              <span className="text-xs font-normal opacity-80">USDT</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2 col-span-2 md:col-span-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Profit Factor</span>
              <Percent className="w-4 h-4 text-primary" />
            </div>
            <div className="text-2xl font-bold text-primary">
              {stats.profitFactor}
            </div>
          </div>
        </div>

        {/* Equity Curve Chart */}
        <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-4 flex items-center">
            <TrendingUp className="w-4 h-4 mr-2" />
            Cumulative Equity Curve
          </h2>
          <div className="h-[300px] w-full">
            <EquityCurve trades={trades} />
          </div>
        </div>

        {/* Trades List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border/50 pb-2">Recent Execution Log</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {trades.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 col-span-full">No algorithmic trades executed yet.</p>
            ) : (
              trades.slice(0, visibleCount).map((trade) => (
                <div 
                  key={trade.id} 
                  onClick={() => setSelectedTrade(trade)}
                  className="p-3 rounded-lg bg-card/50 border border-border/30 flex items-center justify-between group hover:border-primary/30 transition-all gap-2 cursor-pointer active:scale-[0.98]"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className={`p-2 shrink-0 rounded-xl ${trade.position_type === 'LONG' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                      {trade.position_type === 'LONG' ? <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" /> : <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-sm sm:text-base flex items-center gap-2 flex-wrap">
                        <span className="truncate">{trade.symbol}</span>
                        <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-sm font-bold tracking-widest shrink-0 ${trade.position_type === 'LONG' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                          {trade.position_type}
                        </span>
                      </div>
                      <div className="text-[10px] sm:text-[11px] font-mono text-muted-foreground mt-1 flex flex-col gap-0.5">
                        <span className="flex items-center gap-1 flex-wrap">
                          <span>Entry: ${Number(trade.entry_price).toFixed(1)}</span>
                          <span className="text-muted-foreground/60">
                            • {new Date(trade.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end justify-center shrink-0">
                    <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-sm border ${
                      trade.status === 'WON' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                      trade.status === 'LOST' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                      'bg-blue-500/10 text-blue-500 border-blue-500/20'
                    }`}>
                      {trade.status}
                    </span>
                    {trade.status !== 'OPEN' && (
                      <span className={`text-xs sm:text-sm font-bold font-mono mt-1 ${trade.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {trade.pnl >= 0 ? "+" : ""}{Number(trade.pnl).toFixed(1)} <span className="text-[9px]">USDT</span>
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Infinite Scroll Anchor */}
          {visibleCount < trades.length && (
            <div ref={loadMoreRef} className="w-full py-6 flex justify-center items-center">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
        </div>
      </div>

      {/* Trade Details Modal */}
      {selectedTrade && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-center items-end md:items-center">
          <div className="bg-card w-full md:w-[450px] max-w-full rounded-t-2xl md:rounded-2xl border border-border/50 shadow-2xl p-6 animate-in slide-in-from-bottom-10 md:slide-in-from-bottom-0 md:zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  {selectedTrade.symbol}
                  <span className={`text-xs px-2 py-1 rounded-md font-bold tracking-widest ${selectedTrade.position_type === 'LONG' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                    {selectedTrade.position_type}
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(selectedTrade.created_at).toLocaleString('fa-IR')}
                </p>
              </div>
              <button onClick={() => setSelectedTrade(null)} className="p-2 rounded-full hover:bg-muted/50 transition-colors">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-muted/30 border border-border/30">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                  <p className={`font-bold ${
                    selectedTrade.status === 'WON' ? 'text-green-500' :
                    selectedTrade.status === 'LOST' ? 'text-red-500' :
                    'text-blue-500'
                  }`}>{selectedTrade.status}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">PnL</p>
                  <p className={`font-bold font-mono ${selectedTrade.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {selectedTrade.pnl >= 0 ? "+" : ""}{Number(selectedTrade.pnl).toFixed(2)} USDT
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 p-4 rounded-xl bg-muted/30 border border-border/30 font-mono text-sm">
                <div className="flex justify-between items-center py-1">
                  <span className="text-muted-foreground">Entry Price</span>
                  <span className="font-bold">${Number(selectedTrade.entry_price).toFixed(4)}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-t border-border/30">
                  <span className="text-green-500/80">Take Profit</span>
                  <span className="text-green-500 font-bold">${Number(selectedTrade.take_profit).toFixed(4)}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-t border-border/30">
                  <span className="text-red-500/80">Stop Loss</span>
                  <span className="text-red-500 font-bold">${Number(selectedTrade.stop_loss).toFixed(4)}</span>
                </div>
              </div>

              {selectedTrade.closed_at && (
                <p className="text-xs text-center text-muted-foreground mt-4 border-t border-border/30 pt-4">
                  Closed: {new Date(selectedTrade.closed_at).toLocaleString('fa-IR')}
                </p>
              )}
            </div>

            <button 
              onClick={() => setSelectedTrade(null)}
              className="w-full mt-6 bg-primary text-primary-foreground py-3 rounded-xl font-bold hover:bg-primary/90 transition-colors"
            >
              Close Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
