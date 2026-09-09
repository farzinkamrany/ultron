import requests
import json
import time
import os

assets = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA']
interval = '15m'
start_time = 1704067200000  # 2024-01-01T00:00:00Z
end_time = int(time.time() * 1000)
limit = 1000

output_dir = os.path.join(os.getcwd(), 'data', 'binance-15m-2024')
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

for asset in assets:
    symbol = f"{asset}USDT"
    filepath = os.path.join(output_dir, f"{asset.lower()}_15m_2024.csv")
    
    all_candles = []
    current_time = start_time
    
    print(f"Downloading {symbol}...")
    
    while current_time < end_time:
        url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&startTime={current_time}&limit={limit}"
        try:
            response = requests.get(url, timeout=10)
            data = response.json()
            
            if not data or type(data) != list or len(data) == 0:
                break
                
            all_candles.extend(data)
            current_time = data[-1][0] + 1
            
            print(f"\rLoaded {len(all_candles)} candles for {symbol}", end='')
            time.sleep(0.1)
        except Exception as e:
            print(f"\nError: {e}")
            time.sleep(2)
            
    print(f"\nFinished {symbol}: {len(all_candles)} candles.")
    
    with open(filepath, 'w') as f:
        f.write('timestamp,open,high,low,close,volume\n')
        for c in all_candles:
            f.write(f"{c[0]},{c[1]},{c[2]},{c[3]},{c[4]},{c[5]}\n")

print("Download complete.")
