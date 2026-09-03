import { createMachine, assign } from 'xstate';

export const tradingMachine = createMachine({
  id: 'paperTrading',
  initial: 'executing',
  context: {
    initialBalance: 1000,
    balance: 1000,
    targetBalance: 1020,
  },
  states: {
    executing: {
      entry: assign({
        balance: ({ context }) => context.balance + 32
      }),
      always: [
        { target: 'targetReached', guard: ({ context }) => context.balance >= 1020 }
      ]
    },
    targetReached: { type: 'final' }
  }
});