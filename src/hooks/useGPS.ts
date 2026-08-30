import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export type LocationData = {
  lat: number;
  lon: number;
  accuracy: number;
  battery: number;
  context: string;
  recorded_at: string;
};

export function useGPS() {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Fetch initial latest location
    const fetchLatestLocation = async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();
        
      if (data) {
        setLocation(data);
      }
      setIsLoading(false);
    };

    fetchLatestLocation();

    // 2. Subscribe to real-time inserts
    const channel = supabase
      .channel('public:locations')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'locations' },
        (payload) => {
          console.log('[GPS] New location received!', payload.new);
          setLocation(payload.new as LocationData);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { location, isLoading };
}
