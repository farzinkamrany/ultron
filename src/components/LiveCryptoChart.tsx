"use client";

import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, LineSeries } from "lightweight-charts";
import { useOrderBook } from "@/hooks/useOrderBook";
import { Activity } from "lucide-react";

export function LiveCryptoChart({ symbol, color = "#00bfff" }: { symbol: string, color?: string }) {
  const orderBook = useOrderBook(symbol);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      width: chartContainerRef.current.clientWidth,
      height: 80,
      timeScale: { visible: false },
      rightPriceScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: color,
      lineWidth: 2,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
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
  }, [color]);

  useEffect(() => {
    if (seriesRef.current && orderBook.lastPrice !== '0.00') {
      const timestamp = Math.floor(Date.now() / 1000);
      seriesRef.current.update({
        time: timestamp as any,
        value: parseFloat(orderBook.lastPrice),
      });
    }
  }, [orderBook.lastPrice]);

  return (
    <div className="bg-black/30 border border-white/5 rounded-xl p-3 hover:border-white/10 transition-colors">
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-bold text-slate-200">{symbol}</span>
        </div>
        <div className="text-right flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${orderBook.isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <div className="text-sm font-mono font-bold text-white">
            ${parseFloat(orderBook.lastPrice).toLocaleString(undefined, {minimumFractionDigits: 2})}
          </div>
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full mt-2" />
    </div>
  );
}
