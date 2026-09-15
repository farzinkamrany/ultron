import 'dotenv/config';
import ccxt from 'ccxt';
import { processLeviathanSymbol } from '../src/lib/trading/leviathan_hunter';
import { supabase } from '../src/lib/supabase';
import { sendTelegramMessage } from '../src/lib/telegram';

const BEAST_MODE_SYMBOLS = [
    'BTC/USDC:USDC', 'ETH/USDC:USDC', 'SOL/USDC:USDC', 
    'LINK/USDC:USDC', 'ADA/USDC:USDC', 'BNB/USDC:USDC', 
    'XRP/USDC:USDC', 'DOGE/USDC:USDC', 'AVAX/USDC:USDC', 'DOT/USDC:USDC'
];

async function main() {
    console.log("🚀 ULTRON DAEMON STARTED (Leviathan 4H Mode)");
    const exchange = new ccxt.pro.hyperliquid({ enableRateLimit: true });
    const chatId = process.env.TELEGRAM_CHAT_ID;

    await Promise.all(BEAST_MODE_SYMBOLS.map(async (symbol) => {
        let lastCandleTimestamp = 0;

        while (true) {
            try {
                // watchOHLCV for 4h directly. 
                // Candles close at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
                const ohlcv = await exchange.watchOHLCV(symbol, '4h');
                const latestCandle = ohlcv[ohlcv.length - 1];
                if (!latestCandle) continue;
                
                const currentTimestamp = latestCandle[0] as number;

                if (lastCandleTimestamp !== 0 && currentTimestamp > lastCandleTimestamp) {
                    console.log(`[Daemon] 🔔 4H Candle Closed for ${symbol}. Leviathan is waking up...`);
                    
                    const action = await processLeviathanSymbol(exchange, symbol);

                    if (action.type === 'ENTER_LONG' || action.type === 'ENTER_SHORT') {
                        console.log(`[Daemon] 🐉 LEVIATHAN ENTRY FOUND for ${symbol}! Executing...`);
                        
                        const { error: dbError } = await supabase.from('paper_trades').insert([{
                            symbol: symbol,
                            position_type: action.type === 'ENTER_LONG' ? 'LONG' : 'SHORT',
                            entry_price: action.entryPrice,
                            take_profit: null, // Leviathan rides the trend infinitely
                            stop_loss: action.stopLoss,
                            status: 'OPEN',
                            rationale: action.context
                        }]);

                        if (!dbError && chatId) {
                            const message = `🐉 **لوایاتان وارد عمل شد!** 🐉\n\n` +
                            `🪙 ارز: **${symbol}**\n` +
                            `📍 جهت: **${action.type === 'ENTER_LONG' ? 'LONG 🟢' : 'SHORT 🔴'}**\n` +
                            `💵 ورود: **$${action.entryPrice.toFixed(4)}**\n` +
                            `🛡 استاپ: **$${action.stopLoss.toFixed(4)}**\n\n` +
                            `📝 ${action.context}`;
                            await sendTelegramMessage(chatId, message);
                        }
                    } else if (action.type === 'UPDATE_SL') {
                        console.log(`[Daemon] 🛡️ Updating Trailing Stop for ${symbol} to ${action.newStopLoss}`);
                        
                        const { error: dbError } = await supabase
                            .from('paper_trades')
                            .update({ stop_loss: action.newStopLoss })
                            .eq('id', action.tradeId);
                            
                        if (!dbError && chatId) {
                            const message = `🛡 **استاپ‌لاس متحرک (Trailing Stop)** 🛡\n\n` +
                            `🪙 ارز: **${symbol}**\n` +
                            `📈 استاپ قبلی: $${action.oldStopLoss.toFixed(4)}\n` +
                            `🔥 استاپ جدید: **$${action.newStopLoss.toFixed(4)}**\n\n` +
                            `سود در حال قفل شدن است! 🔒`;
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
