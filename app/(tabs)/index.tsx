import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  PanResponder,
  Keyboard,
  FlatList,
  Image,
} from "react-native";
import * as Location from "expo-location";
import {
  NavigationView,
  useNavigation,
  CameraPerspective,
  TravelMode,
  AudioGuidance,
  NavigationNightMode,
  NavigationUIEnabledPreference,
} from "@googlemaps/react-native-navigation-sdk";
import type {
  MapViewController,
  NavigationViewController,
} from "@googlemaps/react-native-navigation-sdk";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { ENV } from "../../src/config/env";
import { colors, spacing, fontSize, borderRadius } from "../../src/theme";
import { getMarkerPaths } from "../../src/lib/markerAssets";
import { useAuth } from "../../src/hooks/useAuth";
import { useTheme } from "../../src/hooks/useTheme";
import { useActiveTour } from "../../src/hooks/useActiveTour";
import { supabase } from "../../src/lib/supabase";
import * as api from "../../src/services/api";

// Note: the SDK's `mapStyle` prop is broken (expects a remote URL that returns
// JSON, not inline JSON) — we use the native `mapColorScheme` prop instead,
// which is the proper Google Maps API for switching light/dark. Trade-off:
// we lose the POI label hiding that a custom style gave us.

// 3-stop brand gradient: #7C5CFC → #0078FF → #00E89D
function getGradientColor(factor: number): string {
  const stops = [
    [124, 92, 252],
    [0, 120, 255],
    [0, 232, 157],
  ];
  const segment = factor < 0.5 ? 0 : 1;
  const localFactor = factor < 0.5 ? factor * 2 : (factor - 0.5) * 2;
  const from = stops[segment];
  const to = stops[segment + 1];
  const r = Math.round(from[0] + (to[0] - from[0]) * localFactor);
  const g = Math.round(from[1] + (to[1] - from[1]) * localFactor);
  const b = Math.round(from[2] + (to[2] - from[2]) * localFactor);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function HomeScreen() {
  const { isDark, theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ liveTourId?: string }>();
  const { user, loading: authLoading } = useAuth();
  const { startTour: setActiveTour, stopTour: clearActiveTour } = useActiveTour();
  const mapControllerRef = useRef<MapViewController | null>(null);
  const navViewControllerRef = useRef<NavigationViewController | null>(null);
  const insets = useSafeAreaInsets();

  const [origin, setOrigin] = useState("Current Location");
  const [destination, setDestination] = useState("");
  const [originInput, setOriginInput] = useState("");
  const [destInput, setDestInput] = useState("");
  const [originSuggestions, setOriginSuggestions] = useState<any[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<any[]>([]);
  const [activeField, setActiveField] = useState<"origin" | "dest" | null>(null);
  const [showOriginField, setShowOriginField] = useState(false);
  const [routeData, setRouteData] = useState<any>(null);
  const [pois, setPois] = useState<any[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [loadingTour, setLoadingTour] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [navViewReady, setNavViewReady] = useState(false);
  const [isDriving, setIsDriving] = useState(false);
  const [tourPaused, setTourPaused] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  const bgMusicRef = useRef<Audio.Sound | null>(null);
  // Pre-loaded POI audio, keyed by POI id. Populated in handleStartTour during
  // the "Preparing Audio..." phase so playback is instant when geofence fires.
  const poiSoundsRef = useRef<Record<string, Audio.Sound>>({});
  const triggeredPoisRef = useRef<Set<string>>(new Set());
  const [tourPois, setTourPois] = useState<any[]>([]);
  const [tourLoadingLabel, setTourLoadingLabel] = useState("Generating Tour...");

  // Current POI being narrated during driving — drives the POI detail panel
  const [currentDrivingPoi, setCurrentDrivingPoi] = useState<any>(null);
  const [poiPanelExpanded, setPoiPanelExpanded] = useState(true);
  const [poiPhotoUrl, setPoiPhotoUrl] = useState<string | null>(null);
  const poiPhotoCache = useRef<Record<string, string>>({});
  // Ref callback so the geofencing closure (inside nav effect) can update React state
  const setCurrentDrivingPoiRef = useRef(setCurrentDrivingPoi);
  useEffect(() => { setCurrentDrivingPoiRef.current = setCurrentDrivingPoi; }, [setCurrentDrivingPoi]);

  // Fetch Google Places photo when the active driving POI changes
  useEffect(() => {
    if (!currentDrivingPoi?.place_id) {
      setPoiPhotoUrl(null);
      return;
    }
    const placeId = currentDrivingPoi.place_id;

    // Use cached URL if available
    if (poiPhotoCache.current[placeId]) {
      setPoiPhotoUrl(poiPhotoCache.current[placeId]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=photos&key=${ENV.GOOGLE_MAPS_API_KEY}`
        );
        const data = await res.json();
        const photoRef = data?.result?.photos?.[0]?.photo_reference;
        if (cancelled) return;
        if (photoRef) {
          const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${photoRef}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
          poiPhotoCache.current[placeId] = url;
          setPoiPhotoUrl(url);
        } else {
          // No photo available — fall back to static map
          const fallback = `https://maps.googleapis.com/maps/api/staticmap?center=${currentDrivingPoi.lat},${currentDrivingPoi.lng}&zoom=17&size=600x200&maptype=roadmap&markers=color:0x0078FF|${currentDrivingPoi.lat},${currentDrivingPoi.lng}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
          poiPhotoCache.current[placeId] = fallback;
          setPoiPhotoUrl(fallback);
        }
      } catch {
        if (!cancelled) setPoiPhotoUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentDrivingPoi]);

  // Ref mirror of tourPois so the geofence listener can read fresh data
  // without having to re-register when tourPois updates.
  const tourPoisRef = useRef<any[]>([]);
  useEffect(() => { tourPoisRef.current = tourPois; }, [tourPois]);

  // POI audio queue — POIs that triggered while another narration is playing
  // wait here until the current one finishes (plus a small gap), rather than
  // interrupting each other. Matches the tour page's queue pattern.
  const poiQueueRef = useRef<any[]>([]);
  const isPlayingPoiRef = useRef(false);
  const POI_GAP_MS = 2500; // silent gap between consecutive POI narrations
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originInputRef = useRef<TextInput>(null);
  const destInputRef = useRef<TextInput>(null);

  // Collapsible panel
  const [panelOpen, setPanelOpen] = useState(true);
  const panelAnim = useRef(new Animated.Value(0)).current;
  const panelTouchStartY = useRef(0);
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardUp(true);
      Animated.spring(keyboardOffsetAnim, {
        toValue: e.endCoordinates.height,
        useNativeDriver: false,
        tension: 65,
        friction: 11,
      }).start();
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardUp(false);
      Animated.spring(keyboardOffsetAnim, {
        toValue: 0,
        useNativeDriver: false,
        tension: 65,
        friction: 11,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [keyboardOffsetAnim]);

  const togglePanel = useCallback((open: boolean) => {
    if (!open) Keyboard.dismiss();
    setPanelOpen(open);
    Animated.spring(panelAnim, {
      toValue: open ? 0 : 1,
      useNativeDriver: false,
      tension: 65,
      friction: 11,
    }).start();
  }, [panelAnim]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 10,
      onPanResponderGrant: (_, gestureState) => {
        panelTouchStartY.current = gestureState.y0;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 50) togglePanel(false);
        else if (gestureState.dy < -50) togglePanel(true);
      },
    })
  ).current;

  const fetchSuggestions = useCallback((input: string, field: "origin" | "dest") => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input || input.length < 2) {
      if (field === "origin") setOriginSuggestions([]);
      else setDestSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await api.getPlaceSuggestions(input, userLoc || undefined);
      if (field === "origin") setOriginSuggestions(results);
      else setDestSuggestions(results);
    }, 200);
  }, [userLoc]);

  const selectSuggestion = useCallback((suggestion: any, field: "origin" | "dest") => {
    if (field === "origin") {
      setOrigin(suggestion.description);
      setOriginInput(suggestion.description);
      setOriginSuggestions([]);
      originInputRef.current?.blur();
    } else {
      setDestination(suggestion.description);
      setDestInput(suggestion.description);
      setDestSuggestions([]);
      destInputRef.current?.blur();
    }
    setActiveField(null);
    if (routeData) {
      setRouteData(null); setPois([]); setTourReady(false); setRouteId(null);
      if (mapControllerRef.current) Promise.resolve(mapControllerRef.current.clearMapView() as any).catch(() => undefined);
    }
  }, [routeData]);

  // Redirect to auth if not logged in
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!authLoading && !user && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/(auth)/login");
    }
  }, [user, authLoading]);

  // Handle liveTourId param from My Routes → "Live Tour" button.
  // Loads route data from Supabase and pre-fills state so Start Tour is ready.
  const liveTourHandledRef = useRef<string | null>(null);
  useEffect(() => {
    const liveTourId = params.liveTourId;
    if (!liveTourId || !user || liveTourHandledRef.current === liveTourId) return;
    liveTourHandledRef.current = liveTourId;

    (async () => {
      try {
        const { data: route } = await supabase
          .from("routes")
          .select("id, origin_address, destination_address, origin_lat, origin_lng, destination_lat, destination_lng, polyline, total_distance_m, total_duration_sec")
          .eq("id", liveTourId)
          .single();
        if (!route) return;

        const { data: poiData } = await supabase
          .from("route_pois")
          .select("id, name, lat, lng, types, place_id, audio_url")
          .eq("route_id", liveTourId)
          .order("sequence_order", { ascending: true });

        // Build routeData in the same shape as getDirections()
        setOrigin(route.origin_address);
        setDestination(route.destination_address);
        setRouteData({
          polyline: route.polyline,
          distanceM: route.total_distance_m,
          durationSec: route.total_duration_sec,
          originLat: route.origin_lat,
          originLng: route.origin_lng,
          destinationLat: route.destination_lat,
          destinationLng: route.destination_lng,
          decodedPath: route.polyline ? api.decodePolyline(route.polyline) : [],
        });
        setPois(poiData?.map((p: any) => ({
          ...p,
          location: { lat: p.lat, lng: p.lng },
        })) || []);
        setRouteId(liveTourId);
        setShowOriginField(true);
      } catch (e) {
        console.warn("Failed to load live tour:", e);
      }
    })();
  }, [params.liveTourId, user]);

  const onMapViewControllerCreated = useCallback((controller: MapViewController) => {
    mapControllerRef.current = controller;
    setMapReady(true);
  }, []);

  // Compute map padding so native UI (compass, my-location, etc.) respects:
  //  - top safe area (avoid system clock)
  //  - POI panel bottom (when driving + panel expanded)
  // Applied via the `mapPadding` prop on NavigationView below.
  const mapPadding = {
    top: insets.top + 8,
    left: 0,
    right: 0,
    bottom: isDriving
      ? currentDrivingPoi
        ? poiPanelExpanded ? 230 : 60
        : poiPanelExpanded ? 100 : 60
      : 0,
  };

  // Get user's current location and move camera to it once the map is ready
  useEffect(() => {
    if (!mapReady) return;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setUserLoc(coords);
      // Small delay to ensure native MapView is fully attached before moveCamera
      setTimeout(() => {
        const c = mapControllerRef.current;
        if (!c) return;
        Promise.resolve(c.moveCamera({
          target: coords,
          zoom: 14,
          tilt: 0,
          bearing: 0,
        }) as any).catch(() => undefined);
      }, 1000);
    })();
  }, [mapReady]);

  // Reusable draw function — paints the polyline, markers, and fits the camera to the route.
  // Called by the useEffect below (on route change), handleStartTour (driving entry),
  // and handleExitDriving (on exit).
  //
  // Options:
  //   hideOrigin — skip the green origin marker (used in driving mode so the user's
  //     real position marker isn't hidden under a static start circle)
  //   hidePolyline — skip the gradient preview polyline (Nav SDK draws its own
  //     route line during guidance, no need to duplicate)
  //   fitCamera — whether to move the camera to fit the route bounds (skipped
  //     during driving mode since the Nav SDK manages camera follow)
  const drawRouteOnMap = useCallback(async (opts?: {
    hideOrigin?: boolean;
    hidePolyline?: boolean;
    fitCamera?: boolean;
  }) => {
    const controller = mapControllerRef.current;
    if (!controller || !routeData?.decodedPath) return;

    const hideOrigin = opts?.hideOrigin ?? false;
    const hidePolyline = opts?.hidePolyline ?? false;
    const fitCamera = opts?.fitCamera ?? true;

    const coordinates = routeData.decodedPath.map((p: any) => ({
      lat: p.lat,
      lng: p.lng,
    }));

    // Clear anything previously drawn so repeat draws don't stack
    Promise.resolve(controller.clearMapView() as any).catch(() => undefined);

    // Draw gradient polyline in segments (Google Nav SDK = one color per polyline)
    if (!hidePolyline) {
      try {
        const totalSegs = coordinates.length - 1;
        const batchSize = Math.max(1, Math.floor(totalSegs / 40));
        for (let i = 0; i < totalSegs; i += batchSize) {
          const end = Math.min(i + batchSize + 1, coordinates.length);
          const factor = i / totalSegs;
          const color = getGradientColor(factor);
          await controller.addPolyline({
            points: coordinates.slice(i, end),
            color,
            width: 5,
          });
        }
      } catch (e) {
        console.warn("Polyline failed:", e);
      }
    }

    // Draw markers
    try {
      const markers = getMarkerPaths();
      if (!hideOrigin) {
        await controller.addMarker({
          position: { lat: routeData.originLat, lng: routeData.originLng },
          title: "Start",
          imgPath: markers.origin,
        });
      }
      await controller.addMarker({
        position: { lat: routeData.destinationLat, lng: routeData.destinationLng },
        title: "Destination",
        imgPath: markers.destination,
      });
      for (const poi of pois) {
        await controller.addMarker({
          position: { lat: poi.location.lat, lng: poi.location.lng },
          title: poi.name,
          imgPath: markers.poiBlue,
        });
      }
    } catch (e) {
      console.warn("Markers failed:", e);
    }

    // Skip camera fit if caller doesn't want it (e.g. driving mode — Nav SDK controls camera)
    if (!fitCamera) return;

    // Fit camera to route bounds + bearing so destination is up
    if (coordinates.length > 1) {
      const lats = coordinates.map((c: any) => c.lat);
      const lngs = coordinates.map((c: any) => c.lng);

      const oLat = (routeData.originLat * Math.PI) / 180;
      const dLat = (routeData.destinationLat * Math.PI) / 180;
      const dLng = ((routeData.destinationLng - routeData.originLng) * Math.PI) / 180;
      const y = Math.sin(dLng) * Math.cos(dLat);
      const x = Math.cos(oLat) * Math.sin(dLat) - Math.sin(oLat) * Math.cos(dLat) * Math.cos(dLng);
      const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

      const latSpan = Math.max(...lats) - Math.min(...lats);
      const lngSpan = Math.max(...lngs) - Math.min(...lngs);
      const maxSpan = Math.max(latSpan, lngSpan);
      const zoom = maxSpan < 0.005 ? 17
        : maxSpan < 0.01 ? 16
        : maxSpan < 0.02 ? 15
        : maxSpan < 0.04 ? 14
        : maxSpan < 0.08 ? 13
        : maxSpan < 0.16 ? 12
        : maxSpan < 0.3 ? 11
        : maxSpan < 0.6 ? 10
        : 9;

      Promise.resolve(controller.moveCamera({
        target: {
          lat: (Math.min(...lats) + Math.max(...lats)) / 2,
          lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        },
        zoom,
        bearing,
        tilt: 0,
      }) as any).catch(() => undefined);
    }
  }, [routeData, pois]);

  // Draw the route on the map whenever routeData or pois change
  useEffect(() => {
    if (!mapReady || !routeData?.decodedPath) return;
    const timer = setTimeout(() => {
      drawRouteOnMap().catch((e) => console.warn("Draw route failed:", e));
    }, 1000);
    return () => clearTimeout(timer);
  }, [routeData, pois, mapReady, drawRouteOnMap]);

  // Google Navigation SDK — start native turn-by-turn driving
  const { navigationController, setOnLocationChanged } = useNavigation();

  useEffect(() => {
    if (!isDriving || !routeData || !navViewReady) return;

    let cancelled = false;
    const TRIGGER_RADIUS_M = 300;

    // ── Audio playback engine ──
    let audioGen = 0;

    const playPoiAudio = async (poi: any) => {
      const gen = ++audioGen;
      isPlayingPoiRef.current = true;
      setCurrentDrivingPoiRef.current(poi);
      try {
        try { await bgMusicRef.current?.setVolumeAsync(0.08); } catch {}

        // Stop but DON'T unload the previous sound if it's a pre-loaded POI
        // sound — we want to keep it cached for potential replay. Only unload
        // dynamically-created sounds.
        if (soundRef.current) {
          try { await soundRef.current.stopAsync(); } catch {}
          soundRef.current = null;
        }

        if (gen !== audioGen) return;

        // Use pre-loaded sound if available, otherwise create on-demand.
        let sound = poiSoundsRef.current[poi.id];
        if (sound) {
          try {
            await sound.setPositionAsync(0);
            await sound.playAsync();
          } catch {
            // Pre-loaded sound is stale — fall back to createAsync
            sound = undefined as any;
          }
        }
        if (!sound) {
          const created = await Audio.Sound.createAsync(
            { uri: poi.audio_url },
            { shouldPlay: true }
          );
          sound = created.sound;
          poiSoundsRef.current[poi.id] = sound;
        }

        if (gen !== audioGen) {
          try { await sound.stopAsync(); } catch {}
          return;
        }

        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: any) => {
          if (gen !== audioGen) return;
          if (status.isLoaded && status.didJustFinish) {
            try { bgMusicRef.current?.setVolumeAsync(0.4); } catch {}
            setTimeout(() => {
              if (gen !== audioGen) return;
              const next = poiQueueRef.current.shift();
              if (next) {
                console.log(`[Nav] ▶ Playing queued "${next.name}"`);
                playPoiAudio(next);
              } else {
                isPlayingPoiRef.current = false;
                setCurrentDrivingPoiRef.current(null);
              }
            }, POI_GAP_MS);
          }
        });
      } catch (e: any) {
        if (gen !== audioGen) return;
        console.warn(`[Nav] POI audio failed for "${poi.name}":`, e?.message || e);
        isPlayingPoiRef.current = false;
        const next = poiQueueRef.current.shift();
        if (next) playPoiAudio(next);
      }
    };

    // ── Proximity geofencing ──
    const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
      const R = 6371000;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    let logCounter = 0;
    let lastLocKey = "";

    const handleLocationUpdate = (location: any) => {
      const locKey = `${location?.lat?.toFixed(5)},${location?.lng?.toFixed(5)}`;
      if (locKey === lastLocKey) return;
      lastLocKey = locKey;

      logCounter++;
      if (logCounter <= 3) {
        console.log(`[Nav] Location #${logCounter}: (${location?.lat},${location?.lng}) pois=${tourPoisRef.current.length}`);
      }
      const pois = tourPoisRef.current;
      if (pois.length === 0) return;

      const shouldLog = logCounter % 10 === 0;
      let closestDist = Infinity;
      let closestPoi: any = null;
      for (const poi of pois) {
        if (triggeredPoisRef.current.has(poi.id)) continue;
        if (!poi.audio_url) continue;
        const dist = haversine(location.lat, location.lng, poi.lat, poi.lng);
        if (dist < closestDist) {
          closestDist = dist;
          closestPoi = poi;
        }
        if (dist <= TRIGGER_RADIUS_M) {
          triggeredPoisRef.current.add(poi.id);
          if (isPlayingPoiRef.current) {
            poiQueueRef.current.push(poi);
            console.log(`[Nav] ⏳ QUEUED "${poi.name}" (${poiQueueRef.current.length} in queue)`);
          } else {
            console.log(`[Nav] ✅ TRIGGER "${poi.name}" at ${dist.toFixed(0)}m`);
            playPoiAudio(poi);
          }
          return;
        }
      }
      if (shouldLog) {
        console.log(
          `[Nav] loc=(${location.lat.toFixed(5)},${location.lng.toFixed(5)}) ` +
          `closest="${closestPoi?.name ?? "none"}" dist=${closestDist === Infinity ? "∞" : closestDist.toFixed(0) + "m"}`
        );
      }
    };

    // Register listeners immediately
    setOnLocationChanged(handleLocationUpdate);

    // ── Async navigation setup (single destination — clean route) ──
    const startNavigation = async () => {
      try {
        const termsAccepted = await navigationController.areTermsAccepted();
        if (!termsAccepted) {
          await navigationController.showTermsAndConditionsDialog();
        }
        if (cancelled) return;

        const status = await navigationController.init();
        console.log("Nav init status:", status);
        if (cancelled) return;

        await new Promise((resolve) => setTimeout(resolve, 500));
        if (cancelled) return;

        const routeStatus = await navigationController.setDestination(
          { position: { lat: routeData.destinationLat, lng: routeData.destinationLng } },
          { routingOptions: { travelMode: TravelMode.DRIVING } }
        );
        console.log("Route status:", routeStatus);
        if (cancelled) return;

        await navigationController.startGuidance();
        navigationController.setAudioGuidanceType(AudioGuidance.SILENT);

        // Enable location event emission BEFORE simulator — this registers
        // the listener and sets the flag. Must happen before simulator starts
        // so resetFreeNav() doesn't interfere with simulated locations.
        try {
          navigationController.startUpdatingLocation();
          console.log("Nav location updates started");
        } catch (e) {
          console.warn("startUpdatingLocation failed:", e);
        }

        // DEV ONLY — simulate driving along the calculated route.
        // Started AFTER startUpdatingLocation so the simulator overrides
        // the location source with simulated positions.
        const SIMULATE_DRIVING = false;
        if (SIMULATE_DRIVING && !cancelled) {
          try {
            navigationController.simulator.simulateLocationsAlongExistingRoute({
              speedMultiplier: 5,
            });
            console.log("Route simulation started at 5x speed");
          } catch (e) {
            console.warn("Route simulation failed:", e);
          }
        }

        if (navViewControllerRef.current) {
          navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED);
        }
        setTimeout(() => {
          if (!cancelled && navViewControllerRef.current) {
            try { navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED); } catch {}
          }
        }, 800);
        setTimeout(() => {
          if (!cancelled && navViewControllerRef.current) {
            try { navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED); } catch {}
          }
        }, 2500);
      } catch (e) {
        console.warn("Navigation start failed:", e);
      }
    };

    startNavigation();

    return () => {
      cancelled = true;
      try { setOnLocationChanged(null); } catch {}
      try { navigationController.simulator.stopLocationSimulation(); } catch {}
      try { navigationController.stopUpdatingLocation(); } catch {}
      navigationController.stopGuidance().catch(() => {});
      navigationController.clearDestinations().catch(() => {});
    };
  }, [isDriving, routeData, navViewReady, setOnLocationChanged]);

  const handleGetDirections = async () => {
    if (!destination.trim()) {
      Alert.alert("Error", "Please enter a destination");
      return;
    }

    setLoadingRoute(true);
    setRouteData(null);
    setPois([]);
    setTourReady(false);
    setRouteId(null);

    // Resolve "Current Location" to actual address
    let resolvedOrigin = origin;
    if (origin === "Current Location" && userLoc) {
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${userLoc.lat},${userLoc.lng}&key=${ENV.GOOGLE_MAPS_API_KEY}`
        );
        const data = await res.json();
        if (data.results?.[0]?.formatted_address) {
          resolvedOrigin = data.results[0].formatted_address;
        }
      } catch {}
    }

    try {
      const data = await api.getDirections(resolvedOrigin, destination);
      setRouteData(data);

      const poisData = await api.getPois(data.polyline, data.durationSec);
      setPois(poisData.pois || []);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to get directions");
    } finally {
      setLoadingRoute(false);
    }
  };

  // handleGenerateTour is now merged into handleStartTour — no separate step needed.

  // Start a sim tour (skip proximity check, go straight to tour page simulator)
  const handleSimTour = useCallback(async () => {
    // Ensure the tour is generated first
    let currentRouteId = routeId;
    if (!currentRouteId && routeData) {
      setLoadingTour(true);
      setTourLoadingLabel("Generating Tour...");
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
          pois: pois.map((p: any) => ({
            placeId: p.placeId || p.place_id,
            name: p.name,
            types: p.types || [],
            location: p.location,
            rating: p.rating || null,
            userRatingsTotal: p.userRatingsTotal || p.user_ratings_total || 0,
            vicinity: p.vicinity || "",
          })),
        });
        currentRouteId = saved.routeId;
        setRouteId(saved.routeId);
        await api.generateTour(saved.routeId);

        // Poll until ready
        await new Promise<void>((resolve, reject) => {
          const poll = setInterval(async () => {
            try {
              const st = await api.getTourStatus(currentRouteId!);
              if (st.status === "ready") { clearInterval(poll); resolve(); }
              else if (st.status === "failed") { clearInterval(poll); reject(new Error("Tour generation failed")); }
            } catch {}
          }, 3000);
        });
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Failed to generate tour");
        setLoadingTour(false);
        return;
      }
    }

    if (!currentRouteId) return;

    setLoadingTour(true);
    setTourLoadingLabel("Preparing Audio...");
    try {
      // Wait for tour generation to be fully "ready" on Railway — even if
      // routeId already exists, the backend might still be generating audio
      // (welcome, POI narrations, music, closing) for a tour that was just
      // started via Live Tour. Without this wait, the tour page loads with
      // null audio_url values and play does nothing.
      const waitForReady = async () => {
        const maxAttempts = 30; // ~90s max
        for (let i = 0; i < maxAttempts; i++) {
          try {
            const st = await api.getTourStatus(currentRouteId!);
            if (st.status === "ready") return true;
            if (st.status === "failed") throw new Error("Tour generation failed");
          } catch (e: any) {
            if (e?.message === "Tour generation failed") throw e;
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
        return false;
      };
      const ready = await waitForReady();
      if (!ready) {
        console.warn("[SimTour] Tour not ready after 90s");
      }

      // Verify POI audio URLs are actually populated (belt-and-suspenders)
      const { data: poiCheck } = await supabase
        .from("route_pois")
        .select("audio_url")
        .eq("route_id", currentRouteId!);
      const audioCount = (poiCheck || []).filter((p: any) => p.audio_url).length;
      console.log(`[SimTour] ${audioCount}/${poiCheck?.length || 0} POIs have audio`);

      // Pre-claim audio focus
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
      }).catch(() => {});
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to prepare tour");
      setLoadingTour(false);
      return;
    } finally {
      setLoadingTour(false);
    }

    // Pass from=home so the tour page's back button returns here instead of My Routes
    router.push({ pathname: "/tour/[id]", params: { id: currentRouteId, from: "home" } });
  }, [routeId, routeData, origin, destination, pois, router]);

  const handleStartTour = async () => {
    if (!routeData) return;

    // Case A — origin isn't "Current Location": live driving isn't appropriate.
    // Show the Sim Tour popup and route the user straight to the simulator.
    // No Nav SDK, no proximity check, no GPS streaming.
    if (origin !== "Current Location") {
      Alert.alert(
        "Sim Tour Only",
        "Your starting point isn't your current location. You can still experience this tour as a simulation.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Begin Sim Tour", onPress: () => handleSimTour() },
        ]
      );
      return;
    }

    // Case B — origin is "Current Location": proceed with live driving mode.
    try {
      // If tour was already generated (e.g. re-entering after exit driving),
      // skip straight to pre-loading audio — no need to regenerate.
      let currentRouteId = routeId;
      if (currentRouteId) {
        // Tour already exists — jump to audio pre-loading
        setLoadingTour(true);
        setTourLoadingLabel("Preparing Audio...");
      } else {
        // First time — need to generate
        setLoadingTour(true);
        setTourLoadingLabel("Generating Tour...");
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
          pois: pois.map((p: any) => ({
            placeId: p.placeId || p.place_id,
            name: p.name,
            types: p.types || [],
            location: p.location,
            rating: p.rating || null,
            userRatingsTotal: p.userRatingsTotal || p.user_ratings_total || 0,
            vicinity: p.vicinity || "",
          })),
        });
        currentRouteId = saved.routeId;
        setRouteId(saved.routeId);
        await api.generateTour(saved.routeId);

        // Poll until tour is ready
        await new Promise<void>((resolve, reject) => {
          const pollInterval = setInterval(async () => {
            try {
              const status = await api.getTourStatus(currentRouteId!);
              if (status.status === "ready") {
                clearInterval(pollInterval);
                resolve();
              } else if (status.status === "failed") {
                clearInterval(pollInterval);
                reject(new Error("Tour generation failed"));
              }
            } catch {}
          }, 3000);
        });
      }

      // Pre-download audio (runs for both new and existing tours)
      setTourLoadingLabel("Preparing Audio...");
      console.log("[Tour] Status ready — pre-downloading audio...");

      const [routeResult, poiResult] = await Promise.all([
        supabase.from("routes").select("welcome_audio_url, music_track_id").eq("id", currentRouteId!).single(),
        supabase.from("route_pois")
          .select("id, name, lat, lng, types, place_id, audio_url, audio_duration_sec, is_neighborhood_intro")
          .eq("route_id", currentRouteId!)
          .order("sequence_order", { ascending: true }),
      ]);

      const routeRow = routeResult.data;
      const poiRows = poiResult.data || [];

      // Pre-load welcome audio
      let welcomeSound: Audio.Sound | null = null;
      if (routeRow?.welcome_audio_url) {
        try {
          const { sound } = await Audio.Sound.createAsync({ uri: routeRow.welcome_audio_url }, { shouldPlay: false });
          welcomeSound = sound;
        } catch {}
      }

      // Pre-load POI audio in the background — non-blocking so welcome can
      // start playing immediately. Each POI's Sound is cached by id; playPoiAudio
      // picks it up instantly if ready, or falls back to on-demand createAsync.
      // Unload any old pre-loaded sounds from a previous session first.
      for (const s of Object.values(poiSoundsRef.current)) {
        s.unloadAsync().catch(() => {});
      }
      poiSoundsRef.current = {};
      (async () => {
        for (const poi of poiRows) {
          if (!poi.audio_url) continue;
          try {
            const { sound } = await Audio.Sound.createAsync(
              { uri: poi.audio_url },
              { shouldPlay: false, volume: 1.0 }
            );
            poiSoundsRef.current[poi.id] = sound;
          } catch {}
        }
        console.log(`[Tour] Pre-loaded ${Object.keys(poiSoundsRef.current).length}/${poiRows.length} POI audio files`);
      })();

      // Pre-load music
      let musicSound: Audio.Sound | null = null;
      if (routeRow?.music_track_id) {
        try {
          const { data: musicData } = await supabase.from("music_tracks").select("audio_url").eq("id", routeRow.music_track_id).single();
          if (musicData?.audio_url) {
            const { sound: music } = await Audio.Sound.createAsync({ uri: musicData.audio_url }, { shouldPlay: false, isLooping: true, volume: 0.4 });
            musicSound = music;
          }
        } catch {}
      }

      // Step 4: Verify POIs are fully loaded before entering driving mode
      const poisWithAudio = poiRows.filter((p: any) => p.audio_url);
      console.log(`[Tour] POIs loaded: ${poiRows.length} total, ${poisWithAudio.length} with audio`);

      // If no POIs have audio yet, re-fetch with a short wait (background generation may still be running)
      let finalPoiRows = poiRows;
      if (poiRows.length > 0 && poisWithAudio.length === 0) {
        console.log("[Tour] No POIs have audio — waiting 3s and re-fetching...");
        await new Promise((r) => setTimeout(r, 3000));
        const { data: retryPois } = await supabase
          .from("route_pois")
          .select("id, name, lat, lng, types, place_id, audio_url, audio_duration_sec, is_neighborhood_intro")
          .eq("route_id", currentRouteId!)
          .order("sequence_order", { ascending: true });
        if (retryPois && retryPois.length > 0) {
          finalPoiRows = retryPois;
          console.log(`[Tour] Retry: ${finalPoiRows.length} POIs, ${finalPoiRows.filter((p: any) => p.audio_url).length} with audio`);
        }
      }

      // Load POI data + reset refs BEFORE setIsDriving so the nav effect
      // (which registers the geofence listener) always sees populated data.
      triggeredPoisRef.current = new Set();
      poiQueueRef.current = [];
      isPlayingPoiRef.current = false;
      if (finalPoiRows.length > 0) {
        setTourPois(finalPoiRows);
        tourPoisRef.current = finalPoiRows; // set ref directly — don't wait for useEffect
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
      }).catch(() => {});

      setActiveTour(currentRouteId!, "driving");
      // Don't call drawRouteOnMap here — the Nav SDK draws its own route line
      // during guidance. Calling clearMapView() would interfere with the SDK's
      // rendering and cause the route line to break.
      togglePanel(false);
      setIsDriving(true);

      // Play music
      if (musicSound) {
        bgMusicRef.current = musicSound;
        try { await musicSound.playAsync(); } catch {}
      }

      // Play welcome audio
      if (welcomeSound) {
        soundRef.current = welcomeSound;
        welcomeSound.setOnPlaybackStatusUpdate((status: any) => {
          if (status.isLoaded && status.didJustFinish) {
            try { bgMusicRef.current?.setVolumeAsync(0.4); } catch {}
          }
        });
        try {
          await bgMusicRef.current?.setVolumeAsync(0.08);
          await welcomeSound.playAsync();
        } catch {}
      }

      console.log("[Tour] Driving mode started");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to start tour");
    } finally {
      setLoadingTour(false);
      setTourLoadingLabel("Generating Tour...");
    }
  };

  const handleExitDriving = useCallback(async () => {
    // Do NOT reset navViewReady here — the NavigationView is always mounted, so
    // onNavigationViewControllerCreated only fires once. Resetting navViewReady
    // would block the next Start Tour from entering driving mode.
    setIsDriving(false);
    clearActiveTour();
    setCurrentDrivingPoi(null);
    setPoiPanelExpanded(true);

    // Clear POI audio queue + reset playing flag so a fresh Start Tour starts clean
    poiQueueRef.current = [];
    isPlayingPoiRef.current = false;

    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); } catch {}
      // Don't unload here — soundRef may point to a pre-loaded POI sound
      // that's tracked in poiSoundsRef. We unload those below.
      soundRef.current = null;
    }
    // Unload all pre-loaded POI sounds
    for (const s of Object.values(poiSoundsRef.current)) {
      try { await s.unloadAsync(); } catch {}
    }
    poiSoundsRef.current = {};
    if (bgMusicRef.current) {
      await bgMusicRef.current.stopAsync();
      await bgMusicRef.current.unloadAsync();
      bgMusicRef.current = null;
    }
    setTourPois([]);

    // Restore the map to the exact "Get Directions" view: polyline, markers, bearing, zoom
    setTimeout(() => {
      if (routeData?.decodedPath?.length > 1) {
        drawRouteOnMap().catch((e) => console.warn("Exit-drive draw failed:", e));
      } else if (userLoc && mapControllerRef.current) {
        Promise.resolve(mapControllerRef.current.moveCamera({
          target: userLoc,
          zoom: 14,
          tilt: 0,
          bearing: 0,
        }) as any).catch(() => undefined);
      }
    }, 500);
  }, [routeData, userLoc, drawRouteOnMap]);

  const handleTogglePause = useCallback(async () => {
    if (tourPaused) {
      // Resume
      try { await soundRef.current?.playAsync(); } catch {}
      try { await bgMusicRef.current?.playAsync(); } catch {}
      try { navigationController.simulator.resumeLocationSimulation(); } catch {}
      setTourPaused(false);
    } else {
      // Pause
      try { await soundRef.current?.pauseAsync(); } catch {}
      try { await bgMusicRef.current?.pauseAsync(); } catch {}
      try { navigationController.simulator.pauseLocationSimulation(); } catch {}
      setTourPaused(true);
    }
  }, [tourPaused, navigationController]);

  const handleEndTour = useCallback(() => {
    Alert.alert(
      "End Tour",
      "Are you sure you want to end this tour?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End Tour",
          style: "destructive",
          onPress: () => {
            setTourPaused(false);
            handleExitDriving();
          },
        },
      ]
    );
  }, [handleExitDriving]);

  if (authLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={colors.rideBlue} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Map — single NavigationView, always mounted; becomes drive UI when isDriving */}
      <NavigationView
        style={styles.map}
        onMapViewControllerCreated={onMapViewControllerCreated}
        onNavigationViewControllerCreated={(controller) => {
          navViewControllerRef.current = controller;
          setNavViewReady(true);
        }}
        mapId="da9e1e4ff9cfa0ff3017deab"
        mapPadding={mapPadding}
        headerEnabled={false}
        footerEnabled={false}
        speedometerEnabled={false}
        recenterButtonEnabled={false}
        navigationNightMode={isDark ? NavigationNightMode.FORCE_NIGHT : NavigationNightMode.FORCE_DAY}
        navigationUIEnabledPreference={isDriving ? NavigationUIEnabledPreference.AUTOMATIC : NavigationUIEnabledPreference.DISABLED}
      />

      {/* Driving controls — Pause + End Tour */}
      {isDriving && (
        <View style={[styles.drivingControls, { top: insets.top + 12 }]}>
          <TouchableOpacity style={styles.pauseButton} onPress={handleTogglePause}>
            <Text style={styles.drivingControlText}>{tourPaused ? "▶  Resume" : "⏸  Pause"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.endTourButton} onPress={handleEndTour}>
            <Text style={styles.drivingControlText}>✕  End Tour</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Custom recenter button — floats above POI panel, synced with expand state */}
      {isDriving && (
        <TouchableOpacity
          style={[
            styles.recenterButton,
            {
              bottom:
                (currentDrivingPoi
                  ? poiPanelExpanded ? 240 : 64
                  : poiPanelExpanded ? 100 : 64) + insets.bottom,
            },
          ]}
          onPress={() => {
            if (navViewControllerRef.current) {
              navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED);
            }
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.recenterText}>Re Center</Text>
        </TouchableOpacity>
      )}

      {/* POI detail panel during driving */}
      {isDriving && (
        <View style={[styles.poiPanel, {
          backgroundColor: isDark ? colors.nearBlack : "#fff",
          paddingBottom: poiPanelExpanded ? insets.bottom + 12 : 0,
        }]}>
          <TouchableOpacity
            onPress={() => setPoiPanelExpanded(!poiPanelExpanded)}
            activeOpacity={0.7}
            style={styles.poiPanelHandleArea}
          >
            {poiPanelExpanded ? (
              <View style={styles.poiPanelHandle} />
            ) : (
              <Text style={{ color: isDark ? "#aaa" : "#666", fontSize: 18 }}>▲</Text>
            )}
          </TouchableOpacity>

          {poiPanelExpanded && (
            <>
              {currentDrivingPoi ? (
                <>
                  <Image
                    source={{
                      uri: poiPhotoUrl || `https://maps.googleapis.com/maps/api/staticmap?center=${currentDrivingPoi.lat},${currentDrivingPoi.lng}&zoom=17&size=600x200&maptype=roadmap&markers=color:0x0078FF|${currentDrivingPoi.lat},${currentDrivingPoi.lng}&key=${ENV.GOOGLE_MAPS_API_KEY}`,
                    }}
                    style={styles.poiPanelImage}
                    resizeMode="cover"
                  />
                  <View style={styles.poiPanelInfo}>
                    <Text style={[styles.poiPanelName, { color: theme.text }]} numberOfLines={1}>
                      {currentDrivingPoi.name}
                    </Text>
                    <Text style={[styles.poiPanelDesc, { color: theme.textSecondary }]} numberOfLines={2}>
                      {currentDrivingPoi.vicinity || currentDrivingPoi.types?.join(", ") || "Point of Interest"}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.poiPanelInfo}>
                  <Text style={[styles.poiPanelName, { color: theme.text }]}>
                    {tourPois.length > 0 ? "Driving to next point..." : "Starting tour..."}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* Expand button when collapsed */}
      {!panelOpen && !isDriving && (
        <View style={[styles.expandButton, { backgroundColor: theme.surface }]}>
          <TouchableOpacity onPress={() => togglePanel(true)} style={styles.expandTouchable}>
            <Text style={{ color: theme.text, fontSize: 18 }}>▲</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom panel — hidden during driving */}
      {!isDriving && (
        <Animated.View
          style={[styles.panel, {
            backgroundColor: theme.surface,
            paddingBottom: keyboardUp
              ? Animated.add(keyboardOffsetAnim, spacing.sm) as any
              : insets.bottom + 24,
            transform: [{
              translateY: panelAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 400],
              }),
            }],
          }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity onPress={() => togglePanel(!panelOpen)} activeOpacity={0.7}>
            <View style={styles.dragHandle} />
          </TouchableOpacity>

          {/* Origin row — collapsed by default; expands to show starting point after tap */}
          {showOriginField || routeData ? (
            <>
              <TouchableOpacity
                style={[styles.originBar, { backgroundColor: isDark ? colors.charcoal : "#f0f0f0" }]}
                onPress={() => {
                  setShowOriginField(true);
                  setActiveField("origin");
                  setTimeout(() => originInputRef.current?.focus(), 100);
                }}
              >
                <View style={[styles.dot, { backgroundColor: colors.magicGreen }]} />
                {activeField === "origin" ? (
                  <TextInput
                    ref={originInputRef}
                    style={[styles.input, { color: theme.text }]}
                    placeholder="Starting point"
                    placeholderTextColor={theme.textSecondary}
                    value={originInput || (origin === "Current Location" ? "" : origin)}
                    onChangeText={(text) => {
                      setOriginInput(text);
                      if (origin !== "Current Location") setOrigin("");
                      if (routeData) {
                        setRouteData(null); setPois([]); setTourReady(false); setRouteId(null);
                        if (mapControllerRef.current) Promise.resolve(mapControllerRef.current.clearMapView() as any).catch(() => undefined);
                      }
                      fetchSuggestions(text, "origin");
                    }}
                    onFocus={() => setActiveField("origin")}
                    onBlur={() => {}}
                    autoFocus
                  />
                ) : (
                  <Text style={[styles.originLabel, { color: origin === "Current Location" ? colors.rideBlue : theme.text }]}>
                    {origin || "Current Location"}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Destination input */}
              <View style={[styles.inputRow, { borderColor: activeField === "dest" ? colors.rideBlue : theme.border }]}>
                <View style={[styles.dot, { backgroundColor: colors.rideBlue }]} />
                <TextInput
                  ref={destInputRef}
                  style={[styles.input, { color: theme.text }]}
                  placeholder="Destination"
                  placeholderTextColor={theme.textSecondary}
                  value={destInput || destination}
                  onChangeText={(text) => {
                    setDestInput(text);
                    if (destination) setDestination("");
                    if (routeData) {
                      setRouteData(null); setPois([]); setTourReady(false); setRouteId(null);
                      if (mapControllerRef.current) Promise.resolve(mapControllerRef.current.clearMapView() as any).catch(() => undefined);
                    }
                    fetchSuggestions(text, "dest");
                  }}
                  onFocus={() => { setActiveField("dest"); if (!panelOpen) togglePanel(true); }}
                  onBlur={() => {}}
                />
              </View>
            </>
          ) : (
            /* "Where to?" — single input, Uber-style */
            <TouchableOpacity
              style={[styles.whereToBar, { backgroundColor: isDark ? colors.charcoal : "#f0f0f0" }]}
              onPress={() => {
                setShowOriginField(true);
                setActiveField("dest");
                setTimeout(() => destInputRef.current?.focus(), 100);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.whereToIcon, { color: colors.rideBlue }]}>◎</Text>
              <Text style={[styles.whereToText, { color: theme.textSecondary }]}>Where to?</Text>
            </TouchableOpacity>
          )}

          {/* Suggestions list */}
          {activeField !== null && (
            (activeField === "origin" && (originInput.length > 0 || originSuggestions.length > 0)) ||
            (activeField === "dest" && destSuggestions.length > 0)
          ) && (
            <View style={[styles.suggestionsList, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {activeField === "origin" && (
                <TouchableOpacity
                  style={[styles.suggestionItem, styles.yourLocationItem]}
                  onPress={() => {
                    setOrigin("Current Location");
                    setOriginInput("");
                    setOriginSuggestions([]);
                    setActiveField(null);
                    originInputRef.current?.blur();
                    if (routeData) { setRouteData(null); setPois([]); setTourReady(false); setRouteId(null); }
                  }}
                >
                  <View style={styles.yourLocationIcon}>
                    <Text style={{ fontSize: 16 }}>◎</Text>
                  </View>
                  <Text style={[styles.suggestionMain, { color: colors.rideBlue, fontWeight: "600" }]}>Current Location</Text>
                </TouchableOpacity>
              )}

              <FlatList
                data={activeField === "origin" ? originSuggestions : destSuggestions}
                keyExtractor={(item) => item.placeId}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                style={{ maxHeight: 200 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.suggestionItem}
                    onPress={() => selectSuggestion(item, activeField === "origin" ? "origin" : "dest")}
                  >
                    <Text style={[styles.suggestionMain, { color: theme.text }]}>{item.mainText}</Text>
                    {item.secondaryText ? <Text style={[styles.suggestionSub, { color: theme.textSecondary }]}>{item.secondaryText}</Text> : null}
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* Route info */}
          {routeData && !activeField && (
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
          {!activeField && (
            !routeData ? (
              <TouchableOpacity
                onPress={handleGetDirections}
                disabled={loadingRoute}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={["#7C5CFC", "#0078FF"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.button, loadingRoute && styles.buttonDisabled]}
                >
                  {loadingRoute ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Create Tour</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            ) : routeData ? (
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.magicGreen }, (loadingTour && !tourReady) && styles.buttonDisabled]}
                onPress={handleStartTour}
                disabled={loadingTour && !tourReady}
                activeOpacity={0.8}
              >
                {loadingTour && !tourReady ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={[styles.buttonText, { marginLeft: 8 }]}>{tourLoadingLabel}</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonText}>Start Tour</Text>
                )}
              </TouchableOpacity>
            ) : null
          )}
        </Animated.View>
      )}
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
  whereToBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginBottom: spacing.sm,
  },
  whereToIcon: {
    fontSize: 18,
    marginRight: spacing.sm,
  },
  whereToText: {
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  originBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  originLabel: {
    fontSize: fontSize.md,
    fontWeight: "500",
    flex: 1,
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
  suggestionsList: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  suggestionItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  suggestionMain: { fontSize: fontSize.sm, fontWeight: "500" as const },
  suggestionSub: { fontSize: fontSize.xs, marginTop: 2 },
  yourLocationItem: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  yourLocationIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(37, 99, 235, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.sm,
  },
  expandButton: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 8,
  },
  expandTouchable: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  recenterButton: {
    position: "absolute",
    right: 16,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  recenterText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  drivingControls: {
    position: "absolute",
    left: 16,
    flexDirection: "row",
    gap: 8,
    zIndex: 100,
  },
  pauseButton: {
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  endTourButton: {
    backgroundColor: "rgba(180,40,40,0.85)",
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  drivingControlText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  poiPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
    paddingHorizontal: spacing.md,
  },
  poiPanelHandleArea: {
    paddingVertical: 8,
    alignItems: "center",
  },
  poiPanelHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#ccc",
    borderRadius: 2,
  },
  poiPanelImage: {
    width: "100%",
    height: 140,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    backgroundColor: "#333",
  },
  poiPanelInfo: {
    paddingBottom: spacing.sm,
  },
  poiPanelName: {
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  poiPanelDesc: {
    fontSize: fontSize.sm,
    marginTop: 4,
    lineHeight: 18,
  },
  compassButton: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50,
  },
  compassText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  compassNeedle: {
    width: 2,
    height: 8,
    backgroundColor: colors.errorRed,
    borderRadius: 1,
    marginTop: -2,
  },
});
