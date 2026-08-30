-- Table for GPS Locations Tracking
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION,
    battery INT,
    context TEXT,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: In production you may want to enable RLS and add a policy, 
-- but for a server-side only insertion and read via admin role or anon (if public), 
-- it's fine for this setup.
