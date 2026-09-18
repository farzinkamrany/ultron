import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';

interface OrderBookData {
  bids: [string, string][]; // [price, amount]
  asks: [string, string][]; // [price, amount]
  lastPrice: string;
  spread: string;
  isConnected: boolean;
}

interface PaperTrade {
  id: string;
  symbol: string;
  position_type: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  status: 'OPEN' | 'WON' | 'LOST';
  pnl: number;
  created_at: string;
  closed_at: string | null;
  rationale?: string;
  position_size_usd?: number;
}

interface TradingState {
  orderBooks: Record<string, OrderBookData>;
  setOrderBookData: (symbol: string, data: Partial<OrderBookData>) => void;
  favorites: string[];
  addFavorite: (symbol: string) => void;
  removeFavorite: (symbol: string) => void;
  trades: PaperTrade[];
  fetchPaperTrades: () => Promise<void>;
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set) => ({
      orderBooks: {},
      favorites: ['BTCUSDT'],
      trades: [],
      fetchPaperTrades: async () => {
        const { data, error } = await supabase
          .from('paper_trades')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && data) {
          set({ trades: data as PaperTrade[] });
        } else {
          console.error("Failed to fetch paper trades:", error);
        }
      },
      setOrderBookData: (symbol, data) => set((state) => {
        const existing = state.orderBooks[symbol] || {
          bids: [], asks: [], lastPrice: '0.00', spread: '0.00', isConnected: false
        };
        return {
          orderBooks: {
            ...state.orderBooks,
            [symbol]: { ...existing, ...data }
          }
        };
      }),
      addFavorite: (symbol) => set((state) => {
        const sym = symbol.toUpperCase();
        return {
          favorites: state.favorites.includes(sym) ? state.favorites : [...state.favorites, sym]
        };
      }),
      removeFavorite: (symbol) => set((state) => ({
        favorites: state.favorites.filter(f => f !== symbol)
      })),
    }),
    {
      name: 'trading-favorites',
      partialize: (state) => ({ favorites: state.favorites }), // only persist favorites
    }
  )
);
