// Extends app.json with values that must not be committed.
// The Google Maps key comes from .env (local) or the EAS environment (builds).
const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

if (!mapsKey) {
  console.warn("[app.config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set; maps will not load.");
}

module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    config: { ...config.ios?.config, googleMapsApiKey: mapsKey },
  },
  android: {
    ...config.android,
    config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } },
  },
});
