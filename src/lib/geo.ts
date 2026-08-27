export interface Coordinates { lat: number; lon: number; }

export const GEOFENCES = {
  HOME: { lat: 35.6892, lon: 51.3890, radius_meters: 100 }, // Example Tehran coordinates
  GYM: { lat: 35.7000, lon: 51.4000, radius_meters: 100 },
  WORK: { lat: 35.7500, lon: 51.4500, radius_meters: 150 },
};

// Haversine formula
export function getDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 6371e3; // Earth radius in meters
  const toRad = (val: number) => val * Math.PI / 180;
  
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLon = toRad(coord2.lon - coord1.lon);
  const lat1 = toRad(coord1.lat);
  const lat2 = toRad(coord2.lat);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

export function detectContext(coords: Coordinates): string {
  for (const [name, fence] of Object.entries(GEOFENCES)) {
    if (getDistance(coords, { lat: fence.lat, lon: fence.lon }) <= fence.radius_meters) {
      return `At ${name}`;
    }
  }
  return "In Transit";
}
