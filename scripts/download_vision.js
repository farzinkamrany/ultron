const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const symbol = 'ADAUSDT';
const interval = '15m';
const startYear = 2020;
const endYear = 2023;

const dataDir = path.join(__dirname, '../data');
const tempDir = path.join(dataDir, 'temp_vision');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Handle redirect
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Status ${response.statusCode} for ${url}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function run() {
    console.log("Starting Binance Vision Batch Download...");
    const csvFiles = [];
    
    for (let year = startYear; year <= endYear; year++) {
        for (let month = 1; month <= 12; month++) {
            const mStr = month.toString().padStart(2, '0');
            const filename = `${symbol}-${interval}-${year}-${mStr}.zip`;
            const url = `https://data.binance.vision/data/spot/monthly/klines/${symbol}/${interval}/${filename}`;
            const destZip = path.join(tempDir, filename);
            const destCsv = path.join(tempDir, filename.replace('.zip', '.csv'));
            
            process.stdout.write(`Downloading ${year}-${mStr}... `);
            try {
                await downloadFile(url, destZip);
                process.stdout.write(`Unzipping... `);
                
                // Use Windows built-in tar to extract zip
                execSync(`tar -xf "${destZip}" -C "${tempDir}"`);
                fs.unlinkSync(destZip); // clean up zip
                
                csvFiles.push(destCsv);
                console.log(`✅`);
            } catch (e) {
                console.log(`❌ Failed: ${e.message}`);
            }
        }
    }
    
    console.log("\nMerging CSVs...");
    const finalCsvPath = path.join(dataDir, `ada_15m_4years.csv`);
    let finalCsv = 'timestamp,open,high,low,close,volume\n';
    
    for (const file of csvFiles) {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.trim() === '') continue;
                const parts = line.split(',');
                // Binance vision CSV format: open_time, open, high, low, close, volume, close_time, quote_volume, count, taker_buy_volume, taker_buy_quote_volume, ignore
                if (parts.length >= 6 && !isNaN(Number(parts[0]))) {
                    finalCsv += `${parts[0]},${parts[1]},${parts[2]},${parts[3]},${parts[4]},${parts[5]}\n`;
                }
            }
            fs.unlinkSync(file); // clean up part csv
        }
    }
    
    fs.writeFileSync(finalCsvPath, finalCsv);
    fs.rmdirSync(tempDir);
    
    console.log(`\n🎉 Success! All data merged into: ${finalCsvPath}`);
}

run().catch(console.error);
