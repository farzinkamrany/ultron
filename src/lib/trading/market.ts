import ccxt from 'ccxt';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateDownwardGannAngles, calculateAnniversaryCycles, calculateCosmicAlignment, calculateSquareOf144 } from './gann';
import { findFairValueGaps, findOrderBlocks, OHLCV as IctOHLCV } from './ict';
import { calculateChaosLevel, MacroOHLCV } from './chaos';
import { calculatePointOfControl } from './volumeProfile';
import { analyzeOrderBook, OrderBookData } from './orderbook';
import { analyzeOrderFlow, Trade } from './tape';
import { analyzeDerivatives } from './derivatives';

const PROXY_LIST = [
  'http://185.166.219.14:8080',
  'http://193.176.241.13:3128',
  'http://46.224.23.10:8080'
];

function getProxy() {
  return PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
}

export async function analyzeMarketData(asset: string, timeHorizonDays: number, includeLiquidation: boolean = false): Promise<string> {
  try {
    const proxyUrl = getProxy() || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    const exchangeOpts: any = { 
      enableRateLimit: true,
      options: {
        defaultType: 'spot'
      }
    };
    if (proxyUrl) {
      exchangeOpts.agent = new HttpsProxyAgent(proxyUrl);
    }
    const exchange = new ccxt.binance(exchangeOpts);

    let timeframe = '1d';
    let label = 'Daily';

    if (timeHorizonDays <= 7) {
      timeframe = '4h';
      label = '4-Hour';
    } else if (timeHorizonDays <= 60) {
      timeframe = '1d';
      label = 'Daily';
    } else {
      timeframe = '1w';
      label = 'Weekly';
    }

    const ohlcv = await exchange.fetchOHLCV(asset, timeframe, undefined, 15);
    const closes = ohlcv.map(candle => candle[4]);
    const currentPrice = closes[closes.length - 1] as number;

    const trendStr = closes.map(c => `$${c}`).join(" -> ");

    const { supports, resistances } = calculateGannSquareOf9(currentPrice);

    const recentVols = ohlcv.map(candle => candle[5] as number);
    const currentVol = recentVols[recentVols.length - 1];
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const isVolumeClimax = currentVol > (avgVol * 2.0);

    let smcAnalysisStr = "SMC Data Unavailable";
    try {
      const ohlcv4hRaw = await exchange.fetchOHLCV(asset, '4h', undefined, 50);
      const ohlcv4h: IctOHLCV[] = ohlcv4hRaw.map(c => ({
        timestamp: c[0] as number,
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number
      }));

      const fvgs = findFairValueGaps(ohlcv4h);
      const obs = findOrderBlocks(ohlcv4h);

      let cumulativeVolume = 0;
      let cumulativeVP = 0;
      ohlcv4h.forEach(c => {
        const typicalPrice = (c.high + c.low + c.close) / 3;
        cumulativeVolume += c.volume;
        cumulativeVP += typicalPrice * c.volume;
      });
      const vwap = cumulativeVolume > 0 ? cumulativeVP / cumulativeVolume : currentPrice;
      const vwapStatus = currentPrice > vwap ? "BULLISH (Above VWAP)" : "BEARISH (Below VWAP)";

      const bullishOBs = obs.filter(ob => ob.type === 'BULLISH_OB' && ob.top < currentPrice).sort((a, b) => b.top - a.top);
      const bearishOBs = obs.filter(ob => ob.type === 'BEARISH_OB' && ob.bottom > currentPrice).sort((a, b) => a.bottom - b.bottom);

      const nearestBullOB = bullishOBs.length > 0 ? `$${bullishOBs[0].top.toFixed(2)} - $${bullishOBs[0].bottom.toFixed(2)}` : "None nearby";
      const nearestBearOB = bearishOBs.length > 0 ? `$${bearishOBs[0].bottom.toFixed(2)} - $${bearishOBs[0].top.toFixed(2)}` : "None nearby";

      smcAnalysisStr = `Institutional VWAP: $${vwap.toFixed(2)} | Trend: ${vwapStatus}
Nearest Bullish OB: ${nearestBullOB}
Nearest Bearish OB: ${nearestBearOB}
Total Untested 4H FVGs: ${fvgs.length}`;
    } catch (err) {
      console.warn("Failed to fetch SMC data", err);
    }

    let xrayAnalysisStr = "Order Book X-Ray Unavailable";
    let tapeAnalysisStr = "Order Flow Tape Unavailable";
    try {
      const orderBookRaw = await exchange.fetchOrderBook(asset, 100);
      const obData: OrderBookData = {
        bids: orderBookRaw.bids as [number, number][],
        asks: orderBookRaw.asks as [number, number][]
      };
      const xray = analyzeOrderBook(obData);

      xrayAnalysisStr = `Order Book Imbalance (Bids/Asks): ${xray.imbalanceRatio.toFixed(2)}x
Whale Buy Wall: $${xray.whaleBuyWallPrice.toFixed(2)}
Whale Sell Wall: $${xray.whaleSellWallPrice.toFixed(2)}`;

      const recentTradesRaw = await exchange.fetchTrades(asset, undefined, 500);
      const trades: Trade[] = recentTradesRaw.map(t => ({
        side: t.side || 'unknown',
        price: t.price || 0,
        amount: t.amount || 0,
        timestamp: t.timestamp || 0
      }));

      const tape = analyzeOrderFlow(trades);
      tapeAnalysisStr = `CVD: $${Math.floor(tape.cvd).toLocaleString()}
Aggression: ${tape.cvdStatus}`;

    } catch (err) {
      console.warn("Failed to fetch order book or trades", err);
    }

    // --- DERIVATIVES (FUTURES) ---
    let derivsStr = "Liquidation/Derivatives module is disabled. Activate by mentioning 'Liquidation' or 'لیکوید'.";
    if (includeLiquidation) {
      const derivs = await analyzeDerivatives(asset);
      derivsStr = `Funding Rate: ${(derivs.fundingRate * 100).toFixed(4)}%
Open Interest: ${derivs.openInterest.toLocaleString()}
Sentiment: ${derivs.sentiment}`;
    }

    let timeAnalysisStr = "Time Cycle Data Unavailable";
    let defconStatusStr = "DEFCON Status Unavailable";
    try {
      const macroOhlcvRaw = await exchange.fetchOHLCV(asset, '1d', undefined, 365);
      const macroOhlcv: MacroOHLCV[] = macroOhlcvRaw.map(c => ({
        timestamp: c[0] as number,
        open: c[1] as number,
        high: c[2] as number,
        low: c[3] as number,
        close: c[4] as number,
        volume: c[5] as number
      }));

      const chaos = calculateChaosLevel(macroOhlcv);
      defconStatusStr = `Current Chaos Level: ${chaos.level}
Description: ${chaos.description}`;

      const macroPOC = calculatePointOfControl(macroOhlcv);
      smcAnalysisStr += `\
Macro POC (Gravity Magnet): $${macroPOC?.toFixed(2)}`;

      let absoluteLow = Infinity;
      let absoluteHigh = -Infinity;
      let pivotTimestamp = 0;
      let highTimestamp = 0;

      for (const candle of macroOhlcv) {
        if (candle.low < absoluteLow) { absoluteLow = candle.low; pivotTimestamp = candle.timestamp; }
        if (candle.high > absoluteHigh) { absoluteHigh = candle.high; highTimestamp = candle.timestamp; }
      }

      const trueScaleFactor = (absoluteHigh - absoluteLow) / 365;
      const daysSincePivot = Math.floor((Date.now() - pivotTimestamp) / (1000 * 60 * 60 * 24));
      const daysSinceHigh = Math.floor((Date.now() - highTimestamp) / (1000 * 60 * 60 * 24));

      const { isReversalWindow } = calculateTimeCycles(daysSincePivot);
      const upwardAngles = calculateGannAngles(absoluteLow, daysSincePivot, currentPrice, trueScaleFactor);
      const downwardAngles = calculateDownwardGannAngles(absoluteHigh, daysSinceHigh, currentPrice, trueScaleFactor);

      const isApexZone = Math.abs(upwardAngles.angle1x1 - downwardAngles.angle1x1) / currentPrice < 0.05;
      const macro144 = calculateSquareOf144(absoluteLow, trueScaleFactor);
      const cosmos = calculateCosmicAlignment(currentPrice);

      timeAnalysisStr = `Days Since Macro Bottom: ${daysSincePivot}
IS REVERSAL WINDOW: ${isReversalWindow ? "YES" : "NO"}
VOLUME CLIMAX: ${isVolumeClimax ? "YES" : "NO"}

IS DEATH ZONE APEX: ${isApexZone ? "YES - CRITICAL SQUEEZE" : "NO"}

144-Block Resistances: ${macro144.majorResistances.map(r => `$${r.toFixed(0)}`).join(" | ")}

Price Degree: ${cosmos.priceDegree.toFixed(2)}°
Alignment: ${cosmos.alignmentString}`;
    } catch (err) {
      console.warn("Failed to fetch macro history", err);
    }

    return `
[DYNAMIC MARKET ANALYSIS - ${asset}]
Price: $${currentPrice.toFixed(2)}
Timeframe: ${label}

[DEFCON PROTOCOL]
${defconStatusStr}

[X-RAY & TAPE]
${xrayAnalysisStr}
${tapeAnalysisStr}

[SQUEEZE ZONES]
${derivsStr}

[GANN SUPPORTS/RESISTANCES]
Supports: ${supports.slice(0, 3).map(s => `$${s.toFixed(2)}`).join(" | ")}
Resistances: ${resistances.slice(0, 3).map(r => `$${r.toFixed(2)}`).join(" | ")}

[TIME SQUARING & GEOMETRY]
${timeAnalysisStr}

[LIQUIDITY]
${smcAnalysisStr}
`;
  } catch (error: any) {
    return `Failed to analyze ${asset}: ${error.message}`;
  }
}
