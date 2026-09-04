import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function fetchETH() {
  console.log('Fetching ETH/USDT 5m data from Binance Vision...');
  const dataDir = path.join(process.cwd(), 'data');
  const masterCsvPath = path.join(dataDir, 'eth_5m_history.csv');
  
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  if (fs.existsSync(masterCsvPath)) fs.unlinkSync(masterCsvPath);

  const years = ['2021', '2022'];
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  
  const writeStream = fs.createWriteStream(masterCsvPath, { flags: 'a' });
  writeStream.write('timestamp,open,high,low,close,volume\n');
  
  let totalCandles = 0;
  for (const year of years) {
    for (const month of months) {
      const fileName = `ETHUSDT-5m-${year}-${month}`;
      const zipName = `${fileName}.zip`;
      const url = `https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/5m/${zipName}`;
      
      const zipPath = path.join(dataDir, zipName);
      const csvPath = path.join(dataDir, `${fileName}.csv`);
      
      console.log(`Downloading ETH ${year}-${month}...`);
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
        console.log(`Appended ${count} candles for ETH ${year}-${month}`);
        
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
      } catch (err: any) {
        console.error(`Error processing ETH ${year}-${month}: ${err.message}`);
      }
    }
  }
  
  writeStream.end();
  console.log(`\nFinished! Total ETH candles: ${totalCandles}`);
}

fetchETH().catch(console.error);
