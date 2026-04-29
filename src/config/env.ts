
export const ENV = {
  //API_URL: "http://10.187.226.174:3001",
  API_URL: "https://ridemagic-production.up.railway.app",
  SUPABASE_URL: "https://dnnitcnsvloulhkujhly.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRubml0Y25zdmxvdWxoa3VqaGx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MjE4MjEsImV4cCI6MjA5MDA5NzgyMX0.DPrreFVX1nCjaAl7aAB2zWkeU-vWzSwOeKZGrHHKYIU",
  GOOGLE_MAPS_API_KEY: "AIzaSyDwdyLAWuYc6WacRQpgtPI06wxXLofg3VI",
  get MAP_STYLE_URL() { return `${this.API_URL}/api/map-style`; },
};
