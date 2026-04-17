import { ENV } from "../config/env";
import { supabase } from "../lib/supabase";

const API = ENV.API_URL;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Places Autocomplete (REST API — no JS SDK needed)
export async function getPlaceSuggestions(input: string, userLocation?: { lat: number; lng: number }): Promise<Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>> {
  if (!input || input.length < 2) return [];

  const loc = userLocation || { lat: 37.7749, lng: -122.4194 };
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&location=${loc.lat},${loc.lng}&radius=50000&key=${ENV.GOOGLE_MAPS_API_KEY}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK") return [];

    return (data.predictions || []).slice(0, 5).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text || p.description,
      secondaryText: p.structured_formatting?.secondary_text || "",
    }));
  } catch {
    return [];
  }
}

// Decode polyline to array of {lat, lng}
export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// Routes
export async function getDirections(origin: string, destination: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/directions?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`, { headers });
  if (!res.ok) throw new Error("Failed to get directions");
  const data = await res.json();

  // Transform API response to match what the home screen expects
  return {
    polyline: data.polyline,
    distanceM: data.totalDistanceM,
    durationSec: data.totalDurationSec,
    originLat: data.startLocation.lat,
    originLng: data.startLocation.lng,
    destinationLat: data.endLocation.lat,
    destinationLng: data.endLocation.lng,
    originAddress: data.startAddress,
    destinationAddress: data.endAddress,
    decodedPath: decodePolyline(data.polyline),
  };
}

export async function saveRoute(data: {
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  polyline: string;
  totalDistanceM: number;
  totalDurationSec: number;
  pois?: Array<{
    placeId: string;
    name: string;
    types: string[];
    location: { lat: number; lng: number };
    rating: number | null;
    userRatingsTotal: number;
    vicinity: string;
  }>;
}) {
  const headers = await getAuthHeaders();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  const res = await fetch(`${API}/api/routes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...data, userId }),
  });
  if (!res.ok) throw new Error("Failed to save route");
  return res.json();
}

// POIs
export async function getPois(polyline: string, duration?: number) {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ polyline });
  if (duration) params.set("duration", String(duration));
  const res = await fetch(`${API}/api/pois?${params}`, { headers });
  if (!res.ok) throw new Error("Failed to get POIs");
  return res.json();
}

// Tour generation
export async function generateTour(routeId: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/tour/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ routeId }),
  });
  if (!res.ok) throw new Error("Failed to start tour generation");
  return res.json();
}

export async function getTourStatus(routeId: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/tour/status/${routeId}`, { headers });
  if (!res.ok) throw new Error("Failed to get tour status");
  return res.json();
}

// User
export async function getUserStats() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/user/stats`, { headers });
  if (!res.ok) throw new Error("Failed to get user stats");
  return res.json();
}

export async function getUserTopics() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/user/topics`, { headers });
  if (!res.ok) throw new Error("Failed to get user topics");
  return res.json();
}

export async function getUserRoutes() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/user/routes`, { headers });
  if (!res.ok) throw new Error("Failed to get user routes");
  return res.json();
}
