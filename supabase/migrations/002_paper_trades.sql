CREATE TABLE IF NOT EXISTS public.paper_trades (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    symbol text NOT NULL,
    position_type text NOT NULL CHECK (position_type IN ('LONG', 'SHORT')),
    entry_price numeric NOT NULL,
    stop_loss numeric NOT NULL,
    take_profit numeric NOT NULL,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'WON', 'LOST')),
    pnl numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_at timestamp with time zone
);

-- Enable RLS
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users if needed (or service role)
CREATE POLICY "Enable all for service-role only" ON public.paper_trades
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
