import { z } from 'zod';
import { TRADING_CONFIG } from './trading/config';

export const TradeSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'WAIT']),
  entryPrice: z.number().positive("Entry price must be positive.").nullable().describe("The exact entry price. Null if action is WAIT."),
  stopLoss: z.number().positive("Stop loss must be positive.").nullable().describe("The exact stop loss price. Null if action is WAIT."),
  projectedTarget: z.number().positive("Projected Target must be positive.").nullable().describe("The theoretical target for R:R calculation. Null if action is WAIT."),
  riskPercentage: z.number().max(1.6, "Risk strictly capped at 1.6% of Live Balance. Protocol V3 Kill-Switch Engaged.").nullable().describe("The exact percentage of the live balance being risked (e.g. 1.6)."),
  trailingStrategy: z.literal('SMC_OB').default('SMC_OB').describe("SMC Trailing Stop Loss strategy."),
  leverage: z.number().int().min(1).max(5, "Leverage CANNOT exceed 5x. Protocol V3 Kill-Switch Engaged.").default(1).describe("Leverage multiplier (1 to 5)."),
  confidenceScore: z.number().min(0).max(100).describe("Confidence score from 0 to 100."),
  reasoning: z.string().describe("Direct and concise explanation for the decision without any fluff.")
}).refine(data => {
  if (data.action !== 'WAIT') {
    if (data.entryPrice === null || data.stopLoss === null || data.projectedTarget === null) return false;
    
    // R:R Enforcer - BUY Position
    if (data.action === 'BUY') {
      if (data.stopLoss >= data.entryPrice || data.projectedTarget <= data.entryPrice) return false;
      const risk = data.entryPrice - data.stopLoss;
      const reward = data.projectedTarget - data.entryPrice;
      if (reward < 2 * risk) return false; // Reward MUST be at least 2x Risk
    }
    
    // R:R Enforcer - SELL Position
    if (data.action === 'SELL') {
      if (data.stopLoss <= data.entryPrice || data.projectedTarget >= data.entryPrice) return false;
      const risk = data.stopLoss - data.entryPrice;
      const reward = data.entryPrice - data.projectedTarget;
      if (reward < 2 * risk) return false; // Reward MUST be at least 2x Risk
    }
  }
  return true;
}, {
  message: "Invalid logic or R:R constraint. Must follow strict 1:2 R:R minimum (BUY: TP>Entry>SL, SELL: SL>Entry>TP).",
});

export type TradeDecision = z.infer<typeof TradeSchema>;

export const StatArbSchema = z.object({
  action: z.enum(['ENTER_ARBITRAGE', 'EXIT_ARBITRAGE', 'WAIT']),
  leg1: z.object({
    asset: z.string(),
    action: z.enum(['LONG', 'SHORT']),
    entryPrice: z.number().positive(),
    sizeUSD: z.number().positive().max(100000) // General max limit, engine enforces 2%
  }),
  leg2: z.object({
    asset: z.string(),
    action: z.enum(['LONG', 'SHORT']),
    entryPrice: z.number().positive(),
    sizeUSD: z.number().positive()
  }),
  zScore: z.number(),
  correlation: z.number().min(-1).max(1),
  reasoning: z.string()
}).refine(data => {
  if (data.action === 'WAIT') return true;
  
  // Rule 1: Actions must be perfectly hedged (Opposite directions)
  if (data.leg1.action === data.leg2.action) return false;
  
  // Rule 2: Delta-Neutral requires EXACT equal USD sizing for both legs
  if (Math.abs(data.leg1.sizeUSD - data.leg2.sizeUSD) > 0.01) return false;
  
  // Rule 3: Execution trigger threshold
  if (data.action === 'ENTER_ARBITRAGE') {
    if (Math.abs(data.zScore) < TRADING_CONFIG.Z_SCORE_THRESHOLD) return false;
  }
  
  return true;
}, {
  message: `Invalid Delta-Neutral Arbitrage: Legs must be perfectly hedged (opposite directions), have identical USD sizing, and Z-Score must cross +/- ${TRADING_CONFIG.Z_SCORE_THRESHOLD}.`
});

export type StatArbDecision = z.infer<typeof StatArbSchema>;
