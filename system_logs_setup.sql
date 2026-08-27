create table if not exists system_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null, -- 'INFO', 'WARN', 'ERROR', 'CRITICAL'
  context text not null, -- e.g., 'API_TRADING', 'API_ARBITRAGE'
  message text not null,
  stack_trace text,
  metadata jsonb,
  created_at timestamptz default now()
);
