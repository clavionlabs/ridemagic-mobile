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

// Routes
export async function getDirections(origin: string, destination: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/directions?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`, { headers });
  if (!res.ok) throw new Error("Failed to get directions");
  return res.json();
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
}) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/routes`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
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

export async function getUserRoutes() {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API}/api/user/routes`, { headers });
  if (!res.ok) throw new Error("Failed to get user routes");
  return res.json();
}
