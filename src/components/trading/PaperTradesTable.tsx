"use client";

import { useTradingStore } from "@/store/tradingStore";
import { format } from "date-fns";
import { CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, FileText, Database } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function PaperTradesTable() {
  const { trades } = useTradingStore();

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-black/40 border border-white/5 rounded-xl p-8 flex flex-col items-center justify-center text-center">
        <FileText className="w-10 h-10 text-slate-600 mb-3" />
        <h3 className="text-slate-400 font-mono text-sm">NO PAPER TRADES LOGGED YET</h3>
        <p className="text-slate-500 text-xs mt-2 max-w-xs leading-relaxed">
          The Hunter Engine will automatically log hypothetical trades here when it finds a high-probability Gann setup.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-black/40 border border-white/5 rounded-xl p-4 overflow-hidden flex flex-col">
      <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
        <div>
          <h2 className="text-sm font-bold text-phase5 font-mono flex items-center gap-2">
            <Database className="w-4 h-4" /> AI PAPER TRADES LEDGER
          </h2>
          <p className="text-xs text-slate-500 mt-1">Autonomous Forward-Testing Log</p>
        </div>
        <div className="bg-phase5/10 border border-phase5/20 text-phase5 text-xs font-mono px-3 py-1.5 rounded-lg flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-phase5 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-phase5" />
          </span>
          MONITORING ACTIVE
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[10px] font-mono text-slate-500 tracking-widest border-b border-white/5">
              <th className="pb-3 px-4 font-normal">DATE / TIME</th>
              <th className="pb-3 px-4 font-normal">ASSET</th>
              <th className="pb-3 px-4 font-normal">TYPE</th>
              <th className="pb-3 px-4 font-normal text-right">ENTRY</th>
              <th className="pb-3 px-4 font-normal text-right">TARGET (TP)</th>
              <th className="pb-3 px-4 font-normal text-right">STOP (SL)</th>
              <th className="pb-3 px-4 font-normal text-center">STATUS</th>
              <th className="pb-3 px-4 font-normal text-right">NET PNL</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {trades.map((trade, idx) => (
                <motion.tr 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  key={trade.id} 
                  className="border-b border-white/5 hover:bg-white/5 transition-colors group text-sm"
                >
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="text-slate-300">{format(new Date(trade.created_at), "MMM dd")}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{format(new Date(trade.created_at), "HH:mm")}</div>
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-200">{trade.symbol.replace('USDT', '/USDT')}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border ${trade.position_type === 'LONG' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                      {trade.position_type === 'LONG' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {trade.position_type}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-300">${trade.entry_price.toFixed(4)}</td>
                  <td className="py-3 px-4 text-right font-mono text-green-400/80">${trade.take_profit.toFixed(4)}</td>
                  <td className="py-3 px-4 text-right font-mono text-red-400/80">${trade.stop_loss.toFixed(4)}</td>
                  <td className="py-3 px-4 text-center">
                    {trade.status === 'OPEN' && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-full border border-yellow-500/20">
                        <Clock className="w-3.5 h-3.5 animate-spin-slow" /> OPEN
                      </span>
                    )}
                    {trade.status === 'WON' && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded-full border border-green-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5" /> WON
                      </span>
                    )}
                    {trade.status === 'LOST' && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded-full border border-red-500/20">
                        <XCircle className="w-3.5 h-3.5" /> LOST
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold">
                    {trade.status === 'OPEN' ? (
                      <span className="text-slate-500">--</span>
                    ) : (
                      <span className={trade.pnl >= 0 ? "text-green-500" : "text-red-500"}>
                        {trade.pnl > 0 ? "+" : ""}{trade.pnl.toFixed(2)}
                      </span>
                    )}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );
}
