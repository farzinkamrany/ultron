const { execSync } = require('child_process');

const files = [
  'btc_5m_history.csv',
  'btc_15m_history.csv',
  'btc_30m_history.csv',
  'btc_1h_history.csv',
  'eth_15m_history.csv',
  'eth_30m_history.csv',
  'eth_1h_history.csv'
];

console.log("Running extensive backtests. This may take a few minutes...\n");
console.log("File | Trades | Win Rate | Drawdown | Final Balance");
console.log("------------------------------------------------------------------");

for (const file of files) {
  try {
    const output = execSync(`node --max-old-space-size=8192 node_modules/tsx/dist/cli.mjs scripts/backtest.ts ${file}`, { encoding: 'utf-8' });
    
    // Parse output
    const balanceMatch = output.match(/Final Balance:\s+\$([\d\.]+)/);
    const tradesMatch = output.match(/Total Trades:\s+(\d+)/);
    const winRateMatch = output.match(/Win Rate:\s+([\d\.]+)%/);
    const drawdownMatch = output.match(/Max Drawdown:\s+\$([\d\.]+)/);
    
    const bal = balanceMatch ? parseFloat(balanceMatch[1]).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : 'N/A';
    const trds = tradesMatch ? tradesMatch[1] : 'N/A';
    const wr = winRateMatch ? winRateMatch[1] + '%' : 'N/A';
    const dd = drawdownMatch ? parseFloat(drawdownMatch[1]).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : 'N/A';
    
    console.log(`${file.padEnd(20)} | ${trds.padEnd(6)} | ${wr.padEnd(8)} | ${dd.padEnd(12)} | ${bal}`);
  } catch (e) {
    console.log(`${file.padEnd(20)} | Error executing`);
  }
}
