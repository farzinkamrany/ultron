import { useState, useEffect, useRef } from 'react';

type OrderBookData = {
  bids: [string, string][]; // [price, amount]
  asks: [string, string][]; // [price, amount]
  lastPrice: string;
  spread: string;
  isConnected: boolean;
};

export function useOrderBook(symbol: string = 'BTCUSDT') {
  const [data, setData] = useState<OrderBookData>({
    bids: [],
    asks: [],
    lastPrice: '0.00',
    spread: '0.00',
    isConnected: false,
  });

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Using CoinEx V2 Spot WebSocket (Friendly for Iranian IP, no Binance)
    const wsUrl = 'wss://socket.coinex.com/v2/spot';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setData(prev => ({ ...prev, isConnected: true }));
      
      // Subscribe to depth (order book)
      ws.send(JSON.stringify({
        method: "depth.subscribe",
        params: {
          market_list: [symbol],
          limit: 10,
          interval: "0"
        },
        id: 1
      }));
    };

    ws.onmessage = (event) => {
      const response = JSON.parse(event.data);

      if (response.method === 'depth.update' && response.data) {
        const { depth } = response.data;
        if (!depth) return;

        const asks = depth.asks || [];
        const bids = depth.bids || [];
        
        let spread = '0.00';
        let lastPrice = data.lastPrice;

        if (asks.length > 0 && bids.length > 0) {
          const lowestAsk = parseFloat(asks[0][0]);
          const highestBid = parseFloat(bids[0][0]);
          spread = (lowestAsk - highestBid).toFixed(2);
          lastPrice = ((lowestAsk + highestBid) / 2).toFixed(2);
        }

        setData(prev => ({
          ...prev,
          bids: bids.slice(0, 10),
          asks: asks.slice(0, 10),
          lastPrice,
          spread
        }));
      }
    };

    ws.onclose = () => {
      setData(prev => ({ ...prev, isConnected: false }));
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setData(prev => ({ ...prev, isConnected: false }));
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          method: "depth.unsubscribe",
          params: { market_list: [symbol] },
          id: 2
        }));
        ws.close();
      }
    };
  }, [symbol]);

  return data;
}
