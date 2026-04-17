import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { MapView } from "@googlemaps/react-native-navigation-sdk";
import type { MapViewController } from "@googlemaps/react-native-navigation-sdk";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { ENV } from "../../src/config/env";
import { colors, fontSize, spacing, borderRadius } from "../../src/theme";
import { getMarkerPaths } from "../../src/lib/markerAssets";
import { useAuth } from "../../src/hooks/useAuth";
import { useTheme } from "../../src/hooks/useTheme";
import { useActiveTour } from "../../src/hooks/useActiveTour";
import { supabase } from "../../src/lib/supabase";

// ─── Helpers ────────────────────────────────────────────────

function getGradientColor(factor: number): string {
  const stops = [[124, 92, 252], [0, 120, 255], [0, 232, 157]];
  const segment = factor < 0.5 ? 0 : 1;
  const localFactor = factor < 0.5 ? factor * 2 : (factor - 0.5) * 2;
  const from = stops[segment];
  const to = stops[segment + 1];
  const r = Math.round(from[0] + (to[0] - from[0]) * localFactor);
  const g = Math.round(from[1] + (to[1] - from[1]) * localFactor);
  const b = Math.round(from[2] + (to[2] - from[2]) * localFactor);
  return `rgb(${r}, ${g}, ${b})`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const fLat = (from.lat * Math.PI) / 180;
  const tLat = (to.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(tLat);
  const x = Math.cos(fLat) * Math.sin(tLat) - Math.sin(fLat) * Math.cos(tLat) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

/** Build a cumulative-distance array for the polyline so we can index by meters. */
function buildDistanceTable(path: { lat: number; lng: number }[]): number[] {
  const dist = [0];
  for (let i = 1; i < path.length; i++) {
    dist.push(dist[i - 1] + haversineM(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng));
  }
  return dist;
}

/** Interpolate a position along the polyline at the given meter offset. */
function positionAtDistance(
  path: { lat: number; lng: number }[],
  distTable: number[],
  meters: number
): { lat: number; lng: number } {
  if (meters <= 0) return path[0];
  if (meters >= distTable[distTable.length - 1]) return path[path.length - 1];

  // Binary search for the segment
  let lo = 0, hi = distTable.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (distTable[mid] <= meters) lo = mid;
    else hi = mid;
  }

  const segLen = distTable[hi] - distTable[lo];
  const t = segLen > 0 ? (meters - distTable[lo]) / segLen : 0;
  return {
    lat: path[lo].lat + (path[hi].lat - path[lo].lat) * t,
    lng: path[lo].lng + (path[hi].lng - path[lo].lng) * t,
  };
}

/** Find the closest polyline index to a given POI lat/lng. */
function findClosestPolylineIndex(
  poi: { lat: number; lng: number },
  distTable: number[],
  path: { lat: number; lng: number }[]
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineM(poi.lat, poi.lng, path[i].lat, path[i].lng);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return distTable[bestIdx];
}

// ─── Types ──────────────────────────────────────────────────

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

type SimState = "idle" | "welcome" | "navigating" | "narrating" | "closing" | "completed";

// State labels kept for the "now playing" subtitle
const STATE_LABEL: Record<SimState, string> = {
  idle: "Tap play to start",
  welcome: "Welcome",
  navigating: "Driving...",
  narrating: "Now playing",
  closing: "Wrapping up",
  completed: "Thanks for riding!",
};

const TRIGGER_RADIUS_M = 200;
const POI_GAP_MS = 2500;
const SIM_TICK_MS = 50; // update chevron position every 50ms

// ─── Component ──────────────────────────────────────────────

export default function TourScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isDark, theme } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { startTour, stopTour } = useActiveTour();
  const mapControllerRef = useRef<MapViewController | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const insets = useSafeAreaInsets();

  // ─── Data ─────────────────────────────────────────────────
  const [route, setRoute] = useState<RouteData | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [decodedPath, setDecodedPath] = useState<{ lat: number; lng: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── Simulation state ─────────────────────────────────────
  const [simState, setSimState] = useState<SimState>("idle");
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [triggeredPois, setTriggeredPois] = useState<Set<string>>(new Set());

  // ─── Audio refs ───────────────────────────────────────────
  const soundRef = useRef<Audio.Sound | null>(null);
  const bgMusicRef = useRef<Audio.Sound | null>(null);

  // ─── Simulation engine refs ───────────────────────────────
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simDistanceRef = useRef(0); // meters traveled along polyline
  const distTableRef = useRef<number[]>([]);
  const poiDistancesRef = useRef<{ poi: POI; distM: number }[]>([]);
  const triggeredRef = useRef<Set<string>>(new Set());
  const poiQueueRef = useRef<POI[]>([]);
  const isPlayingPoiRef = useRef(false);
  const isPausedRef = useRef(false);
  const totalRouteDistRef = useRef(0);

  // Speed: meters per SIM_TICK_MS. We compute this from the total route distance
  // and the approximate audio duration so the car arrives at the destination
  // roughly when all audio has played.
  const simSpeedRef = useRef(0);

  const onMapViewControllerCreated = useCallback((controller: MapViewController) => {
    mapControllerRef.current = controller;
    setMapReady(true);
  }, []);

  // ─── Fetch data ───────────────────────────────────────────
  useEffect(() => {
    if (!user || !id) return;
    (async () => {
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

        // Pre-compute distance table + POI positions along the polyline
        const dt = buildDistanceTable(path);
        distTableRef.current = dt;
        totalRouteDistRef.current = dt[dt.length - 1] || 0;
      }
      if (poiData) {
        const sorted = (poiData as POI[]).filter((p) => !p.is_neighborhood_intro);
        setPois(poiData as POI[]);

        // Pre-compute each visible POI's distance along the polyline
        if (routeData) {
          const path = decodePolyline(routeData.polyline);
          const dt = buildDistanceTable(path);
          poiDistancesRef.current = sorted.map((poi) => ({
            poi,
            distM: findClosestPolylineIndex({ lat: poi.lat, lng: poi.lng }, dt, path),
          }));
        }
      }
      setLoading(false);
    })();
  }, [user, id]);

  // ─── Draw route on map ────────────────────────────────────
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (!controller || !mapReady || decodedPath.length < 2 || !route) return;

    const timer = setTimeout(async () => {
      // Gradient polyline
      try {
        const totalSegs = decodedPath.length - 1;
        const batchSize = Math.max(1, Math.floor(totalSegs / 40));
        for (let i = 0; i < totalSegs; i += batchSize) {
          const end = Math.min(i + batchSize + 1, decodedPath.length);
          const factor = i / totalSegs;
          const color = getGradientColor(factor);
          await controller.addPolyline({
            points: decodedPath.slice(i, end),
            color,
            width: 5,
          });
        }
      } catch (e) { console.warn("Tour polyline failed:", e); }

      // Markers
      try {
        const markers = getMarkerPaths();
        await controller.addMarker({
          position: { lat: route.origin_lat, lng: route.origin_lng },
          title: "Start",
          imgPath: markers.origin,
        });
        await controller.addMarker({
          position: { lat: route.destination_lat, lng: route.destination_lng },
          title: "Destination",
          imgPath: markers.destination,
        });
        const visible = pois.filter((p) => !p.is_neighborhood_intro);
        for (let i = 0; i < visible.length; i++) {
          const poi = visible[i];
          await controller.addMarker({
            position: { lat: poi.lat, lng: poi.lng },
            title: `${i + 1}. ${poi.name}`,
            imgPath: markers.poiBlue,
          });
        }
      } catch (e) { console.warn("Tour markers failed:", e); }

      // Fit to bounds
      const lats = decodedPath.map((p) => p.lat);
      const lngs = decodedPath.map((p) => p.lng);
      try {
        controller.moveCamera({
          target: {
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          },
          zoom: 12,
          tilt: 0,
          bearing: 0,
        });
      } catch {}
    }, 1000);

    return () => clearTimeout(timer);
  }, [decodedPath, pois, route, mapReady]);

  // ─── Audio setup ──────────────────────────────────────────
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

  // Keep screen awake during simulation
  useEffect(() => {
    if (simState !== "idle" && simState !== "completed") {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
  }, [simState]);

  // ─── Audio helpers ────────────────────────────────────────
  // Generation counter — each playSound call gets a unique ID.
  // If a newer call starts before the old one finishes, the old
  // callback is stale and ignored. This prevents overlapping audio.
  const audioGenRef = useRef(0);

  const playSound = useCallback(async (
    url: string,
    onFinish?: () => void,
    trackProgress?: boolean
  ): Promise<Audio.Sound | null> => {
    const gen = ++audioGenRef.current;

    try {
      // Stop + unload any previous sound
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
      }

      // If another playSound was called while we were cleaning up, abort
      if (gen !== audioGenRef.current) return null;

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
        trackProgress
          ? (status) => {
              if (gen !== audioGenRef.current) return; // stale callback
              if (status.isLoaded) {
                setCurrentTime(status.positionMillis / 1000);
                setDuration(status.durationMillis ? status.durationMillis / 1000 : 0);
                setIsPlaying(status.isPlaying);
                if (status.didJustFinish) onFinish?.();
              }
            }
          : (status) => {
              if (gen !== audioGenRef.current) return; // stale callback
              if (status.isLoaded && status.didJustFinish) onFinish?.();
            }
      );

      // If another playSound fired while we were creating this one, kill it
      if (gen !== audioGenRef.current) {
        sound.unloadAsync().catch(() => {});
        return null;
      }

      soundRef.current = sound;
      return sound;
    } catch (err) {
      if (gen === audioGenRef.current) {
        console.error("Audio playback error:", err);
        onFinish?.();
      }
      return null;
    }
  }, []);

  // ─── POI audio with queue ─────────────────────────────────
  const playPoiAudio = useCallback(async (poi: POI) => {
    if (!poi.audio_url) return;
    isPlayingPoiRef.current = true;
    setSimState("narrating");
    setCurrentSegmentIndex(pois.indexOf(poi));
    setTriggeredPois((prev) => new Set(prev).add(poi.id));

    try { await bgMusicRef.current?.setVolumeAsync(0.08); } catch {}

    await playSound(poi.audio_url, () => {
      try { bgMusicRef.current?.setVolumeAsync(0.4); } catch {}
      setTimeout(() => {
        const next = poiQueueRef.current.shift();
        if (next) {
          playPoiAudio(next);
        } else {
          isPlayingPoiRef.current = false;
          setSimState("navigating");
        }
      }, POI_GAP_MS);
    }, true);
  }, [pois, playSound]);

  // ─── Simulation tick — moves the chevron ──────────────────
  const simTick = useCallback(() => {
    if (isPausedRef.current) return;
    const controller = mapControllerRef.current;
    const path = decodedPath;
    const dt = distTableRef.current;
    if (!controller || path.length < 2 || dt.length < 2) return;

    // Advance position
    simDistanceRef.current += simSpeedRef.current;
    const totalDist = totalRouteDistRef.current;

    if (simDistanceRef.current >= totalDist) {
      // Reached destination
      simDistanceRef.current = totalDist;
      stopSimulation("closing");
      return;
    }

    const pos = positionAtDistance(path, dt, simDistanceRef.current);

    // Bearing from current to a point slightly ahead
    const lookAhead = positionAtDistance(path, dt, simDistanceRef.current + 20);
    const hdg = bearing(pos, lookAhead);

    // Move the chevron marker
    try {
      controller.addMarker({
        id: "sim-chevron",
        position: pos,
        rotation: hdg,
        flat: true,
        title: "",
        imgPath: getMarkerPaths().userArrow,
      });
    } catch {}

    // Camera follow
    try {
      controller.moveCamera({
        target: pos,
        zoom: 18,
        tilt: 45,
        bearing: hdg,
      });
    } catch {}

    // Check POI proximity
    for (const { poi } of poiDistancesRef.current) {
      if (triggeredRef.current.has(poi.id)) continue;
      if (!poi.audio_url) continue;
      const poiPos = { lat: poi.lat, lng: poi.lng };
      const dist = haversineM(pos.lat, pos.lng, poiPos.lat, poiPos.lng);
      if (dist <= TRIGGER_RADIUS_M) {
        // Mark as triggered internally (so it won't re-fire) but DON'T
        // update the UI chips yet — that happens when the audio actually
        // starts playing inside playPoiAudio, not when it's detected/queued.
        triggeredRef.current.add(poi.id);
        if (isPlayingPoiRef.current) {
          poiQueueRef.current.push(poi);
        } else {
          playPoiAudio(poi);
        }
        break;
      }
    }
  }, [decodedPath, playPoiAudio]);

  // ─── Start / stop simulation ──────────────────────────────
  const stopSimulation = useCallback((nextState: SimState = "idle") => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }

    if (nextState === "closing" && route?.closing_audio_url) {
      setSimState("closing");
      setCurrentSegmentIndex(pois.length);
      playSound(route.closing_audio_url, () => {
        fullReset();
      }, true);
    } else if (nextState === "idle" || nextState === "completed") {
      fullReset();
    } else {
      setSimState(nextState);
    }
  }, [route, pois, playSound]);

  const fullReset = useCallback(() => {
    // Stop all audio
    soundRef.current?.unloadAsync().catch(() => {});
    bgMusicRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    bgMusicRef.current = null;

    // Clear simulation
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    simDistanceRef.current = 0;
    triggeredRef.current = new Set();
    poiQueueRef.current = [];
    isPlayingPoiRef.current = false;
    isPausedRef.current = false;

    // Reset UI
    setSimState("idle");
    setCurrentSegmentIndex(-1);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setTriggeredPois(new Set());

    stopTour();

    // Remove chevron marker + re-fit map to route overview
    // Skip map operations if the page is unmounting (navigating away)
    if (!mapControllerRef.current) return;
    try { mapControllerRef.current.clearMapView(); } catch {}

    // Redraw route after a tick (clearMapView is async-ish)
    setTimeout(() => {
      const controller = mapControllerRef.current;
      if (!controller || decodedPath.length < 2 || !route) return;

      // Redraw polyline
      const totalSegs = decodedPath.length - 1;
      const batchSize = Math.max(1, Math.floor(totalSegs / 40));
      (async () => {
        for (let i = 0; i < totalSegs; i += batchSize) {
          const end = Math.min(i + batchSize + 1, decodedPath.length);
          const factor = i / totalSegs;
          await controller.addPolyline({
            points: decodedPath.slice(i, end),
            color: getGradientColor(factor),
            width: 5,
          }).catch(() => {});
        }

        const markers = getMarkerPaths();
        await controller.addMarker({
          position: { lat: route.origin_lat, lng: route.origin_lng },
          title: "Start",
          imgPath: markers.origin,
        }).catch(() => {});
        await controller.addMarker({
          position: { lat: route.destination_lat, lng: route.destination_lng },
          title: "Destination",
          imgPath: markers.destination,
        }).catch(() => {});
        const visible = pois.filter((p) => !p.is_neighborhood_intro);
        for (let i = 0; i < visible.length; i++) {
          const poi = visible[i];
          await controller.addMarker({
            position: { lat: poi.lat, lng: poi.lng },
            title: `${i + 1}. ${poi.name}`,
            imgPath: markers.poiBlue,
          }).catch(() => {});
        }

        const lats = decodedPath.map((p) => p.lat);
        const lngs = decodedPath.map((p) => p.lng);
        controller.moveCamera({
          target: {
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          },
          zoom: 12,
          tilt: 0,
          bearing: 0,
        });
      })();
    }, 300);
  }, [decodedPath, pois, route, stopTour]);

  const startSimulation = useCallback(async () => {
    if (!route || decodedPath.length < 2) return;

    // Register with ActiveTourContext
    startTour(route.id, "simulating");

    // Configure audio
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    });

    // Calculate speed: total distance / estimated audio duration
    const visible = pois.filter((p) => !p.is_neighborhood_intro);
    const welcomeDur = 15; // ~15s estimated if no exact duration
    const closingDur = 10;
    const poiDur = visible.reduce((sum, p) => sum + (p.audio_duration_sec || 30), 0);
    const gapsDur = (visible.length * POI_GAP_MS) / 1000;
    const totalAudioSec = welcomeDur + poiDur + gapsDur + closingDur;
    const totalDist = totalRouteDistRef.current;

    // Meters per tick to match audio duration
    simSpeedRef.current = Math.max(0.5, (totalDist / totalAudioSec) * (SIM_TICK_MS / 1000));
    simDistanceRef.current = 0;
    triggeredRef.current = new Set();
    poiQueueRef.current = [];
    isPlayingPoiRef.current = false;
    isPausedRef.current = false;

    setSimState("welcome");
    setTriggeredPois(new Set());
    setCurrentSegmentIndex(-1);

    // Start background music
    if (route.music_track_id) {
      try {
        const { data: musicData } = await supabase
          .from("music_tracks")
          .select("audio_url")
          .eq("id", route.music_track_id)
          .single();
        if (musicData?.audio_url) {
          const { sound: music } = await Audio.Sound.createAsync(
            { uri: musicData.audio_url },
            { shouldPlay: true, isLooping: true, volume: 0.4 }
          );
          bgMusicRef.current = music;
        }
      } catch {}
    }

    // Start moving the car immediately AND play welcome audio at the same time
    simIntervalRef.current = setInterval(simTick, SIM_TICK_MS);

    if (route.welcome_audio_url) {
      try { await bgMusicRef.current?.setVolumeAsync(0.08); } catch {}
      await playSound(route.welcome_audio_url, () => {
        try { bgMusicRef.current?.setVolumeAsync(0.4); } catch {}
        setSimState("navigating");
      }, true);
    } else {
      setSimState("navigating");
      // simInterval already started above
    }
  }, [route, pois, decodedPath, playSound, simTick, startTour]);

  // ─── Play / Pause toggle ──────────────────────────────────
  const togglePlayPause = useCallback(async () => {
    if (simState === "idle") {
      startSimulation();
      return;
    }
    if (simState === "completed") return;

    if (isPausedRef.current) {
      // Resume
      isPausedRef.current = false;
      try {
        const s = soundRef.current;
        if (s) { const st = await s.getStatusAsync(); if (st.isLoaded && !st.isPlaying) await s.playAsync(); }
        const m = bgMusicRef.current;
        if (m) { const st = await m.getStatusAsync(); if (st.isLoaded && !st.isPlaying) await m.playAsync(); }
      } catch {}
      setIsPlaying(true);
    } else {
      // Pause
      isPausedRef.current = true;
      try {
        const s = soundRef.current;
        if (s) { const st = await s.getStatusAsync(); if (st.isLoaded && st.isPlaying) await s.pauseAsync(); }
        const m = bgMusicRef.current;
        if (m) { const st = await m.getStatusAsync(); if (st.isLoaded && st.isPlaying) await m.pauseAsync(); }
      } catch {}
      setIsPlaying(false);
    }
  }, [simState, startSimulation]);

  // ─── Skip forward / back ──────────────────────────────────
  const skipToPoiIndex = useCallback(async (targetIdx: number) => {
    const visible = pois.filter((p) => !p.is_neighborhood_intro);
    if (targetIdx < 0 || targetIdx >= visible.length) return;
    if (simState === "idle" || simState === "completed") return;

    const target = visible[targetIdx];
    const entry = poiDistancesRef.current.find((e) => e.poi.id === target.id);
    if (!entry) return;

    // Jump the chevron to the POI position
    simDistanceRef.current = entry.distM;

    // Rebuild triggered set: only POIs BEFORE the target are "done" (green).
    const newTriggered = new Set<string>();
    for (let i = 0; i < targetIdx; i++) {
      newTriggered.add(visible[i].id);
    }
    triggeredRef.current = newTriggered;
    setTriggeredPois(new Set(newTriggered));

    // Clear the queue + reset playing flag — playSound's generation counter
    // handles killing any in-flight audio, so we just reset our state here.
    poiQueueRef.current = [];
    isPlayingPoiRef.current = false;

    // Play the target POI — playSound internally stops+unloads any previous
    // audio and ignores stale callbacks via the generation counter.
    playPoiAudio(target);
  }, [pois, simState, playPoiAudio]);

  const skipForward = useCallback(() => {
    const visible = pois.filter((p) => !p.is_neighborhood_intro);
    const currentIdx = currentSegmentIndex >= 0
      ? visible.findIndex((p) => p === pois[currentSegmentIndex])
      : -1;
    skipToPoiIndex(currentIdx + 1);
  }, [pois, currentSegmentIndex, skipToPoiIndex]);

  const skipBack = useCallback(() => {
    const visible = pois.filter((p) => !p.is_neighborhood_intro);
    const currentIdx = currentSegmentIndex >= 0
      ? visible.findIndex((p) => p === pois[currentSegmentIndex])
      : 0;
    skipToPoiIndex(Math.max(0, currentIdx - 1));
  }, [pois, currentSegmentIndex, skipToPoiIndex]);

  // ─── Cleanup on unmount ───────────────────────────────────
  useEffect(() => {
    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      soundRef.current?.unloadAsync().catch(() => {});
      bgMusicRef.current?.unloadAsync().catch(() => {});
      stopTour();
    };
  }, [stopTour]);

  // ─── Current label for now-playing bar ────────────────────
  const visiblePois = pois.filter((p) => !p.is_neighborhood_intro);
  const currentLabel = simState === "idle" ? "Welcome"
    : simState === "welcome" ? "Welcome"
    : simState === "closing" || simState === "completed" ? "Tour Complete"
    : currentSegmentIndex >= 0 && currentSegmentIndex < pois.length
      ? pois[currentSegmentIndex]?.name || ""
      : "Driving...";

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={colors.rideBlue} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Map — full screen, no header */}
      <MapView
        style={styles.map}
        onMapViewControllerCreated={onMapViewControllerCreated}
        mapId="da9e1e4ff9cfa0ff3017deab"
        initialCameraPosition={{
          target: { lat: route?.origin_lat || 37.7749, lng: route?.origin_lng || -122.4194 },
          zoom: 12,
        }}
      />

      {/* Back button — floating on the map */}
      <TouchableOpacity
        style={[styles.mapBackButton, { top: insets.top + 12 }]}
        onPress={() => {
          if (simIntervalRef.current) clearInterval(simIntervalRef.current);
          soundRef.current?.unloadAsync().catch(() => {});
          bgMusicRef.current?.unloadAsync().catch(() => {});
          stopTour();
          router.back();
        }}
      >
        <Text style={styles.mapBackText}>‹</Text>
      </TouchableOpacity>

      {/* Bottom panel */}
      <View style={[styles.bottomPanel, { backgroundColor: isDark ? colors.nearBlack : "#fff", paddingBottom: insets.bottom + 16 }]}>
        {/* POI chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipContainer}
        >
          <View style={[styles.chip, {
            backgroundColor: simState === "welcome" || simState !== "idle" ? colors.rideBlue : colors.charcoal,
          }]}>
            <Text style={styles.chipText}>Intro</Text>
          </View>

          {visiblePois.map((poi, idx) => {
            const isTriggered = triggeredPois.has(poi.id);
            const isNowPlaying = simState === "narrating" && currentSegmentIndex === pois.indexOf(poi);

            let chipColor = colors.charcoal; // default: not yet reached
            if (isNowPlaying) chipColor = colors.sunsetOrange; // currently narrating
            else if (isTriggered) chipColor = colors.magicGreen; // done

            return (
              <TouchableOpacity
                key={poi.id}
                onPress={() => { if (simState !== "idle") skipToPoiIndex(idx); }}
                style={[styles.chip, {
                  backgroundColor: chipColor,
                  borderWidth: isNowPlaying ? 2 : 0,
                  borderColor: "#fff",
                }]}
              >
                <Text style={styles.chipText}>
                  {isNowPlaying ? "▶ " : ""}{idx + 1}. {poi.name.substring(0, 20)}{poi.name.length > 20 ? "…" : ""}
                </Text>
              </TouchableOpacity>
            );
          })}

          <View style={[styles.chip, {
            backgroundColor: simState === "closing" || simState === "completed" ? colors.magicGreen : colors.charcoal,
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
              {simState === "narrating"
                ? `POI ${(visiblePois.findIndex((p) => p === pois[currentSegmentIndex]) + 1) || "?"} of ${visiblePois.length}`
                : STATE_LABEL[simState]}
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
          <TouchableOpacity style={styles.controlButton} onPress={skipBack}>
            <View style={styles.skipIcon}>
              <View style={[styles.skipBar, { backgroundColor: theme.text, marginRight: 2 }]} />
              <View style={[styles.skipPrev, { borderRightColor: theme.text }]} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={togglePlayPause} activeOpacity={0.8}>
            <LinearGradient
              colors={["#7C5CFC", "#0078FF", "#00E89D"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.playButton}
            >
              {simState !== "idle" && !isPausedRef.current && simState !== "completed" ? (
                <View style={styles.pauseIcon}>
                  <View style={styles.pauseBar} />
                  <View style={styles.pauseBar} />
                </View>
              ) : (
                <View style={[styles.playTriangle, { marginLeft: 3 }]} />
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={skipForward}>
            <View style={styles.skipIcon}>
              <View style={[styles.skipNext, { borderLeftColor: theme.text }]} />
              <View style={[styles.skipBar, { backgroundColor: theme.text, marginLeft: 2 }]} />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  mapBackButton: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  mapBackText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginTop: -2,
  },
  stateBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  stateDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  stateText: { fontSize: fontSize.xs },
  map: { flex: 1 },
  bottomPanel: {
    paddingBottom: 34,
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
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 16,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#fff",
  },
  pauseIcon: {
    flexDirection: "row",
    gap: 4,
  },
  pauseBar: {
    width: 4,
    height: 18,
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  skipIcon: {
    flexDirection: "row",
    alignItems: "center",
  },
  skipPrev: {
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderRightWidth: 12,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  skipNext: {
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 12,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  skipBar: {
    width: 3,
    height: 16,
    borderRadius: 1.5,
  },
});
