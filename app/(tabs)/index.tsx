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
  MapColorScheme,
} from "@googlemaps/react-native-navigation-sdk";
import type {
  MapViewController,
  NavigationViewController,
} from "@googlemaps/react-native-navigation-sdk";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Audio } from "expo-av";
import { ENV } from "../../src/config/env";
import { colors, spacing, fontSize, borderRadius } from "../../src/theme";
import { getMarkerPaths } from "../../src/lib/markerAssets";
import { useAuth } from "../../src/hooks/useAuth";
import { useTheme } from "../../src/hooks/useTheme";
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
  const { user, loading: authLoading } = useAuth();
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
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  const bgMusicRef = useRef<Audio.Sound | null>(null);
  const triggeredPoisRef = useRef<Set<string>>(new Set());
  const [tourPois, setTourPois] = useState<any[]>([]);
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
      try { mapControllerRef.current?.clearMapView(); } catch {}
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

  const onMapViewControllerCreated = useCallback((controller: MapViewController) => {
    mapControllerRef.current = controller;
    setMapReady(true);
  }, []);

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
        try {
          mapControllerRef.current?.moveCamera({
            target: coords,
            zoom: 14,
            tilt: 0,
            bearing: 0,
          });
        } catch (e) {
          console.warn("Initial moveCamera failed:", e);
        }
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
    try { controller.clearMapView(); } catch {}

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

      try {
        controller.moveCamera({
          target: {
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          },
          zoom,
          bearing,
          tilt: 0,
        });
      } catch (e) {
        console.warn("Camera fit failed:", e);
      }
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

    const startNavigation = async () => {
      try {
        const termsAccepted = await navigationController.areTermsAccepted();
        if (!termsAccepted) {
          await navigationController.showTermsAndConditionsDialog();
        }
        if (cancelled) return;

        // init() is idempotent — calling it on an already-initialized navigator is a no-op
        const status = await navigationController.init();
        console.log("Nav init status:", status);
        if (cancelled) return;

        // Short settle delay so the native navigator is ready for setDestination
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

        // Start GPS streaming — required for setOnLocationChanged to fire.
        // Without this the listener is registered but receives no events.
        try {
          navigationController.startUpdatingLocation();
          console.log("Nav location updates started");
        } catch (e) {
          console.warn("startUpdatingLocation failed:", e);
        }

        // Register geofencing listener right here (not in a separate effect)
        // so it's set up ONCE per drive and doesn't churn on tourPois updates.
        // The listener reads tourPois from a ref so it always sees current data.
        const TRIGGER_RADIUS_M = 200;
        const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
          const R = 6371000;
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLng = ((lng2 - lng1) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        // Plays a POI narration, waits for it to finish + a silent gap,
        // then pulls the next queued POI and plays it. This prevents narrations
        // from interrupting each other when POIs are close together.
        const playPoiAudio = async (poi: any) => {
          isPlayingPoiRef.current = true;
          try {
            if (bgMusicRef.current) await bgMusicRef.current.setVolumeAsync(0.08);
            if (soundRef.current) {
              try { await soundRef.current.unloadAsync(); } catch {}
            }
            const { sound } = await Audio.Sound.createAsync(
              { uri: poi.audio_url },
              { shouldPlay: true }
            );
            soundRef.current = sound;
            sound.setOnPlaybackStatusUpdate((status: any) => {
              if (status.isLoaded && status.didJustFinish) {
                // After the narration ends, restore music, wait a beat, then
                // play the next queued POI if one is waiting.
                bgMusicRef.current?.setVolumeAsync(0.4);
                setTimeout(() => {
                  const next = poiQueueRef.current.shift();
                  if (next) {
                    console.log(`[Geofence] ▶ Playing queued "${next.name}"`);
                    playPoiAudio(next);
                  } else {
                    isPlayingPoiRef.current = false;
                  }
                }, POI_GAP_MS);
              }
            });
          } catch (e: any) {
            console.warn(`[Geofence] POI audio failed for "${poi.name}":`, e?.message || e);
            // Don't strand the queue on a failure — try the next one
            isPlayingPoiRef.current = false;
            const next = poiQueueRef.current.shift();
            if (next) playPoiAudio(next);
          }
        };

        let logCounter = 0;
        setOnLocationChanged((location: any) => {
          const pois = tourPoisRef.current;
          if (pois.length === 0) return;

          logCounter++;
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
                // Something is playing — queue this POI to play after
                poiQueueRef.current.push(poi);
                console.log(
                  `[Geofence] ⏳ QUEUED "${poi.name}" (${poiQueueRef.current.length} in queue)`
                );
              } else {
                console.log(`[Geofence] ✅ TRIGGER "${poi.name}" at ${dist.toFixed(0)}m`);
                playPoiAudio(poi);
              }
              return;
            }
          }
          if (shouldLog) {
            console.log(
              `[Geofence] loc=(${location.lat.toFixed(5)},${location.lng.toFixed(5)}) ` +
              `closest="${closestPoi?.name ?? "none"}" dist=${closestDist === Infinity ? "∞" : closestDist.toFixed(0) + "m"}`
            );
          }
        });

        // DEV ONLY — simulate driving along the calculated route so you can
        // test the driving experience while stationary. Set SIMULATE_DRIVING
        // to false (or remove) for real-device production use.
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

        // Apply the tilted follow perspective immediately so the puck becomes
        // a chevron right away. Re-apply it after a short delay so it takes
        // effect after guidance is fully running and the first location update
        // has landed — otherwise the SDK falls back to a blue dot.
        if (navViewControllerRef.current) {
          navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED);
        }
        setTimeout(() => {
          if (!cancelled && navViewControllerRef.current) {
            try {
              navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED);
            } catch {}
          }
        }, 800);
        setTimeout(() => {
          if (!cancelled && navViewControllerRef.current) {
            try {
              navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED);
            } catch {}
          }
        }, 2500);
      } catch (e) {
        console.warn("Navigation start failed:", e);
      }
    };

    startNavigation();

    return () => {
      cancelled = true;
      // Unregister the location listener first so we don't receive events
      // during teardown
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

      togglePanel(false);
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
        } catch (e) {
          console.warn("Tour status poll error:", e);
        }
      }, 3000);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to generate tour");
      setLoadingTour(false);
    }
  };

  const handleStartTour = async () => {
    if (!routeId) return;

    // Re-draw overlays for driving mode: hide the green origin marker (user is
    // there, don't cover their real location puck) and hide our static gradient
    // polyline (Nav SDK draws its own live route line). Keep POI + destination
    // markers so the user can see upcoming stops during the drive.
    drawRouteOnMap({ hideOrigin: true, hidePolyline: true, fitCamera: false })
      .catch((e) => console.warn("Drive-mode draw failed:", e));

    // Switch to driving mode IMMEDIATELY — audio + data load in the background below
    togglePanel(false);
    setIsDriving(true);

    // Configure audio mode (quick, non-blocking)
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    }).catch(() => {});

    triggeredPoisRef.current = new Set();
    poiQueueRef.current = [];
    isPlayingPoiRef.current = false;

    // Fetch route row + POI data in parallel — don't block UI transition
    (async () => {
      try {
        const [routeResult, poiResult] = await Promise.all([
          supabase
            .from("routes")
            .select("welcome_audio_url, music_track_id")
            .eq("id", routeId)
            .single(),
          supabase
            .from("route_pois")
            .select("id, name, lat, lng, audio_url, audio_duration_sec, is_neighborhood_intro")
            .eq("route_id", routeId)
            .order("sequence_order", { ascending: true }),
        ]);

        const routeRow = routeResult.data;
        const poiRows = poiResult.data;

        if (poiRows) setTourPois(poiRows);

        // Welcome audio + background music — fire both in parallel so whichever is ready first plays
        if (routeRow?.welcome_audio_url) {
          (async () => {
            try {
              if (soundRef.current) await soundRef.current.unloadAsync();
              const { sound } = await Audio.Sound.createAsync(
                { uri: routeRow.welcome_audio_url },
                { shouldPlay: true }
              );
              soundRef.current = sound;
              sound.setOnPlaybackStatusUpdate((status: any) => {
                if (status.isLoaded && status.didJustFinish) {
                  bgMusicRef.current?.setVolumeAsync(0.4);
                }
              });
              bgMusicRef.current?.setVolumeAsync(0.08);
            } catch (e: any) {
              console.warn("Welcome audio failed:", e?.message || e);
            }
          })();
        }

        if (routeRow?.music_track_id) {
          (async () => {
            try {
              const { data: musicData, error: musicErr } = await supabase
                .from("music_tracks")
                .select("audio_url")
                .eq("id", routeRow.music_track_id)
                .single();
              if (musicErr) {
                console.warn("Music track lookup failed:", musicErr.message);
              } else if (musicData?.audio_url) {
                const { sound: music } = await Audio.Sound.createAsync(
                  { uri: musicData.audio_url },
                  { shouldPlay: true, isLooping: true, volume: 0.4 }
                );
                bgMusicRef.current = music;
                console.log("Background music started");
              }
            } catch (e: any) {
              console.warn("Background music failed:", e?.message || e);
            }
          })();
        } else {
          console.log("No music_track_id on this route");
        }
      } catch (e) {
        console.warn("Start tour data fetch failed:", e);
      }
    })();
  };

  const handleExitDriving = useCallback(async () => {
    // Do NOT reset navViewReady here — the NavigationView is always mounted, so
    // onNavigationViewControllerCreated only fires once. Resetting navViewReady
    // would block the next Start Tour from entering driving mode.
    setIsDriving(false);

    // Clear POI audio queue + reset playing flag so a fresh Start Tour starts clean
    poiQueueRef.current = [];
    isPlayingPoiRef.current = false;

    if (soundRef.current) {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }
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
        try {
          mapControllerRef.current.moveCamera({
            target: userLoc,
            zoom: 14,
            tilt: 0,
            bearing: 0,
          });
        } catch (e) {
          console.warn("Exit-drive moveCamera failed:", e);
        }
      }
    }, 500);
  }, [routeData, userLoc, drawRouteOnMap]);

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
        mapColorScheme={isDark ? MapColorScheme.DARK : MapColorScheme.LIGHT}
        headerEnabled={false}
        footerEnabled={false}
        speedometerEnabled={false}
        recenterButtonEnabled={isDriving}
        navigationNightMode={isDark ? NavigationNightMode.FORCE_NIGHT : NavigationNightMode.FORCE_DAY}
        navigationUIEnabledPreference={isDriving ? NavigationUIEnabledPreference.AUTOMATIC : NavigationUIEnabledPreference.DISABLED}
      />

      {/* Exit driving button */}
      {isDriving && (
        <TouchableOpacity style={[styles.exitDrivingButton, { top: insets.top + 12 }]} onPress={handleExitDriving}>
          <Text style={styles.exitDrivingText}>✕  Exit Driving</Text>
        </TouchableOpacity>
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
                        try { mapControllerRef.current?.clearMapView(); } catch {}
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
                      try { mapControllerRef.current?.clearMapView(); } catch {}
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
            )
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
  exitDrivingButton: {
    position: "absolute",
    left: 16,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 100,
  },
  exitDrivingText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
});
