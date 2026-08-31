"use client";

import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi } from 'lightweight-charts';

export function EquityCurve({ trades }: { trades: any[] }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chartOptions = {
      layout: {
        textColor: '#D1D5DB', // text-gray-300
        background: { type: ColorType.Solid, color: 'transparent' },
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    };

    const chart = createChart(chartContainerRef.current, chartOptions);
    chartRef.current = chart;

    const areaSeries = chart.addAreaSeries({
      lineColor: '#3b82f6', // blue-500
      topColor: 'rgba(59, 130, 246, 0.4)',
      bottomColor: 'rgba(59, 130, 246, 0.0)',
      lineWidth: 2,
    });

    // Prepare data: filter closed trades
    const closedTrades = [...trades].filter(t => t.status === "WON" || t.status === "LOST");
    
    // Sort by creation date if available
    closedTrades.sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return timeA - timeB;
    });

    // Calculate cumulative PnL
    let runningPnl = 0;
    const data = closedTrades.map((t, i) => {
      runningPnl += (t.pnl || 0);
      
      // We need a strictly increasing UNIX timestamp (seconds)
      const timestamp = t.created_at 
        ? Math.floor(new Date(t.created_at).getTime() / 1000) 
        : Math.floor(Date.now() / 1000 - (closedTrades.length - i) * 86400); // fallback to fake daily sequence
        
      return {
        time: timestamp as any,
        value: runningPnl
      };
    });

    // Ensure times are strictly increasing (lightweight-charts requirement)
    let lastTime = 0;
    const cleanData = data.map(d => {
       if (d.time <= lastTime) {
           d.time = lastTime + 60; // add 1 minute offset to duplicates
       }
       lastTime = d.time;
       return d;
    });

    // Only set data if we have at least one trade
    if (cleanData.length > 0) {
      areaSeries.setData(cleanData);
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        });
      }
    };
    
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, [trades]);

  return (
    <div className="w-full h-full min-h-[300px] md:min-h-[400px] rounded-xl overflow-hidden" ref={chartContainerRef} />
  );
}
