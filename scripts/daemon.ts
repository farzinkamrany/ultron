import 'dotenv/config';
import ccxt from 'ccxt';
import { huntForSetup } from '../src/lib/trading/hunter';
import { supabase } from '../src/lib/supabase';
import { sendTelegramMessage } from '../src/lib/telegram';

const BEAST_MODE_SYMBOLS = [
    'BTC/USDC:USDC', 'ETH/USDC:USDC', 'SOL/USDC:USDC', 
    'LINK/USDC:USDC', 'ADA/USDC:USDC', 'BNB/USDC:USDC', 
    'XRP/USDC:USDC', 'DOGE/USDC:USDC', 'AVAX/USDC:USDC', 'DOT/USDC:USDC'
];

async function main() {
    console.log("🚀 ULTRON DAEMON STARTED (WebSocket Mode)");
    const exchange = new ccxt.pro.hyperliquid({ enableRateLimit: true });
    const chatId = process.env.TELEGRAM_CHAT_ID;

    await Promise.all(BEAST_MODE_SYMBOLS.map(async (symbol) => {
        let lastCandleTimestamp = 0;

        while (true) {
            try {
                // watchOHLCV returns an array of candles. The last element is the most recent.
                const ohlcv = await exchange.watchOHLCV(symbol, '15m');
                const latestCandle = ohlcv[ohlcv.length - 1];
                if (!latestCandle) continue;
                
                const currentTimestamp = latestCandle[0] as number;

                if (lastCandleTimestamp !== 0 && currentTimestamp > lastCandleTimestamp) {
                    console.log(`[Daemon] 🔔 15m Candle Closed for ${symbol}. Triggering Hunt...`);
                    
                    const { data: openTrades } = await supabase
                        .from('paper_trades')
                        .select('symbol')
                        .eq('status', 'OPEN');
                        
                    const openSymbols = openTrades?.map(t => t.symbol) || [];
                    
                    const tradeSetup = await huntForSetup(3.0, openSymbols);

                    if (tradeSetup && tradeSetup.symbol === symbol) {
                        console.log(`[Daemon] 🎯 SETUP FOUND for ${symbol}! Executing...`);
                        
                        const { error: dbError } = await supabase.from('paper_trades').insert([{
                            symbol: tradeSetup.symbol,
                            position_type: tradeSetup.action === 'BUY' ? 'LONG' : 'SHORT',
                            entry_price: tradeSetup.entryPrice,
                            take_profit: tradeSetup.targetPrice,
                            stop_loss: tradeSetup.stopLoss,
                            status: 'OPEN',
                            rationale: tradeSetup.execution_context
                        }]);

                        if (!dbError && chatId) {
                            const message = `⚡️ **شکار زنده با WebSocket** ⚡️\n\n` +
                            `🪙 ارز: **${tradeSetup.symbol}**\n` +
                            `📍 جهت: **${tradeSetup.action}**\n` +
                            `💵 ورود: **$${tradeSetup.entryPrice.toFixed(4)}**\n` +
                            `🚀 تاخیر: **زیر ۵ میلی‌ثانیه**\n\n`;
                            await sendTelegramMessage(chatId, message);
                        }
                    }
                }
                
                lastCandleTimestamp = currentTimestamp;

            } catch (e: any) {
                console.error(`[Daemon] WebSocket error for ${symbol}:`, e.message);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }));
}

main().catch(console.error);
