import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import ccxt from 'ccxt';
import { verifyQStashSignature } from '@/lib/qstash';
import { redis } from '@/lib/redis';
import { CTOConfig } from '@/lib/ai';
import { sendTelegramMessage } from '@/lib/telegram';

export const maxDuration = 60; // Allow 60s for Vercel execution to avoid 504 Timeout
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 0. Verify QStash signature OR CRON_SECRET for security
    const isDev = process.env.NODE_ENV === 'development';
    
    if (!isDev) {
      const authHeader = req.headers.get('authorization');
      const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
      const isQStash = !!req.headers.get("upstash-signature");
      
      if (isQStash) {
        const isValid = await verifyQStashSignature(req);
        if (!isValid) {
          console.error("[Manage Trades] Invalid QStash signature");
          return new NextResponse("Unauthorized", { status: 401 });
        }
      } else if (!isVercelCron) {
        console.error("[Manage Trades] Direct access blocked. Invalid CRON_SECRET.");
        return new NextResponse("Unauthorized", { status: 401 });
      }
    }
    // 1. Fetch CTO Config
    let ctoConfig: CTOConfig | null = null;
    try {
      const configStr = await redis.get('ul_cto_config') as string | null;
      if (configStr) ctoConfig = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
    } catch (err) {
      console.error("Redis fetch failed, using fallback config.");
    }
    const defconLevel = ctoConfig?.defcon_level || 0;

    // 2. Fetch all OPEN paper trades
    const { data: openTrades, error: fetchError } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('status', 'OPEN');

    if (fetchError) throw fetchError;
    if (!openTrades || openTrades.length === 0) {
      return NextResponse.json({ message: 'No open trades to manage' });
    }

    const tradeMode = process.env.TRADE_MODE || 'PAPER';
    const exchange = new ccxt.hyperliquid({
      walletAddress: process.env.HYPERLIQUID_WALLET || "",
      privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || "",
      enableRateLimit: true,
      options: { defaultType: 'swap' }
    });
    
    await exchange.loadMarkets();
    
    const allSymbols = [...new Set(openTrades.map(t => t.symbol))];
    // Filter out symbols that don't exist on this exchange
    const exchangeMarkets = exchange.markets || {};
    
    // Map legacy USDT symbols to USDC:USDC for fetching from Hyperliquid
    const mappedSymbols = allSymbols.map(s => s.endsWith('/USDT') ? s.replace('/USDT', '/USDC:USDC') : s);
    const validMappedSymbols = mappedSymbols.filter(s => !!exchangeMarkets[s]);
    
    const skippedOriginalSymbols = allSymbols.filter((_, i) => !exchangeMarkets[mappedSymbols[i]]);
    if (skippedOriginalSymbols.length > 0) {
      console.warn(`[Manage Trades] Skipping unsupported symbols on this exchange: ${skippedOriginalSymbols.join(', ')}`);
    }
    
    let tickers: any = {};
    try {
        tickers = await exchange.fetchTickers(validMappedSymbols);
    } catch (err: any) {
        console.warn(`[Manage Trades] Failed to fetch tickers in bulk: ${err.message}. Falling back to fetchAll.`);
        tickers = await exchange.fetchTickers();
    }

    let livePositions: any[] = [];
    if (tradeMode === 'MICRO') {
      try {
        livePositions = await exchange.fetchPositions();
      } catch (err) {
        console.error("[Manage Trades] Failed to fetch Hyperliquid positions:", err);
      }
    }
    
    // Fetch 15m candles for ATR 14 Trailing Stop (Chunked Parallel Fetching to prevent timeout & rate limits)
    const metricsCache: Record<string, { atr: number; avgVol: number; currentVol: number; ema200: number }> = {};
    const chunkSize = 3; // Process 3 symbols concurrently to balance speed and rate limits
    for (let i = 0; i < validMappedSymbols.length; i += chunkSize) {
      const chunk = validMappedSymbols.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (symbol) => {
         try {
            const ohlcv = await exchange.fetchOHLCV(symbol, '15m', undefined, 250);
            if (ohlcv.length >= 20) {
              let trSum = 0;
              for (let j = ohlcv.length - 14; j < ohlcv.length; j++) {
                 const cHigh = ohlcv[j][2] as number;
                 const cLow = ohlcv[j][3] as number;
                 const pClose = ohlcv[j-1][4] as number;
                 trSum += Math.max(cHigh - cLow, Math.abs(cHigh - pClose), Math.abs(cLow - pClose));
              }
              const atr = trSum / 14;
              
              let volSum = 0;
              const volPeriod = 20;
              for(let v = ohlcv.length - volPeriod; v < ohlcv.length; v++) {
                  volSum += ohlcv[v][5] as number;
              }
              const avgVol = volSum / volPeriod;
              const currentVol = ohlcv[ohlcv.length - 1][5] as number;
              
              const closes = ohlcv.map(c => c[4] as number);
              let ema200 = closes[0];
              if (closes.length >= 200) {
                  ema200 = closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
                  const k = 2 / (200 + 1);
                  for (let idx = 200; idx < closes.length; idx++) {
                      ema200 = (closes[idx] * k) + (ema200 * (1 - k));
                  }
              }
              
              metricsCache[symbol] = { atr, avgVol, currentVol, ema200 };
            }
         } catch (err) {
            console.error(`[Manage Trades] Failed to fetch OHLCV for ${symbol}:`, err);
         }
      }));
    }

    const FEE_RATE = 0.0012; // 0.12% offset
    const updates = [];
    const newTradesToInsert: any[] = [];

    for (const trade of openTrades) {
      const dbSymbol = trade.symbol;
      const symbol = dbSymbol.endsWith('/USDT') ? dbSymbol.replace('/USDT', '/USDC:USDC') : dbSymbol;
      
      const ticker = tickers[symbol];
      if (!ticker || !ticker.last) continue;

      const currentPrice = ticker.last;
      let newStatus = trade.status;
      let newStopLoss = trade.stop_loss;
      let newTakeProfit = trade.take_profit;
      let newRationale = trade.rationale || '';
      let pnl = 0;
      let closedAt = null;

      // EMOTIONAL FEATURES (Timeout & Breakevens) HAVE BEEN SURGICALLY REMOVED
      // This allows fat tail trends to mature without premature abortion.
      
      let contracts = 1000 / trade.entry_price; // Default virtual size for PAPER

      if (tradeMode === 'MICRO') {
        if (livePositions.length > 0) {
          const pos = livePositions.find(p => p.symbol === symbol);
          const actualContracts = pos ? parseFloat((pos.contracts || 0).toString()) : 0;
          
          if (actualContracts === 0) {
            // Position closed by exchange hitting Stop Loss
            newStatus = 'CLOSED';
            closedAt = new Date().toISOString();
            
            const distToSL = Math.abs(currentPrice - trade.stop_loss);
            const distToTP = Math.abs(currentPrice - trade.take_profit);

            if (distToTP < distToSL) {
              newStatus = 'WON';
              pnl = trade.position_type === 'BUY' ? (trade.take_profit - trade.entry_price) * contracts : (trade.entry_price - trade.take_profit) * contracts;
            } else {
              newStatus = 'LOST';
              pnl = trade.position_type === 'BUY' ? (trade.stop_loss - trade.entry_price) * contracts : (trade.entry_price - trade.stop_loss) * contracts;
            }
            console.log(`[Manage Trades] MICRO trade ${trade.symbol} closed on exchange. Marked as ${newStatus}. PnL: ${pnl}`);
          } else {
            // Position is open, assign real size for logic
            contracts = Math.abs(actualContracts);
          }
        }
      }

      // === THE QUANT BRAIN: Trailing Stop Logic (Applies to BOTH Paper & Micro) ===
      if (newStatus === trade.status) { // Only run if position isn't already closed
        if (trade.position_type === 'BUY' || trade.position_type === 'LONG') {
          
          if (tradeMode === 'PAPER' && currentPrice <= trade.stop_loss) {
            newStatus = 'LOST';
            pnl = (trade.stop_loss - trade.entry_price) * contracts;
            closedAt = new Date().toISOString();
          } else {
            const distanceToTp = trade.take_profit - trade.entry_price;
            // Stage 3: 100% Mark (TP Extension & ATR Trailing)
            if (currentPrice > trade.entry_price * 1.005) { // 0.5% in profit
              if (defconLevel === 0) {
                const metrics = metricsCache[symbol];
                if (metrics) {
                  const isPyramided = trade.rationale?.includes('PYRAMID_SCALE_IN');
                  const trailingAtrMult = isPyramided ? 1.5 : 2;
                  const chandelierLong = currentPrice - (metrics.atr * trailingAtrMult);
                  
                  // Aggressive Breakeven logic applies once Pyramided
                  const baselineSL = isPyramided ? Math.max(trade.entry_price, chandelierLong) : chandelierLong;
                  newStopLoss = Math.max(trade.stop_loss, baselineSL);
                  newTakeProfit = currentPrice * 1.5; // Push TP way up
                  
                  if (!newRationale.includes('ATR_TRAIL')) {
                     newRationale += ' | ATR_TRAIL (Riding the trend)';
                  }
                  
                  // === ASYMMETRIC SCALE-IN (SMART PYRAMIDING) ===
                  const volSpike = metrics.currentVol > metrics.avgVol * 1.5;
                  const trendAligned = currentPrice > metrics.ema200;
                  
                  if (!isPyramided && volSpike && trendAligned) {
                     newRationale += ' | PYRAMID_SCALE_IN';
                     newStopLoss = Math.max(newStopLoss, trade.entry_price); // INSTANT BREAKEVEN
                     
                     if (tradeMode === 'MICRO') {
                       try {
                         await exchange.createMarketOrder(symbol, 'buy', contracts);
                         try {
                           const newSLOrder = await exchange.createOrder(symbol, 'market', 'sell', contracts * 2, undefined, { triggerPrice: newStopLoss, reduceOnly: true });
                           const openOrders = await exchange.fetchOpenOrders(symbol);
                           for (const o of openOrders) {
                             if (o.id && o.id !== newSLOrder.id) await exchange.cancelOrder(o.id, symbol);
                           }
                           console.log(`[Pyramid] Scaled into LONG ${symbol} x2 @ ${currentPrice}`);
                         } catch (slError: any) {
                           console.error(`[CRITICAL SHIELD] Failed SL, reverting Pyramid. Error: ${slError.message}`);
                           await exchange.createMarketOrder(symbol, 'sell', contracts);
                           throw new Error(`Pyramid aborted.`);
                         }
                       } catch (err) {
                         console.error(`[Pyramid] Failed to scale into ${symbol}:`, err);
                       }
                     }
                     
                     newTradesToInsert.push({
                       symbol: trade.symbol,
                       position_type: 'BUY',
                       entry_price: currentPrice,
                       stop_loss: newStopLoss,
                       take_profit: newTakeProfit,
                       status: 'OPEN',
                       pnl: 0,
                       rationale: `PYRAMID child of trade ${trade.id} | ATR_TRAIL`,
                     });
                  }
                } else {
                  newStopLoss = trade.take_profit - (distanceToTp * 0.2);
                  newTakeProfit = trade.take_profit + distanceToTp;
                }
              } else {
                newStatus = 'WON';
                pnl = (currentPrice - trade.entry_price) * contracts;
                closedAt = new Date().toISOString();
              }
            }
          }
        } else if (trade.position_type === 'SELL' || trade.position_type === 'SHORT') {
          
          if (tradeMode === 'PAPER' && currentPrice >= trade.stop_loss) {
            newStatus = 'LOST';
            pnl = (trade.entry_price - trade.stop_loss) * contracts;
            closedAt = new Date().toISOString();
          } else {
            const distanceToTp = trade.entry_price - trade.take_profit;
            // Stage 3: 100% Mark (TP Extension & ATR Trailing)
            if (currentPrice < trade.entry_price * 0.995) { // 0.5% in profit
              if (defconLevel === 0) {
                const metrics = metricsCache[symbol];
                if (metrics) {
                  const isPyramided = trade.rationale?.includes('PYRAMID_SCALE_IN');
                  const trailingAtrMult = isPyramided ? 1.5 : 2;
                  const chandelierShort = currentPrice + (metrics.atr * trailingAtrMult);
                  
                  // Aggressive Breakeven logic applies once Pyramided
                  const baselineSL = isPyramided ? Math.min(trade.entry_price, chandelierShort) : chandelierShort;
                  newStopLoss = Math.min(trade.stop_loss, baselineSL);
                  newTakeProfit = currentPrice * 0.5; // Push TP way down
                  
                  if (!newRationale.includes('ATR_TRAIL')) {
                     newRationale += ' | ATR_TRAIL (Riding the trend)';
                  }
                  
                  // === ASYMMETRIC SCALE-IN (SMART PYRAMIDING) ===
                  const volSpike = metrics.currentVol > metrics.avgVol * 1.5;
                  const trendAligned = currentPrice < metrics.ema200;
                  
                  if (!isPyramided && volSpike && trendAligned) {
                     newRationale += ' | PYRAMID_SCALE_IN';
                     newStopLoss = Math.min(newStopLoss, trade.entry_price); // INSTANT BREAKEVEN
                     
                     if (tradeMode === 'MICRO') {
                       try {
                         await exchange.createMarketOrder(symbol, 'sell', contracts);
                         try {
                           const newSLOrder = await exchange.createOrder(symbol, 'market', 'buy', contracts * 2, undefined, { triggerPrice: newStopLoss, reduceOnly: true });
                           const openOrders = await exchange.fetchOpenOrders(symbol);
                           for (const o of openOrders) {
                             if (o.id && o.id !== newSLOrder.id) await exchange.cancelOrder(o.id, symbol);
                           }
                           console.log(`[Pyramid] Scaled into SHORT ${symbol} x2 @ ${currentPrice}`);
                         } catch (slError: any) {
                           console.error(`[CRITICAL SHIELD] Failed SL, reverting Pyramid. Error: ${slError.message}`);
                           await exchange.createMarketOrder(symbol, 'buy', contracts);
                           throw new Error(`Pyramid aborted.`);
                         }
                       } catch (err) {
                         console.error(`[Pyramid] Failed to scale into ${symbol}:`, err);
                       }
                     }
                     
                     newTradesToInsert.push({
                       symbol: trade.symbol,
                       position_type: 'SELL',
                       entry_price: currentPrice,
                       stop_loss: newStopLoss,
                       take_profit: newTakeProfit,
                       status: 'OPEN',
                       pnl: 0,
                       rationale: `PYRAMID child of trade ${trade.id} | ATR_TRAIL`,
                     });
                  }
                } else {
                  newStopLoss = trade.take_profit + (distanceToTp * 0.2);
                  newTakeProfit = trade.take_profit - distanceToTp;
                }
              } else {
                newStatus = 'WON';
                pnl = (trade.entry_price - currentPrice) * contracts;
                closedAt = new Date().toISOString();
              }
            }
          }
        }
      }

      // 4. Update the DB & Exchange
      if (newStatus !== trade.status || newStopLoss !== trade.stop_loss || newTakeProfit !== trade.take_profit || newRationale !== trade.rationale) {
        
        // ❌ FIX: Live Exchange Trailing Stop Execution
        if (tradeMode === 'MICRO' && newStopLoss !== trade.stop_loss && newStatus === trade.status) {
          try {
            const side = (trade.position_type === 'BUY' || trade.position_type === 'LONG') ? 'sell' : 'buy';
            // Create NEW trailing stop-loss FIRST
            const newSLOrder = await exchange.createOrder(symbol, 'market', side, contracts, undefined, { triggerPrice: newStopLoss, reduceOnly: true });
            
            // Cancel old stop-loss only if creation succeeded
            const openOrders = await exchange.fetchOpenOrders(symbol);
            for (const o of openOrders) {
               if (o.id && o.id !== newSLOrder.id) await exchange.cancelOrder(o.id, symbol);
            }
            console.log(`[Manage Trades] Trailed Stop Loss for ${trade.symbol} to ${newStopLoss}`);
          } catch (err) {
            console.error(`[Manage Trades] Failed to trail Hyperliquid order for ${trade.symbol}`, err);
          }
        }

        updates.push(
          supabase
            .from('paper_trades')
            .update({
              status: newStatus,
              stop_loss: newStopLoss,
              take_profit: newTakeProfit,
              rationale: newRationale,
              pnl: pnl,
              closed_at: closedAt
            })
            .eq('id', trade.id)
        );
      }
    }

    await Promise.all(updates);
    
    if (newTradesToInsert.length > 0) {
      const { error: insertError } = await supabase.from('paper_trades').insert(newTradesToInsert);
      if (insertError) {
        console.error("[Manage Trades] Failed to insert Pyramiding trades:", insertError);
      } else {
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (chatId) {
          const msg = `🔥 **هرم‌سازی نامتقارن (Asymmetric Scale-In)** 🔥\n\n` + 
            `سیستم وارد فاز هرم‌سازی شد و پوزیشن جدیدی با استفاده از سود بازنشده (Unrealized PnL) باز کرد!\n` +
            `تعداد پوزیشن‌های هرمیِ باز شده: ${newTradesToInsert.length}\n` +
            `سیستم تمام ریسک اولیه را صفر کرد و در حالِ بلعیدنِ روند با سود خودش است! 🚀`;
          await sendTelegramMessage(chatId, msg);
        }
      }
    }

    return NextResponse.json({ 
      message: `Managed ${openTrades.length} trades. Updated ${updates.length}. Pyramided ${newTradesToInsert.length}.` 
    });
  } catch (error: any) {
    console.error('[Manage Trades Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

