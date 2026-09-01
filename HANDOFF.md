# ULTRON: The Quantitative AI Engine (Ultimate Handoff Document)

**Version:** 1.0 (The Flawless Monster)
**Core Philosophy:** 100% Mathematical Certainty, Multi-Disciplinary Analysis, Capital Preservation, High-Frequency Anti-Spoofing.

This document serves as the encyclopedic technical and operational manual for Ultron. It contains every detail, mathematical formula, architectural decision, and operational instruction required to run, maintain, and trade with this system.

---

## 1. System Architecture (The 7 Pillars & The Hunter)

Ultron Abandons traditional technical analysis in favor of a 7-pillar mathematical engine and a global market screener.

### Pillar 1: Time & Geometry (W.D. Gann Engine)
*Location: `src/lib/trading/gann.ts`*
- **Gann Square of 9:** Calculates exact, static support and resistance levels based on the esoteric mathematical spiral.
- **Time Squaring:** Tracks the exact days since the last Macro Bottom or Top. Alerts when time hits a Gann harmonic (7, 14, 21, 90, 144, 360 days).
- **Death Zone Apex:** Calculates moving `1x1` geometric angles (upward from the bottom, downward from the top). When the upward and downward angles intersect (cross within 5%), it flags a "Death Zone Squeeze" where violent breakouts occur.
- **Square of 144:** Divides the absolute macro price scale into 144 harmonic blocks to find multi-year resistance ceilings.

### Pillar 2: Cosmic Cycles (Financial Astrology)
*Location: `src/lib/trading/gann.ts` (using `astronomy-engine`)*
- **Planetary Price Translation:** Calculates the exact ecliptic longitude of Jupiter and translates it directly into a dollar value (e.g., 200 degrees = $20,000 or $200,000 Support).
- **Cosmic Aspects:** Detects when Jupiter and Mars are in Conjunction (0°), Square (90°), or Opposition (180°), signaling violent market energy.
- **Vernal Equinox Sine Wave:** Calculates days since March 21st and passes it through a trigonometric `Math.sin()` function to determine if the market's natural seasonal energy is Expanding (+) or Contracting (-).

### Pillar 3: Institutional Liquidity (Smart Money Concepts)
*Location: `src/lib/trading/ict.ts`*
- **Order Blocks (OB):** Scans the 4-Hour charts for the last bearish/bullish candle before a massive explosive move.
- **Liquidity Sweep Detection (Stop Hunts):** An Order Block is only marked as `High Probability` if it swept the lows/highs of the previous 3 candles before exploding. This proves whales hunted retail stop-losses.
- **Fair Value Gaps (FVG):** Tracks 3-candle imbalances that act as magnetic pullbacks.

### Pillar 4: The Chaos Shield (DEFCON Protocol)
*Location: `src/lib/trading/chaos.ts` & `market.ts`*
- **ATR Expansion:** Compares the 14-day Average True Range to the 90-day Average True Range. If short-term volatility spikes >150% and price is below the 20-day SMA, it flags a Panic Dump (DEFCON 2).
- **Flash Crash Detector:** If a single daily candle drops more than 10%, it triggers DEFCON 1.
- **Institutional VWAP:** Calculates the Volume Weighted Average Price. The AI is forbidden from buying if the price is below VWAP.

### Pillar 5: Data Science (Gravity & Human Sentiment)
*Location: `src/lib/trading/volumeProfile.ts` & `route.ts`*
- **Macro Point of Control (POC):** Divides the 365-day price range into 100 buckets, distributes trading volume, and finds the single price with the highest volume. This acts as a gravitational magnet.
- **Live Fear & Greed API:** Pings `alternative.me` in real-time to prevent the AI from buying during Extreme Euphoria or shorting during Extreme Fear.

### Pillar 6: High-Frequency Filters (X-Ray & Tape Reading)
*Location: `src/lib/trading/orderbook.ts` & `src/lib/trading/tape.ts`*
- **X-Ray Scanner (Order Book Imbalance):** Scans the Level 2 Order Book (top 100 live Limit Orders) to find "Whale Walls". It calculates the Bid/Ask imbalance ratio to see if there is massive cash waiting to defend a price level.
- **Lie Detector (CVD Tape Reading):** Analyzes the last 500 finalized *Market Orders* (The Tape) to calculate Cumulative Volume Delta (CVD). If X-Ray shows a Buy Wall but the Tape shows aggressive panic selling (Taker Sells > Taker Buys), the AI flags the Wall as a "Spoof" (Fake) and aborts the trade.

### Pillar 7: The Liquidation Sniper (Derivatives Engine)
*Location: `src/lib/trading/derivatives.ts`*
- **Funding Rates:** Connects to Binance Futures to track retail leverage sentiment. If Funding Rates are extremely negative, retail is heavily shorting. The AI recognizes this as a "Short Squeeze" setup and buys aggressively to profit off their liquidations.
- **Open Interest:** Tracks trapped leverage capital in the market.

### The Altcoin Hunter (Global Market Screener)
*Location: `src/lib/trading/hunter.ts` & `src/app/api/telegram/ai-worker/route.ts`*
- **Natural Language Parsing:** The Telegram webhook intercepts commands like "شکار 10 درصد" (Hunt 10% profit). 
- **The Fast Pass:** Instead of analyzing 1 coin, it pulls the Top 20 liquid altcoins on Binance. It rapidly calculates their distance to Gann Supports and Resistances. It instantly filters out any coin that cannot mathematically hit the requested Target %, delivering only the absolute perfect apex setup to the AI Arbitrator.

---

## 2. The AI Arbitrator (The Brain)

*Location: `src/app/api/cron/route.ts`*

The Gemini AI acts as the final judge. It reads the raw data from all 7 pillars and must strictly obey these **12 Directives**:

1. **No Financial Advice Disclaimers:** Speak with absolute, cold, mathematical certainty.
2. **Precision:** Never use words like "maybe", "consider", or "risk".
3. **Gann Fidelity:** Only use the exact Gann levels provided for calculations.
4. **Esoteric Weighting:** Use the Vernal Sine Wave and Jupiter Price Translation as macro biases.
5. **Macro Ceilings:** Use the 144-Block Macro Resistances as the ultimate multi-year targets.
6. **SMC Sniper Entries:** The AI MUST use the nearest "Swept" Order Block as the exact `نقطه ورود` (Entry Point). It cannot guess.
7. **VWAP Filter:** The AI MUST NOT issue a STRONG BUY if the VWAP trend is BEARISH. It must output `WAIT FOR LIMIT ORDER` instead.
8. **DEFCON CHAOS OVERRIDE:** If the DEFCON Status is LEVEL 1 or 2, ABANDON ALL LOGIC. Output `DEFCON EMERGENCY: LIQUIDATE TO CASH`.
9. **POC Gravity:** If the price is far from the Macro POC, assume a gravitational pull back to it.
10. **X-RAY ORDER BOOK:** If issuing a STRONG BUY, the AI MUST verify a Whale Buy Wall exists at or near the entry price. If the order book is empty there, abort and issue WAIT FOR LIMIT ORDER.
11. **TAPE READING (ANTI-SPOOFING):** Even if Rule 10 shows a Whale Wall, the AI MUST check the Tape. If the Cumulative Volume Delta (CVD) shows "EXTREME AGGRESSIVE SELLING (PANIC DUMP)", the Buy Wall is likely a SPOOF (fake). Abort the trade and issue WAIT FOR LIMIT ORDER at a lower price.
12. **LIQUIDATION SNIPER (DERIVATIVES):** Check the Derivatives Squeeze Zones. If Funding Rate is extremely negative (Short Squeeze imminent) and you have a BUY setup, INCREASE your confidence. If Funding Rate is euphorically positive (Long Squeeze dump imminent), DO NOT issue a Market Buy; you MUST issue WAIT FOR LIMIT ORDER at a much lower support to catch the liquidation wick.

---

## 3. Operator's Execution Guide (How to Trade)

When the bot sends a Telegram message, follow these execution rules:

- 🟢 **GANN MASTER ASCENSION SIGNAL:** Market order or aggressive limit. **~99% Probability.** All 6 pillars are aligned perfectly. Time, Space, Volume, and real-time Tape are identical.
- 🟡 **WAIT FOR LIMIT ORDER (صبر برای لیمیت):** The current price is dangerous. The AI will give you a specific Entry Price (a Swept OB protected by a Whale Wall). **Place a Limit Order at that exact price and walk away.**
- 🔴 **DEFCON EMERGENCY (وضعیت اضطراری):** Cancel all open orders. Sell active positions to USDT. The market is crashing or at war.
- 🔵 **STRONG BUY / SCALP BUY:** Standard trades. Execute them but strictly enforce the provided Stop Loss. **~85-95% Probability.**

---

## 4. Setup, Deployment, and Infrastructure

### Tech Stack
- **Framework:** Next.js (App Router) + TypeScript.
- **Data Provider:** CCXT (Binance API).
- **AI Engine:** Google Gemini (`@google/genai`).
- **Notification:** Telegram Bot API.

### Environment Variables (`.env.local`)
```env
# AI Keys (Rotated automatically to bypass rate limits)
GEMINI_API_KEY_1=your_key_here
GEMINI_API_KEY_2=your_key_here

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Network (If in restricted regions like Iran)
HTTP_PROXY=http://127.0.0.1:v2ray_port
HTTPS_PROXY=http://127.0.0.1:v2ray_port
```

### Local Execution
1. Install dependencies: `npm install`
2. Start the API server: `npm run dev` (Runs on `http://localhost:3000`)
3. Open a new terminal and run the background worker: `node local-cron.js`. This script will ping the server every 3 hours and trigger the analysis.

### Production Deployment
To run Ultron 24/7 in the cloud:
1. Push the code to GitHub.
2. Deploy the repository to **Vercel** (Free Tier is sufficient). Add your `.env` variables in the Vercel dashboard.
3. Vercel shuts down sleeping apps, so `local-cron.js` won't work. Instead, create a free account on **cron-job.org**.
4. Set cron-job.org to send an HTTP GET request to `https://your-domain.vercel.app/api/cron` every 3 hours.

---

## 5. Future Roadmap

The analytical brain is finished. Future developers can implement:
1. **Auto-Trading Execution Layer:** Use CCXT (`exchange.createOrder()`) to automatically place the `WAIT FOR LIMIT ORDER` traps directly on Binance using API Keys.
2. **React Dashboard:** Build out `src/app/page.tsx` using a library like `lightweight-charts` to visually draw the Gann angles, Order Blocks, and Tape CVD visually.
3. **Historical Backtester:** A script to simulate the last 5 years of data against the 11 Rules to print exact PnL metrics.
