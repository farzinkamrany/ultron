import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OrderBookData {
  bids: [string, string][]; // [price, amount]
  asks: [string, string][]; // [price, amount]
  lastPrice: string;
  spread: string;
  isConnected: boolean;
}

interface TradingState {
  orderBooks: Record<string, OrderBookData>;
  setOrderBookData: (symbol: string, data: Partial<OrderBookData>) => void;
  favorites: string[];
  addFavorite: (symbol: string) => void;
  removeFavorite: (symbol: string) => void;
}

export const useTradingStore = create<TradingState>()(
  persist(
    (set) => ({
      orderBooks: {},
      favorites: ['BTCUSDT'],
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
