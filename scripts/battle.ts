import { spawn } from 'child_process';
import * as path from 'path';

console.log("=========================================");
console.log("   ULTRON BATTLE: MEGALODON vs DOOMSDAY   ");
console.log("=========================================\n");
console.log("Initializing twin simulation engines...\n");

function runSimulation(scriptName: string, engineName: string) {
    return new Promise((resolve, reject) => {
        const tsxPath = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
        const scriptPath = path.resolve(__dirname, scriptName);
        
        // Spawn the process
        const process = spawn('node', ['--max-old-space-size=8192', tsxPath, scriptPath]);
        
        let output = '';
        
        process.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
        });
        
        process.stderr.on('data', (data) => {
            console.error(`[${engineName} ERROR] ${data.toString()}`);
        });
        
        process.on('close', (code) => {
            if (code === 0) {
                // Extract only the final result string
                const resultIndex = output.indexOf('Final Balance:');
                if (resultIndex !== -1) {
                    const cleanOutput = output.substring(output.lastIndexOf('============================================', resultIndex - 50));
                    console.log(`\n\n🟢 [${engineName} FINISHED]`);
                    console.log(cleanOutput);
                } else {
                    console.log(`\n\n🟢 [${engineName} FINISHED]`);
                    console.log(output);
                }
                resolve(output);
            } else {
                reject(new Error(`${engineName} failed with code ${code}`));
            }
        });
    });
}

async function startBattle() {
    const startTime = Date.now();
    
    // Run both engines simultaneously across different CPU cores
    await Promise.all([
        runSimulation('megalodon.ts', 'MEGALODON'),
        runSimulation('doomsday_backtest.ts', 'DOOMSDAY')
    ]);
    
    const endTime = Date.now();
    console.log(`\n=========================================`);
    console.log(`🏁 BATTLE COMPLETED IN ${((endTime - startTime) / 1000).toFixed(2)} SECONDS`);
    console.log(`=========================================\n`);
}

startBattle().catch(console.error);
