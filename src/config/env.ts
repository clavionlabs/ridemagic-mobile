
export const ENV = {
  //API_URL: "http://10.187.226.174:3001",
  API_URL: "https://ridemagic-production.up.railway.app",
  SUPABASE_URL: "https://dnnitcnsvloulhkujhly.supabase.co",
  // Publishable key: safe to ship in the app, RLS protects the data.
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_vP9otkAoxPLA5dcyxakPBw_3vI27ums",
  // Set in .env (local) or the EAS environment (builds); never commit the key.
  GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
  get MAP_STYLE_URL() { return `${this.API_URL}/api/map-style`; },
};
