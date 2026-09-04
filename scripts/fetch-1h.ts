import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function fetch1hData(symbol: string, fileNamePrefix: string) {
  console.log(`Fetching ${symbol} 1h data from Binance Vision...`);
  const dataDir = path.join(process.cwd(), 'data');
  const masterCsvPath = path.join(dataDir, `${fileNamePrefix}_1h_history.csv`);
  
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  if (fs.existsSync(masterCsvPath)) fs.unlinkSync(masterCsvPath);

  const years = ['2021', '2022'];
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  
  const writeStream = fs.createWriteStream(masterCsvPath, { flags: 'a' });
  writeStream.write('timestamp,open,high,low,close,volume\n');
  
  let totalCandles = 0;
  for (const year of years) {
    for (const month of months) {
      const fileName = `${symbol}-1h-${year}-${month}`;
      const zipName = `${fileName}.zip`;
      const url = `https://data.binance.vision/data/spot/monthly/klines/${symbol}/1h/${zipName}`;
      
      const zipPath = path.join(dataDir, zipName);
      const csvPath = path.join(dataDir, `${fileName}.csv`);
      
      try {
        execSync(`curl -s -L -o "${zipPath}" "${url}"`);
        execSync(`tar -xf "${zipPath}" -C "${dataDir}"`);
        
        const csvData = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvData.split('\n');
        
        let count = 0;
        for (const line of lines) {
          if (!line.trim()) continue;
          const cols = line.split(',');
          if (cols.length >= 6) {
            writeStream.write(`${cols[0]},${cols[1]},${cols[2]},${cols[3]},${cols[4]},${cols[5]}\n`);
            count++;
            totalCandles++;
          }
        }
        
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
      } catch (err: any) {
        console.error(`Error processing ${symbol} ${year}-${month}: ${err.message}`);
      }
    }
  }
  
  writeStream.end();
  console.log(`Finished ${symbol}! Total 1h candles: ${totalCandles}`);
}

async function main() {
  await fetch1hData('BTCUSDT', 'btc');
  await fetch1hData('ETHUSDT', 'eth');
}

main().catch(console.error);
