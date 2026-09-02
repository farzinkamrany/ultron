import { z } from 'zod';

export const TradeSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'WAIT']),
  entryPrice: z.number().positive("Entry price must be positive.").nullable().describe("The exact entry price. Null if action is WAIT."),
  stopLoss: z.number().positive("Stop loss must be positive.").nullable().describe("The exact stop loss price. Null if action is WAIT."),
  takeProfit: z.number().positive("Take profit must be positive.").nullable().describe("The exact take profit price. Null if action is WAIT."),
  leverage: z.number().int().min(1).max(5, "Leverage CANNOT exceed 5x. Protocol V3 Kill-Switch Engaged.").default(1).describe("Leverage multiplier (1 to 5)."),
  confidenceScore: z.number().min(0).max(100).describe("Confidence score from 0 to 100."),
  reasoning: z.string().describe("Direct and concise explanation for the decision without any fluff.")
}).refine(data => {
  if (data.action !== 'WAIT') {
    if (data.entryPrice === null || data.stopLoss === null || data.takeProfit === null) return false;
    
    if (data.action === 'BUY') {
      if (data.stopLoss >= data.entryPrice || data.takeProfit <= data.entryPrice) return false;
      const risk = data.entryPrice - data.stopLoss;
      const reward = data.takeProfit - data.entryPrice;
      if (reward < 2 * risk) return false;
    }
    
    if (data.action === 'SELL') {
      if (data.stopLoss <= data.entryPrice || data.takeProfit >= data.entryPrice) return false;
      const risk = data.stopLoss - data.entryPrice;
      const reward = data.entryPrice - data.takeProfit;
      if (reward < 2 * risk) return false;
    }
  }
  return true;
}, {
  message: "Invalid logic or R:R constraint. Must follow strict 1:2 R:R minimum (BUY: TP>Entry>SL, SELL: SL>Entry>TP).",
});

export type TradeDecision = z.infer<typeof TradeSchema>;
