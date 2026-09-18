# 🐉 Ultron Quant V5.0 - System Handoff & Architecture

This document serves as the master guide for **Ultron Quant V5.0**. Any developer or AI agent touching this codebase MUST read this document to understand the core mechanics, especially the 4H lock, the API execution flow, and the frontend integrations.

## 1. High-Level Architecture
Ultron V5.0 is an automated algorithmic trading engine deployed on Vercel, utilizing external services for scheduling, state management, and execution.

- **Orchestrator (`/api/cron/orchestrator/route.ts`)**: The central nervous system. It receives a POST request from **QStash** every 5 minutes.
- **State Management (Redis)**: Uses Upstash Redis to persist the state of each trading pair (`LiveSymbolState`). This includes active grid levels, cooldowns, and the timestamp of the last processed 4H candle.
- **Database (Supabase)**: Logs all trades, tracking PnL, `position_size_usd`, and the rationale.
- **Execution (CCXT + Hyperliquid)**: Communicates directly with the Hyperliquid DEX via the CCXT unified API to place market orders, stop losses, and take profits.

---

## 2. The Trading Engine (`ultron-engine.ts`)
The core logic resides here. It is built to mimic the exact behavior of the backtester that yielded $9.7M in simulated profits.

### 🛡️ The 4H Candle Lock (CRITICAL)
Trend strategies (Leviathan and Megalodon) operate strictly on **closed 4H candles**.
If the engine evaluated open candles, wicks would trigger false breakouts, destroying profitability.

**How it works:**
1. The engine tracks `state.lastProcessed4HCandleTime`.
2. When the cron runs, it checks: `candle.timestamp > state.lastProcessed4HCandleTime`.
3. If `true` (meaning a new 4H candle just started), the engine looks back at `candles4H[candles4H.length - 2]` (the fully closed candle).
4. All indicators (EMA, ATR, Highest/Lowest) are calculated using an offset of `1` or `2` to ensure they only reflect data *prior* to or including the closed candle.
5. After processing, `lastProcessed4HCandleTime` is updated. It won't look for new trend entries for another 4 hours.

### ⚔️ The Strategies
1. **Leviathan**: Pure trend follower. Uses Donchian Channels (20-period breakout) filtered by EMA200. Implements a 40% partial take-profit and an aggressive ATR trailing stop.
2. **Megalodon**: Macro trend follower. Uses EMA800 breakouts. Massive cooldown periods on loss to prevent getting chopped in ranges.
3. **Behemoth**: Grid scalper. Runs every 5 minutes. Calculates dynamic grid steps based on ATR. Only activates when the market is not in a strong trend.

### 💰 Dynamic Sizing
Fixed sizes are deprecated. The engine calculates `positionSizeUsd` dynamically:
- Calculates risk distance: `(Entry - SL) / Entry`
- Risks a fixed percentage of `accountBalance` (e.g., 5% for Leviathan).
- Formula: `Size = Risk Amount / Risk Distance`.
- Capped by `maxAllowedMargin` to prevent over-leveraging.

---

## 3. Execution Engine & CCXT Quirks (`route.ts`)
When the engine emits a `signal`, `route.ts` executes it.
**Critical Hyperliquid rules enforced:**
1. **Unified Symbols**: `BTC/USDT` is translated to `BTC/USDC:USDC`. Hyperliquid perpetuals strictly require this format in CCXT.
2. **Precision & Rate Limits**: `exchange.loadMarkets()` MUST be called before `createMarketOrder`. This allows CCXT to fetch the exchange's specific decimal precision rules and automatically truncate `amount` floats, preventing `Invalid Amount Precision` errors.
3. **Trailing Stop Execution**: When Leviathan hits a trailing stop during a 5-minute check, the orchestrator cancels all open SL/TP orders on the exchange and fires a Market order to close the position.

---

## 4. Frontend Dashboard (`page.tsx`)
A dark-mode, glassmorphic UI built to display institutional-grade metrics.
- **Colors**: Hardcoded to Dark Mode (`bg-[#050505]`, `text-white`) to prevent OS-level light-mode clashes.
- **Infinite Scroll**: Uses `IntersectionObserver` to load more trades gracefully without pagination buttons.
- **Dynamic Metrics**: The frontend parses the `[STRATEGY_NAME]` from the database `rationale` field to apply unique neon colors (Gold for Leviathan, Purple for Megalodon).
- **Position Sizes**: Displays `position_size_usd` prominently in the modal, pulled directly from Supabase.

---

## 5. Maintenance & Checklists
If modifying the engine in the future, adhere to these rules:
- **Never alter the offset logic** in `ultron-engine.ts` without backtesting first.
- Do not create secondary crons (e.g., `manage-trades`). The Orchestrator handles all lifecycle events.
- Ensure Supabase schema changes match the `PaperTrade` interface in `store/tradingStore.ts`.
