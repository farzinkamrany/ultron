import fs from 'fs';
import path from 'path';

const oldDir = 'data';
const newDir = 'data';

const coins = ["btc","eth","sol","link","ada","bnb","xrp","doge","avax","dot"];

for (const coin of coins) {
    const oldFile = `${coin}_15m_4years.csv`;
    const newFile = `${coin}_15m_history.csv`;
    
    const oldFilePath = path.join(oldDir, oldFile);
    const newFilePath = path.join(newDir, newFile);
    
    if (!fs.existsSync(oldFilePath)) continue;
    if (!fs.existsSync(newFilePath)) {
        console.log(`Skipping ${coin} because new file doesn't exist.`);
        continue;
    }
    
    console.log(`Merging ${coin}...`);
    
    const oldContent = fs.readFileSync(oldFilePath, 'utf-8').trim().split('\n');
    const newContent = fs.readFileSync(newFilePath, 'utf-8').trim().split('\n');
    
    if (oldContent.length < 2) {
        console.log(`Skipping ${coin} because old file is empty.`);
        continue;
    }
    
    const header = oldContent[0];
    const map = new Map<number, string>();
    
    // Process old
    for (let i = 1; i < oldContent.length; i++) {
        const line = oldContent[i].trim();
        if (!line) continue;
        const ts = parseInt(line.split(',')[0]);
        if (!isNaN(ts)) map.set(ts, line);
    }
    
    // Process new
    for (let i = 1; i < newContent.length; i++) {
        const line = newContent[i].trim();
        if (!line) continue;
        const ts = parseInt(newContent[i].split(',')[0]);
        if (!isNaN(ts)) map.set(ts, line);
    }
    
    // Sort
    const sortedKeys = Array.from(map.keys()).sort((a, b) => a - b);
    
    const mergedLines = [header];
    for (const key of sortedKeys) {
        mergedLines.push(map.get(key)!);
    }
    
    fs.writeFileSync(newFilePath, mergedLines.join('\n'));
    console.log(`Saved merged ${coin} with ${sortedKeys.length} rows.`);
}
console.log("Merge complete!");
