import fs from 'fs';
import path from 'path';

export interface PaperTrade {
  action: 'BUY' | 'SELL';
  entryPrice: number;
  tp: number;
  sl: number;
  initialSl: number;
  pyramidStage: number;
  riskAmount: number;
  openTimestamp: number;
}

export interface PaperState {
  balance: number;
  peakBalance: number;
  maxDrawdown: number;
  totalTrades: number;
  wins: number;
  activeTrade: PaperTrade | null;
  tradeHistory: any[];
}

const STATE_FILE = path.join(process.cwd(), 'data', 'paper_state.json');

export function loadPaperState(): PaperState {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(data) as PaperState;
    } catch (err) {
      console.error('Error loading paper state, returning default.', err);
    }
  }

  // Initial State if file doesn't exist
  return {
    balance: 1000,
    peakBalance: 1000,
    maxDrawdown: 0,
    totalTrades: 0,
    wins: 0,
    activeTrade: null,
    tradeHistory: []
  };
}

export function savePaperState(state: PaperState): void {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving paper state:', err);
  }
}
