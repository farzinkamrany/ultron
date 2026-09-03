import { Project, SyntaxKind } from 'ts-morph';
import path from 'path';

export interface CloneConfig {
  Z_SCORE_THRESHOLD: number;
  GANN_TOLERANCE: number;
  SMC_LIQUIDITY_BUFFER: number;
}

export function generateClones(count: number): CloneConfig[] {
  const clones: CloneConfig[] = [];
  for (let i = 0; i < count; i++) {
    clones.push({
      Z_SCORE_THRESHOLD: Number((1.5 + Math.random() * 2).toFixed(2)), // 1.5 to 3.5
      GANN_TOLERANCE: Number((0.01 + Math.random() * 0.09).toFixed(3)), // 0.01 to 0.1
      SMC_LIQUIDITY_BUFFER: Number((0.005 + Math.random() * 0.045).toFixed(3)) // 0.005 to 0.05
    });
  }
  return clones;
}

export function fitnessFunction(totalProfit: number, winRate: number, maxDrawdown: number): number {
  if (maxDrawdown > 0.02) return -Infinity; // Hard death for DD > 2%
  if (maxDrawdown === 0) maxDrawdown = 0.0001; // Avoid division by zero
  return (totalProfit * winRate) / maxDrawdown;
}

export function runGeneticBacktest(clones: CloneConfig[], marketData: any): CloneConfig {
  let bestClone = clones[0];
  let highestFitness = -Infinity;
  
  for (const clone of clones) {
    // Simulated backtest logic over the 30-day 15m candle array
    // In a real implementation, you would loop over marketData evaluating signals using 'clone' params.
    // For this engine setup, we simulate the performance extraction.
    
    // Simulate finding profit, win rate, and drawdown
    const simProfit = Math.random() * 1000;
    const simWinRate = 0.4 + Math.random() * 0.5;
    const simDrawdown = Math.random() * 0.03; // Could be over 2%
    
    const fitness = fitnessFunction(simProfit, simWinRate, simDrawdown);
    
    if (fitness > highestFitness) {
      highestFitness = fitness;
      bestClone = clone;
    }
  }
  
  // If no clone survived (all DD > 2%), return original or best effort
  if (highestFitness === -Infinity) {
    return clones[0]; // fallback
  }
  
  return bestClone;
}

export async function evolveSystem(winningClone: CloneConfig) {
  const project = new Project();
  
  // Path to config.ts
  const configPath = path.resolve(process.cwd(), 'src/lib/trading/config.ts');
  const sourceFile = project.addSourceFileAtPath(configPath);
  
  const configDecl = sourceFile.getVariableDeclaration('TRADING_CONFIG');
  if (!configDecl) throw new Error("TRADING_CONFIG not found in config.ts");
  
  const initializer = configDecl.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
  if (!initializer) throw new Error("TRADING_CONFIG is not an object literal");
  
  const zScoreProp = initializer.getProperty('Z_SCORE_THRESHOLD');
  const gannProp = initializer.getProperty('GANN_TOLERANCE');
  const smcProp = initializer.getProperty('SMC_LIQUIDITY_BUFFER');
  
  // Replace the values via AST
  if (zScoreProp && zScoreProp.isKind(SyntaxKind.PropertyAssignment)) {
    zScoreProp.getInitializer()?.replaceWithText(winningClone.Z_SCORE_THRESHOLD.toString());
  }
  if (gannProp && gannProp.isKind(SyntaxKind.PropertyAssignment)) {
    gannProp.getInitializer()?.replaceWithText(winningClone.GANN_TOLERANCE.toString());
  }
  if (smcProp && smcProp.isKind(SyntaxKind.PropertyAssignment)) {
    smcProp.getInitializer()?.replaceWithText(winningClone.SMC_LIQUIDITY_BUFFER.toString());
  }
  
  await project.save();
  console.log(`[GENESIS] Evolved system to: Z=${winningClone.Z_SCORE_THRESHOLD}, GANN=${winningClone.GANN_TOLERANCE}, SMC=${winningClone.SMC_LIQUIDITY_BUFFER}`);
}

export async function runGenesisEpoch() {
  console.log("[GENESIS] Starting new Genetic Algorithm epoch...");
  const clones = generateClones(500);
  
  // In reality, fetch 30 days of 15m data here via ccxt
  const mockMarketData: any[] = []; 
  
  const bestClone = runGeneticBacktest(clones, mockMarketData);
  console.log(`[GENESIS] Winning Clone selected:`, bestClone);
  
  await evolveSystem(bestClone);
  console.log("[GENESIS] Epoch complete. Configuration written to source code.");
}
