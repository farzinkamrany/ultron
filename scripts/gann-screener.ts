import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { sendTelegramMessage } from '../src/lib/telegram';

const TOP_ALTCOINS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT',
  'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'MATIC/USDT', 'DOT/USDT',
  'DOGE/USDT', 'SHIB/USDT', 'LTC/USDT', 'ATOM/USDT', 'UNI/USDT',
  'NEAR/USDT', 'APT/USDT', 'INJ/USDT', 'OP/USDT', 'ARB/USDT',
  'TON/USDT', 'BCH/USDT', 'TRX/USDT', 'ICP/USDT', 'XLM/USDT',
  'FIL/USDT', 'RNDR/USDT', 'STX/USDT', 'MKR/USDT', 'VET/USDT',
  'GRT/USDT', 'THETA/USDT', 'AAVE/USDT', 'LDO/USDT', 'SNX/USDT',
  'CRV/USDT', 'SAND/USDT', 'MANA/USDT', 'AXS/USDT', 'GALA/USDT',
  'ALGO/USDT', 'EGLD/USDT', 'FTM/USDT', 'QNT/USDT', 'XTZ/USDT',
  'HBAR/USDT', 'EOS/USDT', 'ZEC/USDT', 'DASH/USDT', 'PEPE/USDT'
];

async function scanGann() {
  console.log("🚀 Starting Global Gann Screener (Top 50 Assets)...");
  const exchange = new ccxt.bybit({ enableRateLimit: true, options: { defaultType: 'spot' } });
  
  const tickers = await exchange.fetchTickers(TOP_ALTCOINS);
  const recommendations: any[] = [];
  
  const TOLERANCE = 0.005; // 0.5% buffer

  for (const asset of TOP_ALTCOINS) {
    const ticker = tickers[asset];
    if (!ticker) continue;
    
    const currentPrice = ticker.last || 0;
    if (currentPrice === 0) continue;
    
    const { supports, resistances } = calculateGannSquareOf9(currentPrice);
    
    let closestSupport = 0;
    for (const s of supports) {
      if (currentPrice >= s) { closestSupport = s; break; }
    }
    
    let closestResistance = Infinity;
    for (const r of resistances) {
      if (r >= currentPrice) { closestResistance = r; break; }
    }
    
    if (closestSupport === 0 || closestResistance === Infinity) continue;
    
    // Distances
    const distToSupportPerc = (currentPrice - closestSupport) / currentPrice;
    const distToResPerc = (closestResistance - currentPrice) / currentPrice;
    
    // RR Math
    const longRR = (closestResistance - currentPrice) / (currentPrice - closestSupport);
    const shortRR = (currentPrice - closestSupport) / (closestResistance - currentPrice);
    
    if (distToSupportPerc <= TOLERANCE && longRR > 1.5) {
      recommendations.push({
        asset,
        type: 'LONG 🟢',
        price: currentPrice.toFixed(4),
        stopLoss: closestSupport.toFixed(4),
        target: closestResistance.toFixed(4),
        rr: longRR.toFixed(2),
        distance: (distToSupportPerc * 100).toFixed(2) + '%'
      });
    } else if (distToResPerc <= TOLERANCE && shortRR > 1.5) {
      recommendations.push({
        asset,
        type: 'SHORT 🔴',
        price: currentPrice.toFixed(4),
        stopLoss: closestResistance.toFixed(4),
        target: closestSupport.toFixed(4),
        rr: shortRR.toFixed(2),
        distance: (distToResPerc * 100).toFixed(2) + '%'
      });
    }
  }
  
  recommendations.sort((a, b) => parseFloat(b.rr) - parseFloat(a.rr));
  
  console.log("\n🔥 TOP GANN RECOMMENDATIONS RIGHT NOW:");
  const top10 = recommendations.slice(0, 10);
  console.table(top10);

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (chatId && top10.length > 0) {
    let msg = `🔥 **گزارش زنده: اسکنر گَن (Gann Square of 9)** 🔥\n\n`;
    for (const r of top10) {
      msg += `🪙 **${r.asset}** | ${r.type}\n`;
      msg += `💰 قیمت الان: ${r.price}\n`;
      msg += `🎯 تارگت: ${r.target}\n`;
      msg += `🛑 استاپ: ${r.stopLoss}\n`;
      msg += `⚖️ ریسک به ریوارد (R:R): ${r.rr}\n`;
      msg += `📏 فاصله تا حمایت/مقاومت: ${r.distance}\n\n`;
    }
    await sendTelegramMessage(chatId, msg);
    console.log("✅ Report sent to Telegram!");
  }
}

scanGann();
