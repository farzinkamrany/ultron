import { useEffect, useRef } from 'react';
import { useTradingStore } from '@/store/tradingStore';

const DEFAULT_ORDERBOOK = {
  bids: [], asks: [], lastPrice: '0.00', spread: '0.00', isConnected: false
};

export function useOrderBook(symbol: string = 'BTCUSDT') {
  const setOrderBookData = useTradingStore(state => state.setOrderBookData);
  const data = useTradingStore(state => state.orderBooks[symbol] || DEFAULT_ORDERBOOK);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Using Bybit Spot WebSocket
    const wsUrl = 'wss://stream.bybit.com/v5/public/spot';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    // Subscribe to orderbook
    const topic = `orderbook.50.${symbol}`;

    let localBids: [string, string][] = [];
    let localAsks: [string, string][] = [];
    let hasNewData = false;

    const throttleInterval = setInterval(() => {
      if (!hasNewData) return;
      hasNewData = false;

      const newBids = localBids.slice(0, 20);
      const newAsks = localAsks.slice(0, 20);

      const currentState = useTradingStore.getState().orderBooks[symbol] || DEFAULT_ORDERBOOK;
      let spread = currentState.spread;
      let lastPrice = currentState.lastPrice;

      if (newAsks.length > 0 && newBids.length > 0) {
        const lowestAsk = parseFloat(newAsks[0][0]);
        const highestBid = parseFloat(newBids[0][0]);
        spread = (lowestAsk - highestBid).toFixed(2);
        lastPrice = ((lowestAsk + highestBid) / 2).toFixed(2);
      }

      setOrderBookData(symbol, {
        bids: newBids,
        asks: newAsks,
        lastPrice,
        spread
      });
    }, 500); // Update UI every 500ms

    ws.onopen = () => {
      setOrderBookData(symbol, { isConnected: true });
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [topic]
      }));
    };

    ws.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);

        if (response.topic === topic && response.data) {
          if (response.type === 'snapshot') {
            localBids = response.data.b || [];
            localAsks = response.data.a || [];
            hasNewData = true;
          } else if (response.type === 'delta') {
            const { b: deltaBids = [], a: deltaAsks = [] } = response.data;
            
            const merge = (current: [string, string][], deltas: [string, string][], isAscending: boolean) => {
              const map = new Map<string, string>();
              current.forEach(([p, q]) => map.set(p, q));
              deltas.forEach(([p, q]) => {
                if (parseFloat(q) === 0) map.delete(p);
                else map.set(p, q);
              });
              const arr = Array.from(map.entries());
              arr.sort((a, b) => isAscending ? parseFloat(a[0]) - parseFloat(b[0]) : parseFloat(b[0]) - parseFloat(a[0]));
              return arr;
            };

            localBids = merge(localBids, deltaBids, false);
            localAsks = merge(localAsks, deltaAsks, true);
            hasNewData = true;
          }
        }
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };

    ws.onclose = () => {
      setOrderBookData(symbol, { isConnected: false });
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setOrderBookData(symbol, { isConnected: false });
    };

    return () => {
      clearInterval(throttleInterval);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          op: 'unsubscribe',
          args: [topic]
        }));
        ws.close();
      }
    };
  }, [symbol]);

  return data;
}
