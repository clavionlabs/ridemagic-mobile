import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { MapView as NavMapView, getMapViewController } from "@googlemaps/react-native-navigation-sdk";
import type { MapViewController } from "@googlemaps/react-native-navigation-sdk";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { colors, fontSize, spacing, borderRadius } from "../../src/theme";
import { useAuth } from "../../src/hooks/useAuth";
import { supabase } from "../../src/lib/supabase";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface RouteData {
  id: string;
  origin_address: string;
  destination_address: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  polyline: string;
  total_distance_m: number;
  total_duration_sec: number;
  tour_theme: string | null;
  tour_summary: string | null;
  welcome_audio_url: string | null;
  closing_audio_url: string | null;
  music_track_id: string | null;
}

interface POI {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sequence_order: number;
  audio_url: string | null;
  audio_duration_sec: number | null;
  is_neighborhood_intro: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const STATE_LABELS: Record<string, string> = {
  idle: "Ready to start",
  welcome: "Welcome",
  navigating: "Drive to next point",
  narrating: "Now playing",
  closing: "Wrapping up",
  completed: "Tour complete",
};

const TRIGGER_RADIUS_M = 150;

export default function TourScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isDark = useColorScheme() === "dark";
  const theme = isDark ? colors.dark : colors.light;
  const router = useRouter();
  const { user } = useAuth();
  const mapControllerRef = useRef<MapViewController | null>(null);
  const MAP_NATIVE_ID = "tourMap";
  const [mapReady, setMapReady] = useState(false);

  // Data
  const [route, setRoute] = useState<RouteData | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [decodedPath, setDecodedPath] = useState<{ lat: number; lng: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Tour state
  const [tourState, setTourState] = useState<string>("idle");
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [triggeredPois, setTriggeredPois] = useState<Set<string>>(new Set());
  const [drivingMode, setDrivingMode] = useState(false);

  // Location
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);

  // Audio
  const soundRef = useRef<Audio.Sound | null>(null);
  const bgMusicRef = useRef<Audio.Sound | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const poiQueueRef = useRef<number[]>([]);

  // Fetch route + POIs
  useEffect(() => {
    if (!user || !id) return;

    async function fetchData() {
      const { data: routeData } = await supabase
        .from("routes")
        .select("*")
        .eq("id", id)
        .single();

      const { data: poiData } = await supabase
        .from("route_pois")
        .select("id, name, lat, lng, sequence_order, audio_url, audio_duration_sec, is_neighborhood_intro")
        .eq("route_id", id)
        .order("sequence_order", { ascending: true });

      if (routeData) {
        setRoute(routeData);
        const path = decodePolyline(routeData.polyline);
        setDecodedPath(path);
      }
      if (poiData) setPois(poiData as POI[]);
      setLoading(false);
    }

    fetchData();
  }, [user, id]);

  // Poll for missing POI audio
  useEffect(() => {
    const hasMissing = pois.some((p) => !p.audio_url && !p.is_neighborhood_intro);
    if (!hasMissing || !id) return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("route_pois")
        .select("id, name, lat, lng, sequence_order, audio_url, audio_duration_sec, is_neighborhood_intro")
        .eq("route_id", id)
        .order("sequence_order", { ascending: true });

      if (data) {
        setPois(data as POI[]);
        if (!data.some((p: any) => !p.audio_url && !p.is_neighborhood_intro)) {
          clearInterval(interval);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [pois, id]);

  // Initialize map controller + draw route when map is ready
  // Map controller received from MapView
  const onMapViewControllerCreated = useCallback((controller: MapViewController) => {
    mapControllerRef.current = controller;
    setMapReady(true);
  }, []);

  // Draw route + markers when map and data are ready
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (!controller || !mapReady || !route || decodedPath.length === 0) return;

    // Delay to let native view fully attach
    const timer = setTimeout(async () => {
      try {

        await controller.addPolyline({
          id: "route",
          points: decodedPath.map((p) => ({ lat: p.lat, lng: p.lng })),
          color: colors.rideBlue,
          width: 5,
        });

        await controller.addMarker({
          id: "origin",
          position: { lat: route.origin_lat, lng: route.origin_lng },
          title: "Start",
        });

        await controller.addMarker({
          id: "destination",
          position: { lat: route.destination_lat, lng: route.destination_lng },
          title: "Destination",
        });

        const visiblePois = pois.filter(p => !p.is_neighborhood_intro);
        for (let i = 0; i < visiblePois.length; i++) {
          const poi = visiblePois[i];
          await controller.addMarker({
            id: `poi-${poi.id}`,
            position: { lat: poi.lat, lng: poi.lng },
            title: `${i + 1}. ${poi.name}`,
          });
        }

        const lats = decodedPath.map((p) => p.lat);
        const lngs = decodedPath.map((p) => p.lng);
        controller.moveCamera({
          target: {
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          },
          zoom: 12,
        });
      } catch (e) {
        console.warn("Tour map draw failed:", e);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [route, decodedPath, pois, mapReady]);

  // Location tracking
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    async function startTracking() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 1000,
        },
        (location) => {
          setUserLocation({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            heading: location.coords.heading,
          });
        }
      );
    }

    startTracking();
    return () => { subscription?.remove(); };
  }, []);

  // Geofence checking
  useEffect(() => {
    if (!userLocation || tourState !== "navigating") return;

    for (let i = 0; i < pois.length; i++) {
      const poi = pois[i];
      if (!poi || triggeredPois.has(poi.id) || poiQueueRef.current.includes(i)) continue;

      const dist = distanceM(userLocation.lat, userLocation.lng, poi.lat, poi.lng);

      if (dist <= TRIGGER_RADIUS_M) {
        if (poiQueueRef.current.length === 0 && tourState === "navigating") {
          playPoiAudio(i);
        } else {
          poiQueueRef.current.push(i);
        }
      }
    }
  }, [userLocation, tourState, pois, triggeredPois]);

  // Auto-follow in driving mode
  useEffect(() => {
    if (!drivingMode || !userLocation || !mapControllerRef.current || !mapReady) return;
    if (tourState === "idle" || tourState === "completed") return;

    try {
      mapControllerRef.current.moveCamera({
        target: { lat: userLocation.lat, lng: userLocation.lng },
        bearing: userLocation.heading || 0,
        tilt: 45,
        zoom: 17,
      });

      mapControllerRef.current.addMarker({
        id: "user-location",
        position: { lat: userLocation.lat, lng: userLocation.lng },
        rotation: userLocation.heading || 0,
        flat: true,
        title: "You",
      });
    } catch (e) {
      // Map not ready yet
    }
  }, [userLocation, drivingMode, tourState, mapReady]);

  // Keep screen awake during tour
  useEffect(() => {
    if (tourState !== "idle" && tourState !== "completed") {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
  }, [tourState]);

  // Audio setup
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    });

    return () => {
      soundRef.current?.unloadAsync();
      bgMusicRef.current?.unloadAsync();
    };
  }, []);

  // Play audio helper
  const playAudio = useCallback(async (url: string, onFinish?: () => void) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setCurrentTime(status.positionMillis / 1000);
            setDuration(status.durationMillis ? status.durationMillis / 1000 : 0);
            setIsPlaying(status.isPlaying);

            if (status.didJustFinish) {
              onFinish?.();
            }
          }
        }
      );

      soundRef.current = sound;
    } catch (err) {
      console.error("Audio playback error:", err);
      onFinish?.();
    }
  }, []);

  // Stop audio
  const stopAudio = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  // Play welcome
  const playWelcome = useCallback(() => {
    if (!route?.welcome_audio_url) {
      setTourState("navigating");
      return;
    }

    setTourState("welcome");
    setCurrentSegmentIndex(-1);

    playAudio(route.welcome_audio_url, () => {
      setTourState("navigating");
    });
  }, [route, playAudio]);

  // Play POI audio
  const playPoiAudio = useCallback((index: number) => {
    const poi = pois[index];
    if (!poi?.audio_url) return;

    setTourState("narrating");
    setCurrentSegmentIndex(index);
    setTriggeredPois((prev) => new Set(prev).add(poi.id));

    playAudio(poi.audio_url, () => {
      // Check queue for passed POIs
      if (poiQueueRef.current.length > 0) {
        const nextIdx = poiQueueRef.current.shift()!;
        playPoiAudio(nextIdx);
        return;
      }

      // Check if all POIs played
      const allPlayed = pois.every((p) => triggeredPois.has(p.id) || p.id === poi.id);
      if (allPlayed && route?.closing_audio_url) {
        setTourState("closing");
        setCurrentSegmentIndex(pois.length);
        playAudio(route.closing_audio_url, () => {
          setTourState("completed");
        });
      } else {
        setTourState("navigating");
      }
    });
  }, [pois, route, playAudio, triggeredPois]);

  // Toggle play/pause
  const togglePlayPause = useCallback(async () => {
    if (tourState === "idle") {
      setDrivingMode(true);
      playWelcome();
      return;
    }

    if (soundRef.current) {
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded) {
        if (status.isPlaying) {
          await soundRef.current.pauseAsync();
        } else {
          await soundRef.current.playAsync();
        }
      }
    }
  }, [tourState, playWelcome]);

  // Exit driving mode
  const exitDrivingMode = useCallback(() => {
    setDrivingMode(false);
    if (decodedPath.length > 0 && mapControllerRef.current) {
      const lats = decodedPath.map((p) => p.lat);
      const lngs = decodedPath.map((p) => p.lng);
      mapControllerRef.current.moveCamera({
        target: {
          lat: (Math.min(...lats) + Math.max(...lats)) / 2,
          lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        },
        zoom: 12,
        tilt: 0,
        bearing: 0,
      });
    }
  }, [decodedPath]);

  // Current label
  const currentLabel = currentSegmentIndex === -1
    ? "Welcome"
    : currentSegmentIndex >= pois.length
      ? "Tour Complete"
      : pois[currentSegmentIndex]?.name || "";

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={colors.rideBlue} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <SafeAreaView edges={["top"]} style={[styles.header, { backgroundColor: isDark ? colors.nearBlack : "#fff" }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={{ color: theme.text, fontSize: 20 }}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.rideBlue }]}>
          Ride<Text style={{ color: colors.magicGreen }}>Magic</Text> ✦
        </Text>
        <View style={{ width: 40 }} />
      </SafeAreaView>

      {/* State bar */}
      <View style={[styles.stateBar, { backgroundColor: isDark ? colors.charcoal : "#f0f0f0" }]}>
        <View style={[styles.stateDot, {
          backgroundColor: tourState === "completed" ? colors.magicGreen :
            tourState === "narrating" ? colors.sunsetOrange :
            tourState === "idle" ? colors.warmGray : colors.rideBlue
        }]} />
        <Text style={[styles.stateText, { color: theme.textSecondary }]}>
          {STATE_LABELS[tourState] || tourState}
          {tourState === "navigating" && pois[currentSegmentIndex + 1] &&
            ` · Next: ${pois[currentSegmentIndex + 1]?.name}`}
        </Text>
      </View>

      {/* Map */}
      <NavMapView
        style={styles.map}
        onMapViewControllerCreated={onMapViewControllerCreated}
        initialCameraPosition={{
          target: { lat: route?.origin_lat || 37.7749, lng: route?.origin_lng || -122.4194 },
          zoom: 12,
        }}
      />

      {/* Map overlay buttons */}
      {drivingMode && (
        <View style={styles.mapButtons}>
          <TouchableOpacity
            style={[styles.mapButton, { backgroundColor: theme.surface }]}
            onPress={exitDrivingMode}
          >
            <Text style={{ color: theme.text, fontSize: 12 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom panel */}
      <View style={[styles.bottomPanel, { backgroundColor: isDark ? colors.nearBlack : "#fff" }]}>
        {/* POI chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipContainer}
        >
          <View style={[styles.chip, {
            backgroundColor: tourState === "welcome" || tourState !== "idle" ? colors.rideBlue : colors.charcoal,
          }]}>
            <Text style={styles.chipText}>Intro</Text>
          </View>

          {pois.filter((p) => !p.is_neighborhood_intro).map((poi) => {
            const isTriggered = triggeredPois.has(poi.id);
            const isCurrent = currentSegmentIndex === pois.indexOf(poi);
            const poiNumber = pois.filter((p, idx) => !p.is_neighborhood_intro && idx <= pois.indexOf(poi)).length;

            return (
              <View key={poi.id} style={[styles.chip, {
                backgroundColor: isCurrent ? colors.sunsetOrange :
                  isTriggered ? colors.magicGreen : colors.charcoal,
              }]}>
                <Text style={styles.chipText}>{poiNumber}. {poi.name.substring(0, 20)}{poi.name.length > 20 ? "…" : ""}</Text>
              </View>
            );
          })}

          <View style={[styles.chip, {
            backgroundColor: tourState === "closing" || tourState === "completed" ? colors.magicGreen : colors.charcoal,
          }]}>
            <Text style={styles.chipText}>Closing</Text>
          </View>
        </ScrollView>

        {/* Now playing info */}
        <View style={styles.nowPlaying}>
          <View style={[styles.nowPlayingIcon, { backgroundColor: isDark ? colors.charcoal : "#f0f0f0" }]}>
            <Text style={{ fontSize: 20 }}>✦</Text>
          </View>
          <View style={styles.nowPlayingInfo}>
            <Text style={[styles.nowPlayingTitle, { color: theme.text }]} numberOfLines={1}>
              {currentLabel}
            </Text>
            <Text style={[styles.nowPlayingSub, { color: theme.textSecondary }]}>
              {tourState === "idle" ? "Tap play to start"
                : tourState === "navigating" ? "Driving..."
                : tourState === "completed" ? "Thanks for riding!"
                : `POI ${currentSegmentIndex + 1} of ${pois.filter(p => !p.is_neighborhood_intro).length}`}
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: isDark ? colors.charcoal : "#e0e0e0" }]}>
            <View style={[styles.progressFill, {
              width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%",
              backgroundColor: colors.rideBlue,
            }]} />
          </View>
          <View style={styles.timeRow}>
            <Text style={[styles.timeText, { color: theme.textSecondary }]}>{formatTime(currentTime)}</Text>
            <Text style={[styles.timeText, { color: theme.textSecondary }]}>{formatTime(duration)}</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlButton}>
            <Text style={{ color: theme.text, fontSize: 24 }}>⏮</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
            <Text style={{ fontSize: 24 }}>{isPlaying ? "⏸" : "▶"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton}>
            <Text style={{ color: theme.text, fontSize: 24 }}>⏭</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  backButton: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: fontSize.md, fontWeight: "700" },
  stateBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  stateDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  stateText: { fontSize: fontSize.xs },
  map: { flex: 1 },
  mapButtons: {
    position: "absolute",
    right: 16,
    top: 140,
    gap: 8,
  },
  mapButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  bottomPanel: {
    paddingBottom: 30,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  chipContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.xl,
    marginRight: spacing.sm,
  },
  chipText: { color: "#fff", fontSize: fontSize.xs, fontWeight: "600" },
  nowPlaying: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  nowPlayingIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.md,
  },
  nowPlayingInfo: { flex: 1 },
  nowPlayingTitle: { fontSize: fontSize.md, fontWeight: "700" },
  nowPlayingSub: { fontSize: fontSize.xs, marginTop: 2 },
  progressContainer: { paddingHorizontal: spacing.md },
  progressBar: { height: 3, borderRadius: 1.5, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 1.5 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  timeText: { fontSize: 10 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    gap: spacing.xl,
  },
  controlButton: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  originMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  originDot: { width: 8, height: 8, borderRadius: 4 },
  poiMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  poiMarkerText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  userMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(37, 99, 235, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  userArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 16,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: colors.rideBlue,
  },
});

// Map styles
const lightMapStyle = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
];
