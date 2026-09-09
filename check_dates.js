const fs = require('fs');

const files = [
    'data/btc_15m_4years.csv',
    'data/sol_15m_3years.csv',
    'data/link_15m_4years.csv'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length > 1) {
        const firstLine = lines[1].split(',');
        const lastLine = lines[lines.length - 1].split(',');
        const start = new Date(parseInt(firstLine[0])).toISOString();
        const end = new Date(parseInt(lastLine[0])).toISOString();
        console.log(`${file}: Starts ${start}, Ends ${end}, Total: ${lines.length}`);
    }
}
