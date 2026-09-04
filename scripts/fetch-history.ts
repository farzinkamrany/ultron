import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function fetchHistory() {
  console.log('Initialize Binance Vision to fetch historical data (CSV Streaming)...');
  const dataDir = path.join(process.cwd(), 'data');
  const masterCsvPath = path.join(dataDir, 'btc_5m_history.csv');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  // Clear existing master file
  if (fs.existsSync(masterCsvPath)) {
    fs.unlinkSync(masterCsvPath);
  }

  const years = ['2021', '2022'];
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  
  const writeStream = fs.createWriteStream(masterCsvPath, { flags: 'a' });
  // Add header for clarity (optional, but good for robust parsers)
  writeStream.write('timestamp,open,high,low,close,volume\n');
  
  let totalCandles = 0;
  for (const year of years) {
    for (const month of months) {
      const fileName = `BTCUSDT-5m-${year}-${month}`;
      const zipName = `${fileName}.zip`;
      const url = `https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/5m/${zipName}`;
      
      const zipPath = path.join(dataDir, zipName);
      const csvPath = path.join(dataDir, `${fileName}.csv`);
      
      console.log(`Downloading ${year}-${month}...`);
      try {
        // Download using curl
        execSync(`curl -s -L -o "${zipPath}" "${url}"`);
        
        // Extract using tar
        execSync(`tar -xf "${zipPath}" -C "${dataDir}"`);
        
        // Read the extracted CSV and append essential columns to the master CSV
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
        console.log(`Appended ${count} candles for ${year}-${month}`);
        
        // Cleanup temp files
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
        
      } catch (err: any) {
        console.error(`Error processing ${year}-${month}: ${err.message}`);
      }
    }
  }
  
  writeStream.end();
  console.log(`\nFinished fetching! Total candles written to CSV: ${totalCandles}`);
  console.log(`Data successfully saved to data/btc_5m_history.csv. Ready for memory-efficient backtesting!`);
}

fetchHistory().catch(console.error);
