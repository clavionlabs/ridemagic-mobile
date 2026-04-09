import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  Alert,
  ActivityIndicator,
} from "react-native";
import { MapView, getMapViewController } from "@googlemaps/react-native-navigation-sdk";
import type { MapViewController } from "@googlemaps/react-native-navigation-sdk";
import { useRouter } from "expo-router";
import { colors, spacing, fontSize, borderRadius } from "../../src/theme";
import { useAuth } from "../../src/hooks/useAuth";
import * as api from "../../src/services/api";

const MAP_NATIVE_ID = "homeMap";

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? colors.dark : colors.light;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const mapControllerRef = useRef<MapViewController | null>(null);

  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [routeData, setRouteData] = useState<any>(null);
  const [pois, setPois] = useState<any[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [loadingTour, setLoadingTour] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Redirect to auth if not logged in
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!authLoading && !user && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/(auth)/login");
    }
  }, [user, authLoading]);

  // Initialize map controller when map is ready
  // Map controller received from MapView
  const onMapViewControllerCreated = useCallback((controller: MapViewController) => {
    mapControllerRef.current = controller;
    setMapReady(true);
  }, []);

  // Draw route on map when routeData changes
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (!controller || !mapReady || !routeData?.decodedPath) return;

    const timer = setTimeout(async () => {
      try {
        const coordinates = routeData.decodedPath.map((p: any) => ({
          lat: p.lat,
          lng: p.lng,
        }));

        await controller.addPolyline({
          points: coordinates,
          color: colors.rideBlue,
          width: 5,
        });

        await controller.addMarker({
          position: { lat: routeData.originLat, lng: routeData.originLng },
          title: "Start",
        });

        await controller.addMarker({
          position: { lat: routeData.destinationLat, lng: routeData.destinationLng },
          title: "Destination",
        });

        for (const poi of pois) {
          await controller.addMarker({
            position: { lat: poi.location.lat, lng: poi.location.lng },
            title: poi.name,
          });
        }

        if (coordinates.length > 1) {
          const lats = coordinates.map((c: any) => c.lat);
          const lngs = coordinates.map((c: any) => c.lng);
          controller.moveCamera({
            target: {
              lat: (Math.min(...lats) + Math.max(...lats)) / 2,
              lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
            },
            zoom: 12,
          });
        }
      } catch (e) {
        console.warn("Map draw failed:", e);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [routeData, pois, mapReady]);

  const handleGetDirections = async () => {
    if (!origin.trim() || !destination.trim()) {
      Alert.alert("Error", "Please enter both starting point and destination");
      return;
    }

    setLoadingRoute(true);
    setRouteData(null);
    setPois([]);
    setTourReady(false);
    setRouteId(null);

    try {
      const data = await api.getDirections(origin, destination);
      setRouteData(data);

      // Fetch POIs
      const poisData = await api.getPois(data.polyline, data.durationSec);
      setPois(poisData.pois || []);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to get directions");
    } finally {
      setLoadingRoute(false);
    }
  };

  const handleGenerateTour = async () => {
    if (!routeData) return;

    setLoadingTour(true);
    try {
      const saved = await api.saveRoute({
        originAddress: origin,
        originLat: routeData.originLat,
        originLng: routeData.originLng,
        destinationAddress: destination,
        destinationLat: routeData.destinationLat,
        destinationLng: routeData.destinationLng,
        polyline: routeData.polyline,
        totalDistanceM: routeData.distanceM,
        totalDurationSec: routeData.durationSec,
      });

      setRouteId(saved.routeId);
      await api.generateTour(saved.routeId);

      const pollInterval = setInterval(async () => {
        try {
          const status = await api.getTourStatus(saved.routeId);
          if (status.status === "ready") {
            clearInterval(pollInterval);
            setTourReady(true);
            setLoadingTour(false);
          } else if (status.status === "failed") {
            clearInterval(pollInterval);
            setLoadingTour(false);
            Alert.alert("Error", "Tour generation failed. Please try again.");
          }
        } catch {
          // Keep polling
        }
      }, 3000);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to generate tour");
      setLoadingTour(false);
    }
  };

  const handleStartTour = () => {
    if (routeId) {
      router.push(`/tour/${routeId}`);
    }
  };

  if (authLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={colors.rideBlue} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Map */}
      <MapView
        style={styles.map}
        onMapViewControllerCreated={onMapViewControllerCreated}
        initialCameraPosition={{
          target: { lat: 37.7749, lng: -122.4194 },
          zoom: 12,
        }}
      />

      {/* Bottom Panel */}
      <View style={[styles.panel, { backgroundColor: theme.surface }]}>
        <View style={styles.dragHandle} />

        <Text style={[styles.title, { color: theme.text }]}>Plan Your Route</Text>

        {/* Origin input */}
        <View style={[styles.inputRow, { borderColor: theme.border }]}>
          <View style={[styles.dot, { backgroundColor: colors.magicGreen }]} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            placeholder="Starting point"
            placeholderTextColor={theme.textSecondary}
            value={origin}
            onChangeText={setOrigin}
          />
        </View>

        {/* Destination input */}
        <View style={[styles.inputRow, { borderColor: theme.border }]}>
          <View style={[styles.dot, { backgroundColor: colors.rideBlue }]} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            placeholder="Destination"
            placeholderTextColor={theme.textSecondary}
            value={destination}
            onChangeText={setDestination}
          />
        </View>

        {/* Route info */}
        {routeData && (
          <View style={styles.routeInfo}>
            <View style={styles.routeInfoItem}>
              <Text style={[styles.routeInfoLabel, { color: theme.textSecondary }]}>Distance</Text>
              <Text style={[styles.routeInfoValue, { color: theme.text }]}>
                {(routeData.distanceM / 1609.34).toFixed(1)} mi
              </Text>
            </View>
            <View style={styles.routeInfoItem}>
              <Text style={[styles.routeInfoLabel, { color: theme.textSecondary }]}>Duration</Text>
              <Text style={[styles.routeInfoValue, { color: theme.text }]}>
                {Math.ceil(routeData.durationSec / 60)} min
              </Text>
            </View>
          </View>
        )}

        {/* Buttons */}
        {!routeData ? (
          <TouchableOpacity
            style={[styles.button, loadingRoute && styles.buttonDisabled]}
            onPress={handleGetDirections}
            disabled={loadingRoute}
          >
            {loadingRoute ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Get Directions</Text>
            )}
          </TouchableOpacity>
        ) : tourReady ? (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.magicGreen }]}
            onPress={handleStartTour}
          >
            <Text style={styles.buttonText}>Start Tour</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, loadingTour && styles.buttonDisabled]}
            onPress={handleGenerateTour}
            disabled={loadingTour}
          >
            {loadingTour ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={[styles.buttonText, { marginLeft: 8 }]}>Generating Tour...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Generate Audio Tour</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  map: { flex: 1 },
  panel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#ccc",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    paddingVertical: 4,
  },
  routeInfo: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  routeInfoItem: { alignItems: "center" },
  routeInfoLabel: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 1 },
  routeInfoValue: { fontSize: fontSize.xl, fontWeight: "700", marginTop: 2 },
  button: {
    backgroundColor: colors.rideBlue,
    borderRadius: borderRadius.md,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: fontSize.md, fontWeight: "700" },
  loadingRow: { flexDirection: "row", alignItems: "center" },
});
