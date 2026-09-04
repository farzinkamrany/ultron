import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function fetchEth2324() {
  console.log(`Fetching ETHUSDT 30m data for 2023-2024...`);
  const dataDir = path.join(process.cwd(), 'data');
  const masterCsvPath = path.join(dataDir, `eth_30m_2324.csv`);
  
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  if (fs.existsSync(masterCsvPath)) fs.unlinkSync(masterCsvPath);

  const years = ['2023', '2024'];
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  
  const writeStream = fs.createWriteStream(masterCsvPath, { flags: 'a' });
  writeStream.write('timestamp,open,high,low,close,volume\n');
  
  let totalCandles = 0;
  for (const year of years) {
    for (const month of months) {
      if (year === '2024' && Number(month) > 8) continue; // Skip future months
      const fileName = `ETHUSDT-30m-${year}-${month}`;
      const zipName = `${fileName}.zip`;
      const url = `https://data.binance.vision/data/spot/monthly/klines/ETHUSDT/30m/${zipName}`;
      
      const zipPath = path.join(dataDir, zipName);
      const csvPath = path.join(dataDir, `${fileName}.csv`);
      
      try {
        execSync(`curl -s -L -o "${zipPath}" "${url}"`);
        // If curl downloads an XML error page instead of zip, tar will fail.
        try {
          execSync(`tar -xf "${zipPath}" -C "${dataDir}"`);
          const csvData = fs.readFileSync(csvPath, 'utf-8');
          const lines = csvData.split('\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            const cols = line.split(',');
            if (cols.length >= 6 && !isNaN(Number(cols[0]))) {
              writeStream.write(`${cols[0]},${cols[1]},${cols[2]},${cols[3]},${cols[4]},${cols[5]}\n`);
              totalCandles++;
            }
          }
          if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
        } catch (e) {
          // Tar failed, likely 404 from binance
        }
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch (err: any) {
        console.error(`Error processing 30m ${year}-${month}: ${err.message}`);
      }
    }
  }
  
  writeStream.end();
  console.log(`Finished! Total candles: ${totalCandles}`);
}

fetchEth2324().catch(console.error);
