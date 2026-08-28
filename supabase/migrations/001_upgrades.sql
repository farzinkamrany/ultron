-- Table for Goals (Long-term objectives)
CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    deadline DATE,
    status TEXT DEFAULT 'IN_PROGRESS',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Habits (Daily/Weekly routines)
CREATE TABLE IF NOT EXISTS habits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    frequency_days INT DEFAULT 1,
    current_streak INT DEFAULT 0,
    longest_streak INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for Daily Logs (Track habit completions)
CREATE TABLE IF NOT EXISTS daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id UUID REFERENCES habits(id) ON DELETE CASCADE,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT
);

-- Table for Finances (Expense tracking)
CREATE TABLE IF NOT EXISTS finances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount DECIMAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Example RLS setup (assuming auth.uid() or similar logic if needed, 
-- but for server-to-server webhook we can bypass using service role 
-- or write explicit policies if using anon key)
-- ALTER TABLE finances ENABLE ROW LEVEL SECURITY;
