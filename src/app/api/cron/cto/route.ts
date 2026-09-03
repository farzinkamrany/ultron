import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { redis } from '@/lib/redis';
import ccxt from 'ccxt';
import { generateCTOConfig } from '@/lib/ai';

export const maxDuration = 60; // Allow 60s for Vercel execution
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // Note: In production, add QStash verification here.
    
    // 1. Gather Daily Stats from Supabase
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const { data: trades, error } = await supabase
      .from('paper_trades')
      .select('*')
      .gte('created_at', yesterday.toISOString());
      
    let totalTrades = 0;
    let won = 0;
    let maxDrawdown = 0;
    let netPnl = 0;
    
    if (trades && trades.length > 0) {
      totalTrades = trades.length;
      won = trades.filter(t => t.status === 'WON').length;
      netPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      
      // Rough drawdown calc (max consecutive loss)
      let currentLoss = 0;
      for (const t of trades) {
        if (t.status === 'LOST') {
          currentLoss += (t.pnl || 0);
          if (currentLoss < maxDrawdown) maxDrawdown = currentLoss;
        } else if (t.status === 'WON') {
          currentLoss = 0;
        }
      }
    }
    
    const winRate = totalTrades > 0 ? (won / totalTrades) * 100 : 0;
    
    // Pass the actual trades to the AI so it can read entry_logic and miss_reason
    const recentTrades = trades ? trades.map(t => ({
      symbol: t.symbol,
      status: t.status,
      pnl: t.pnl,
      entry_logic: t.rationale,
      miss_reason: t.status === 'LOST' ? 'Hit Stop Loss' : null
    })) : [];

    const dailyStats = {
      total_trades: totalTrades,
      win_rate: winRate,
      max_drawdown: maxDrawdown,
      net_pnl: netPnl,
      recent_trades: recentTrades
    };

    // 2. Gather Market Regime (Volatility/ATR)
    const exchange = new ccxt.bybit({ enableRateLimit: true, options: { defaultType: 'spot' } });
    const ohlcv = await exchange.fetchOHLCV('BTC/USDT', '1d', undefined, 14);
    
    // Simple ATR calculation
    let atr = 0;
    if (ohlcv.length > 1) {
      let trSum = 0;
      for (let i = 1; i < ohlcv.length; i++) {
        const high = ohlcv[i][2] || 0;
        const low = ohlcv[i][3] || 0;
        const prevClose = ohlcv[i-1][4] || 0;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trSum += tr;
      }
      atr = trSum / (ohlcv.length - 1);
    }
    
    const currentPrice = (ohlcv[ohlcv.length - 1] && ohlcv[ohlcv.length - 1][4]) || 1;
    const atrPercent = (atr / currentPrice) * 100;
    
    const firstPrice = (ohlcv[0] && ohlcv[0][4]) || 1;
    const marketRegime = {
      asset: 'BTC/USDT',
      atr_percent: atrPercent,
      volatility: atrPercent > 5 ? 'HIGH' : (atrPercent < 2 ? 'LOW' : 'NORMAL'),
      trend: currentPrice > firstPrice ? 'UPTREND' : 'DOWNTREND'
    };
    
    // 3. Macro Sentiment (Mocked for now, can integrate real funding rates)
    const macroSentiment = {
      funding_rates: 'Neutral',
      fear_greed_index: 'Greed (75)' // Hardcoded placeholder
    };

    // 4. Call CTO AI
    const ctoResponse = await generateCTOConfig(dailyStats, marketRegime, macroSentiment);
    
    // 5. Save to Redis
    await redis.set('ul_cto_config', JSON.stringify(ctoResponse.config));
    
    console.log(`[CTO] Daily Config Generated:`, ctoResponse.config);
    console.log(`[CTO Detected Regime]`, ctoResponse.detected_regime);
    console.log(`[CTO Reasoning]`, ctoResponse.reasoning);
    
    return NextResponse.json({
      success: true,
      config: ctoResponse.config,
      detected_regime: ctoResponse.detected_regime,
      reasoning: ctoResponse.reasoning
    });
    
  } catch (err: any) {
    console.error("[CTO Cron] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
