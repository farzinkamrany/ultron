import ccxt from 'ccxt';
import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateDownwardGannAngles, calculateAnniversaryCycles, calculateCosmicAlignment, calculateSquareOf144 } from './gann';
import { findFairValueGaps, findOrderBlocks, OHLCV as IctOHLCV } from './ict';
import { calculateChaosLevel, MacroOHLCV } from './chaos';
import { calculatePointOfControl } from './volumeProfile';
import { analyzeOrderBook, OrderBookData } from './orderbook';
import { analyzeOrderFlow, Trade } from './tape';
import { analyzeDerivatives } from './derivatives';

export interface MarketState {
  asset: string;
  price: number;
  timeframeLabel: string;
  liveBalance: number;
  riskAmount: number;
  defcon: { level: string | number; description: string; } | null;
  orderBook: { imbalanceRatio: number; whaleBuyWallPrice: number; whaleSellWallPrice: number; } | null;
  tape: { cvd: number; aggression: string; } | null;
  derivatives: { fundingRate: number; openInterest: number; sentiment: string; } | null;
  gann: { supports: number[]; resistances: number[]; };
  timeGeometry: { daysSinceMacroBottom: number; isReversalWindow: boolean; isVolumeClimax: boolean; isDeathZoneApex: boolean; resistances144: number[]; priceDegree: number; alignment: string; } | null;
  liquidity: { vwap: number; trend: string; nearestBullOB: string; nearestBearOB: string; untested4hFvgsCount: number; macroPoc: number | null; } | null;
}

export async function analyzeMarketData(asset: string, timeHorizonDays: number, includeLiquidation: boolean = false): Promise<MarketState> {
  try {
    const exchange = new ccxt.bybit({
      apiKey: process.env.BYBIT_API_KEY || "",
      secret: process.env.BYBIT_SECRET || "",
      enableRateLimit: true,
      options: { defaultType: 'swap' }
    });

    let liveBalance = 1000; // Fallback‍
    try {
      if (exchange.walletAddress) {
        const balance = await exchange.fetchBalance();
        if (balance['USDC'] && balance['USDC'].free) {
          liveBalance = balance['USDC'].free;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch live balance, using default 1000:", err);
    }
    const riskAmount = liveBalance * 0.016; // Samurai Protocol V3: strict 1.6% Kelly risk

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

    let liquidityData: MarketState['liquidity'] = null;
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

      liquidityData = {
        vwap,
        trend: vwapStatus,
        nearestBullOB,
        nearestBearOB,
        untested4hFvgsCount: fvgs.length,
        macroPoc: null
      };
    } catch (err) {
      console.warn("Failed to fetch SMC data", err);
    }

    let orderBookData: MarketState['orderBook'] = null;
    let tapeData: MarketState['tape'] = null;
    try {
      // HFT UPGRADE: Use WebSockets for Live Tape & Orderbook (Bypassing REST delay)
      const wsExchange = new ccxt.pro.bybit({
        apiKey: process.env.BYBIT_API_KEY || "",
        secret: process.env.BYBIT_SECRET || "",
        enableRateLimit: true,
        options: { defaultType: 'swap' }
      });
      wsExchange.setSandboxMode(true); // ENABLE TESTNET (Change to false to go live)

      const rawOrderBook = await wsExchange.watchOrderBook(asset, 100);
      const obData: OrderBookData = {
        bids: rawOrderBook.bids as [number, number][],
        asks: rawOrderBook.asks as [number, number][]
      };
      const xray = analyzeOrderBook(obData);

      orderBookData = {
        imbalanceRatio: xray.imbalanceRatio,
        whaleBuyWallPrice: xray.whaleBuyWallPrice,
        whaleSellWallPrice: xray.whaleSellWallPrice
      };

      // Stream live tape for aggressive spoofing detection
      let recentTradesRaw = await wsExchange.watchTrades(asset, undefined, 500);
      await new Promise(resolve => setTimeout(resolve, 800)); // Listen to tape for ~1 second
      recentTradesRaw = await wsExchange.watchTrades(asset, undefined, 500); // Fetch latest buffer

      // Close WS connection cleanly so Vercel Serverless Function can exit
      await wsExchange.close();

      const trades: Trade[] = recentTradesRaw.map((t: any) => ({
        side: t.side || 'unknown',
        price: t.price || 0,
        amount: t.amount || 0,
        timestamp: t.timestamp || 0
      }));

      const tape = analyzeOrderFlow(trades);
      tapeData = {
        cvd: tape.cvd,
        aggression: tape.cvdStatus
      };

    } catch (err) {
      console.warn("Failed to fetch order book or trades via WebSocket", err);
    }

    // --- DERIVATIVES (FUTURES) ---
    let derivsData: MarketState['derivatives'] = null;
    if (includeLiquidation) {
      try {
        const derivs = await analyzeDerivatives(asset);
        derivsData = {
          fundingRate: derivs.fundingRate,
          openInterest: derivs.openInterest,
          sentiment: derivs.sentiment
        };
      } catch (err) {
        console.warn("Failed to fetch derivatives data", err);
      }
    }

    let timeGeometryData: MarketState['timeGeometry'] = null;
    let defconData: MarketState['defcon'] = null;
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
      defconData = {
        level: chaos.level,
        description: chaos.description
      };

      const macroPOC = calculatePointOfControl(macroOhlcv);
      if (liquidityData) {
        liquidityData.macroPoc = macroPOC;
      }

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

      timeGeometryData = {
        daysSinceMacroBottom: daysSincePivot,
        isReversalWindow: isReversalWindow,
        isVolumeClimax: isVolumeClimax,
        isDeathZoneApex: isApexZone,
        resistances144: macro144.majorResistances,
        priceDegree: cosmos.priceDegree,
        alignment: cosmos.alignmentString
      };
    } catch (err) {
      console.warn("Failed to fetch macro history", err);
    }

    return Object.freeze({
      asset,
      price: currentPrice,
      timeframeLabel: label,
      liveBalance,
      riskAmount,
      defcon: defconData,
      orderBook: orderBookData,
      tape: tapeData,
      derivatives: derivsData,
      gann: {
        supports: supports.slice(0, 3),
        resistances: resistances.slice(0, 3)
      },
      timeGeometry: timeGeometryData,
      liquidity: liquidityData
    });
  } catch (error: any) {
    throw new Error(`Failed to analyze ${asset}: ${error.message}`);
  }
}

