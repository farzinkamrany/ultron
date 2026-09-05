"use client";

import { useEffect, useMemo } from "react";
import { useTradingStore } from "@/store/tradingStore";
import { Activity, TrendingUp, TrendingDown, Target, Clock, Wallet, AlertTriangle, Percent } from "lucide-react";
import { EquityCurve } from "@/components/charts/EquityCurve";

export default function PnLDashboard() {
  const { trades, fetchPaperTrades } = useTradingStore();

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
              trades.slice(0, 10).map((trade) => (
                <div key={trade.id} className="p-3 rounded-lg bg-card/50 border border-border/30 flex items-center justify-between group hover:border-primary/30 transition-all gap-2">
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
                          <span>Entry: ${trade.entry_price}</span>
                          <span className="text-muted-foreground/60">
                            • {new Date(trade.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-green-500/90 truncate">TP: ${trade.take_profit}</span>
                          <span className="text-red-500/90 truncate">SL: ${trade.stop_loss}</span>
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
                        {trade.pnl >= 0 ? "+" : ""}{Number(trade.pnl).toFixed(2)} <span className="text-[9px]">USDT</span>
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
