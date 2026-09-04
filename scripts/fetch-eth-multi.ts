import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function fetchEthTimeframe(timeframe: string) {
  console.log(`Fetching ETHUSDT ${timeframe} data...`);
  const dataDir = path.join(process.cwd(), 'data');
  const masterCsvPath = path.join(dataDir, `eth_${timeframe}_history.csv`);
  
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  if (fs.existsSync(masterCsvPath)) fs.unlinkSync(masterCsvPath);

  const years = ['2021', '2022'];
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  
  const writeStream = fs.createWriteStream(masterCsvPath, { flags: 'a' });
  writeStream.write('timestamp,open,high,low,close,volume\n');
  
  let totalCandles = 0;
  for (const year of years) {
    for (const month of months) {
      const fileName = `ETHUSDT-${timeframe}-${year}-${month}`;
      const zipName = `${fileName}.zip`;
      const url = `https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/${timeframe}/${zipName}`;
      
      const zipPath = path.join(dataDir, zipName);
      const csvPath = path.join(dataDir, `${fileName}.csv`);
      
      try {
        execSync(`curl -s -L -o "${zipPath}" "${url}"`);
        execSync(`tar -xf "${zipPath}" -C "${dataDir}"`);
        
        const csvData = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvData.split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          const cols = line.split(',');
          if (cols.length >= 6) {
            writeStream.write(`${cols[0]},${cols[1]},${cols[2]},${cols[3]},${cols[4]},${cols[5]}\n`);
            totalCandles++;
          }
        }
        
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
      } catch (err: any) {
        console.error(`Error processing ${timeframe} ${year}-${month}: ${err.message}`);
      }
    }
  }
  
  writeStream.end();
  console.log(`Finished ETHUSDT ${timeframe}! Total candles: ${totalCandles}`);
}

async function main() {
  await fetchEthTimeframe('15m');
  await fetchEthTimeframe('30m');
  await fetchEthTimeframe('4h');
}

main().catch(console.error);
