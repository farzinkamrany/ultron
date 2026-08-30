"use client";

import { useEffect, useMemo } from "react";
import { useTradingStore } from "@/store/tradingStore";
import { Activity, TrendingUp, TrendingDown, Target, Clock, Wallet } from "lucide-react";

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

    return {
      winRate: winRate.toFixed(2),
      totalPnl: totalPnl.toFixed(2),
      activePositions: activeTrades.length,
    };
  }, [trades]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 pb-20">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PnL Visualizer</h1>
            <p className="text-muted-foreground text-sm">Paper Trading Engine Analytics</p>
          </div>
          <Activity className="text-primary w-8 h-8 opacity-80" />
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-sm font-medium">Win Rate</span>
              <Target className="w-4 h-4" />
            </div>
            <div className="text-3xl font-bold flex items-baseline space-x-1">
              <span>{stats.winRate}</span>
              <span className="text-sm font-normal text-muted-foreground">%</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-sm font-medium">Total PnL</span>
              <Wallet className="w-4 h-4" />
            </div>
            <div className={`text-3xl font-bold flex items-baseline space-x-1 ${parseFloat(stats.totalPnl) >= 0 ? "text-green-500" : "text-red-500"}`}>
              <span>{parseFloat(stats.totalPnl) > 0 ? "+" : ""}{stats.totalPnl}</span>
              <span className="text-sm font-normal opacity-80">USDT</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/50 bg-card shadow-sm flex flex-col space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-sm font-medium">Active Positions</span>
              <Clock className="w-4 h-4" />
            </div>
            <div className="text-3xl font-bold text-primary">
              {stats.activePositions}
            </div>
          </div>
        </div>

        {/* Trades List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border/50 pb-2">Recent Trades</h2>
          <div className="space-y-3">
            {trades.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">No trades recorded yet.</p>
            ) : (
              trades.slice(0, 10).map((trade) => (
                <div key={trade.id} className="p-4 rounded-lg bg-card/50 border border-border/30 flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className={`p-2 rounded-full ${trade.position_type === 'LONG' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                      {trade.position_type === 'LONG' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{trade.symbol} <span className="text-xs opacity-70 ml-1">{trade.position_type}</span></div>
                      <div className="text-xs text-muted-foreground mt-0.5">Entry: {trade.entry_price}</div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      trade.status === 'WON' ? 'bg-green-500/20 text-green-500' :
                      trade.status === 'LOST' ? 'bg-red-500/20 text-red-500' :
                      'bg-blue-500/20 text-blue-500'
                    }`}>
                      {trade.status}
                    </span>
                    {trade.status !== 'OPEN' && (
                      <span className={`text-sm font-medium mt-1 ${trade.pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {trade.pnl >= 0 ? "+" : ""}{trade.pnl} USDT
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
