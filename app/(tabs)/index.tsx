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
  NavigationNightMode,
  AudioGuidance,
  NavigationUIEnabledPreference,
} from "@googlemaps/react-native-navigation-sdk";
import type {
  MapViewController,
  NavigationViewController,
} from "@googlemaps/react-native-navigation-sdk";
import { useRouter } from "expo-router";
import { Audio } from "expo-av";
import { ENV } from "../../src/config/env";
import { colors, spacing, fontSize, borderRadius } from "../../src/theme";
import { getMarkerPaths } from "../../src/lib/markerAssets";
import { useAuth } from "../../src/hooks/useAuth";
import { supabase } from "../../src/lib/supabase";
import * as api from "../../src/services/api";

const MAP_STYLE = JSON.stringify([
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
]);

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? colors.dark : colors.light;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const mapControllerRef = useRef<MapViewController | null>(null);

  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [originInput, setOriginInput] = useState("");
  const [destInput, setDestInput] = useState("");
  const [originSuggestions, setOriginSuggestions] = useState<any[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<any[]>([]);
  const [activeField, setActiveField] = useState<"origin" | "dest" | null>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [pois, setPois] = useState<any[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [loadingTour, setLoadingTour] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [isDriving, setIsDriving] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);

  // Get user's current location and move map to it
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setUserLoc(coords);
      if (mapControllerRef.current && mapReady) {
        mapControllerRef.current.moveCamera({ target: coords, zoom: 14, tilt: 0, bearing: 0 });
      }
    })();
  }, [mapReady]);
  const soundRef = useRef<Audio.Sound | null>(null);
  const bgMusicRef = useRef<Audio.Sound | null>(null);
  const triggeredPoisRef = useRef<Set<string>>(new Set());
  const [tourPois, setTourPois] = useState<any[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originInputRef = useRef<TextInput>(null);
  const destInputRef = useRef<TextInput>(null);

  // Collapsible panel
  const [panelOpen, setPanelOpen] = useState(true);
  const panelAnim = useRef(new Animated.Value(0)).current; // 0 = open, 1 = collapsed
  const panelTouchStartY = useRef(0);
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;
  const [keyboardUp, setKeyboardUp] = useState(false);

  // Smooth animate panel up/down when keyboard shows/hides
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
    if (routeData) { setRouteData(null); setPois([]); setTourReady(false); setRouteId(null); try { mapControllerRef.current?.clearMapView(); } catch {} }
  }, [routeData]);

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
        const markers = getMarkerPaths();
        const coordinates = routeData.decodedPath.map((p: any) => ({
          lat: p.lat,
          lng: p.lng,
        }));

        // Draw gradient polyline (purple → green) matching web style
        const GRAD_START = [124, 92, 252]; // #7C5CFC
        const GRAD_END = [0, 232, 157];    // #00E89D
        const totalSegs = coordinates.length - 1;
        const batchSize = Math.max(1, Math.floor(totalSegs / 40));
        for (let i = 0; i < totalSegs; i += batchSize) {
          const end = Math.min(i + batchSize + 1, coordinates.length);
          const factor = i / totalSegs;
          const r = Math.round(GRAD_START[0] + (GRAD_END[0] - GRAD_START[0]) * factor);
          const g = Math.round(GRAD_START[1] + (GRAD_END[1] - GRAD_START[1]) * factor);
          const b = Math.round(GRAD_START[2] + (GRAD_END[2] - GRAD_START[2]) * factor);
          const color = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
          await controller.addPolyline({
            points: coordinates.slice(i, end),
            color,
            width: 5,
          });
        }

        await controller.addMarker({
          position: { lat: routeData.originLat, lng: routeData.originLng },
          title: "Start",
          imgPath: markers.origin,
        });

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

        if (coordinates.length > 1) {
          const lats = coordinates.map((c: any) => c.lat);
          const lngs = coordinates.map((c: any) => c.lng);

          // Calculate bearing from origin to destination so destination appears at top
          const oLat = (routeData.originLat * Math.PI) / 180;
          const dLat = (routeData.destinationLat * Math.PI) / 180;
          const dLng = ((routeData.destinationLng - routeData.originLng) * Math.PI) / 180;
          const y = Math.sin(dLng) * Math.cos(dLat);
          const x = Math.cos(oLat) * Math.sin(dLat) - Math.sin(oLat) * Math.cos(dLat) * Math.cos(dLng);
          const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

          // Auto-zoom based on route span
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

          controller.moveCamera({
            target: {
              lat: (Math.min(...lats) + Math.max(...lats)) / 2,
              lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
            },
            zoom,
            bearing,
          });
        }
      } catch (e) {
        console.warn("Map draw failed:", e);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [routeData, pois, mapReady]);

  // Start native navigation when driving mode activates
  const { navigationController, setOnLocationChanged } = useNavigation();
  const navViewControllerRef = useRef<NavigationViewController | null>(null);
  const [navViewReady, setNavViewReady] = useState(false);

  // Wait for NavigationView to mount, then start navigation
  useEffect(() => {
    if (!isDriving || !routeData || !navViewReady) return;

    let cancelled = false;

    const startNavigation = async () => {
      try {
        // Accept terms first (required by Navigation SDK)
        const termsAccepted = await navigationController.areTermsAccepted();
        if (!termsAccepted) {
          await navigationController.showTermsAndConditionsDialog();
        }

        const status = await navigationController.init();
        console.log("Nav init status:", status);
        if (cancelled) return;

        // Wait for navigator to be fully ready
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (cancelled) return;

        const routeStatus = await navigationController.setDestination(
          { position: { lat: routeData.destinationLat, lng: routeData.destinationLng } },
          { routingOptions: { travelMode: TravelMode.DRIVING } }
        );
        console.log("Route status:", routeStatus);
        if (cancelled) return;

        await navigationController.startGuidance();
        navigationController.setAudioGuidanceType(AudioGuidance.SILENT);

        if (navViewControllerRef.current) {
          navViewControllerRef.current.setFollowingPerspective(CameraPerspective.TILTED);
        }
      } catch (e) {
        console.warn("Navigation start failed:", e);
      }
    };

    startNavigation();

    return () => {
      cancelled = true;
      navigationController.stopGuidance().catch(() => {});
      navigationController.clearDestinations().catch(() => {});
    };
  }, [isDriving, routeData, navViewReady]);

  // POI geofencing - auto-play audio when near a POI
  useEffect(() => {
    if (!isDriving || tourPois.length === 0) return;

    const TRIGGER_RADIUS_M = 150;

    const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
      const R = 6371000;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const playPoiAudio = async (poi: any) => {
      if (!poi.audio_url || triggeredPoisRef.current.has(poi.id)) return;
      triggeredPoisRef.current.add(poi.id);

      // Duck background music
      if (bgMusicRef.current) {
        await bgMusicRef.current.setVolumeAsync(0.05);
      }

      // Play POI narration
      if (soundRef.current) await soundRef.current.unloadAsync();
      const { sound } = await Audio.Sound.createAsync(
        { uri: poi.audio_url },
        { shouldPlay: true }
      );
      soundRef.current = sound;

      // Restore music volume when narration finishes
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded && status.didJustFinish) {
          bgMusicRef.current?.setVolumeAsync(0.15);
        }
      });
    };

    // Use Navigation SDK's location updates for geofencing
    setOnLocationChanged((location: any) => {
      for (const poi of tourPois) {
        if (triggeredPoisRef.current.has(poi.id)) continue;
        const dist = haversine(location.lat, location.lng, poi.lat, poi.lng);
        if (dist <= TRIGGER_RADIUS_M) {
          playPoiAudio(poi);
          break; // One POI at a time
        }
      }
    });

    return () => { setOnLocationChanged(null); };
  }, [isDriving, tourPois]);

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

      // Auto-collapse panel to show the map
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
    if (!routeId || !mapControllerRef.current) return;

    // Collapse panel and switch to driving mode
    togglePanel(false);
    setIsDriving(true);

    // Set up audio to play in background / silent mode
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    });

    // Fetch route data + POI audio URLs
    try {
      const { data: routeRow } = await supabase
        .from("routes")
        .select("welcome_audio_url, music_track_id")
        .eq("id", routeId)
        .single();

      // Fetch POIs with audio
      const { data: poiRows } = await supabase
        .from("route_pois")
        .select("id, name, lat, lng, audio_url, audio_duration_sec, is_neighborhood_intro")
        .eq("route_id", routeId)
        .order("sequence_order", { ascending: true });

      if (poiRows) setTourPois(poiRows);
      triggeredPoisRef.current = new Set();

      // Play welcome audio
      if (routeRow?.welcome_audio_url) {
        if (soundRef.current) await soundRef.current.unloadAsync();
        const { sound } = await Audio.Sound.createAsync(
          { uri: routeRow.welcome_audio_url },
          { shouldPlay: true }
        );
        soundRef.current = sound;
      }

      // Start background music (looping, low volume)
      if (routeRow?.music_track_id) {
        try {
          const { data: trackData } = await supabase.storage
            .from("music")
            .createSignedUrl(routeRow.music_track_id, 3600);
          if (trackData?.signedUrl) {
            const { sound: music } = await Audio.Sound.createAsync(
              { uri: trackData.signedUrl },
              { shouldPlay: true, isLooping: true, volume: 0.15 }
            );
            bgMusicRef.current = music;
          }
        } catch {} // Music is optional
      }
    } catch (e) {
      console.warn("Start tour failed:", e);
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
      {/* Map - single NavigationView, always mounted */}
      <NavigationView
        style={styles.map}
        onMapViewControllerCreated={onMapViewControllerCreated}
        onNavigationViewControllerCreated={(controller) => {
          navViewControllerRef.current = controller;
          setNavViewReady(true);
        }}
        mapStyle={MAP_STYLE}
        headerEnabled={false}
        footerEnabled={false}
        speedometerEnabled={false}
        recenterButtonEnabled={isDriving}
        navigationNightMode={NavigationNightMode.FORCE_DAY}
        navigationUIEnabledPreference={isDriving ? NavigationUIEnabledPreference.AUTOMATIC : NavigationUIEnabledPreference.DISABLED}
      />

      {/* Exit driving mode button */}
      {isDriving && (
        <TouchableOpacity
          style={styles.exitDrivingButton}
          onPress={async () => {
            try {
              await navigationController.stopGuidance();
              await navigationController.clearDestinations();
            } catch {}
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
            setIsDriving(false);
            // Zoom back to route overview
            if (routeData?.decodedPath?.length > 1) {
              const lats = routeData.decodedPath.map((p: any) => p.lat);
              const lngs = routeData.decodedPath.map((p: any) => p.lng);
              mapControllerRef.current?.moveCamera({
                target: {
                  lat: (Math.min(...lats) + Math.max(...lats)) / 2,
                  lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
                },
                zoom: 12,
                tilt: 0,
                bearing: 0,
              });
            } else if (userLoc) {
              mapControllerRef.current?.moveCamera({ target: userLoc, zoom: 14, tilt: 0, bearing: 0 });
            }
          }}
        >
          <Text style={styles.exitDrivingText}>✕  Exit Driving</Text>
        </TouchableOpacity>
      )}

      {/* Expand button when collapsed */}
      {!panelOpen && (
        <View style={[styles.expandButton, { backgroundColor: theme.surface }]}>
          <TouchableOpacity onPress={() => togglePanel(true)} style={styles.expandTouchable}>
            <Text style={{ color: theme.text, fontSize: 18 }}>▲</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom Panel */}
      <Animated.View
        style={[styles.panel, {
          backgroundColor: theme.surface,
          paddingBottom: keyboardUp
            ? Animated.add(keyboardOffsetAnim, spacing.sm) as any
            : spacing.xl,
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

          <Text style={[styles.title, { color: theme.text }]}>Plan Your Route</Text>

          {/* Origin input */}
          <View style={[styles.inputRow, { borderColor: activeField === "origin" ? colors.rideBlue : theme.border }]}>
            <View style={[styles.dot, { backgroundColor: colors.magicGreen }]} />
            <TextInput
              ref={originInputRef}
              style={[styles.input, { color: theme.text }]}
              placeholder="Starting point"
              placeholderTextColor={theme.textSecondary}
              value={originInput || origin}
              onChangeText={(text) => {
                setOriginInput(text);
                if (origin) setOrigin("");
                if (routeData) {
                  setRouteData(null); setPois([]); setTourReady(false); setRouteId(null);
                  try { mapControllerRef.current?.clearMapView(); } catch {}
                }
                fetchSuggestions(text, "origin");
              }}
              onFocus={() => { setActiveField("origin"); if (!panelOpen) togglePanel(true); }}
              onBlur={() => {}}
            />
          </View>

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

          {/* Suggestions list - shown inline below inputs */}
          {activeField !== null && (
            (activeField === "origin" && (originInput.length > 0 || originSuggestions.length > 0)) ||
            (activeField === "dest" && destSuggestions.length > 0)
          ) && (
            <View style={[styles.suggestionsList, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {/* Your Location - origin only */}
              {activeField === "origin" && (
                <TouchableOpacity
                  style={[styles.suggestionItem, styles.yourLocationItem]}
                  onPress={async () => {
                    const loc = userLoc || await (async () => {
                      const l = await Location.getCurrentPositionAsync({});
                      return { lat: l.coords.latitude, lng: l.coords.longitude };
                    })();
                    let label = "Current Location";
                    try {
                      const res = await fetch(
                        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${loc.lat},${loc.lng}&key=${ENV.GOOGLE_MAPS_API_KEY}`
                      );
                      const data = await res.json();
                      if (data.results?.[0]?.formatted_address) {
                        label = data.results[0].formatted_address;
                      }
                    } catch {}
                    setOrigin(label);
                    setOriginInput(label);
                    setOriginSuggestions([]);
                    setActiveField(null);
                    originInputRef.current?.blur();
                    if (routeData) { setRouteData(null); setPois([]); setTourReady(false); setRouteId(null); try { mapControllerRef.current?.clearMapView(); } catch {} }
                  }}
                >
                  <View style={styles.yourLocationIcon}>
                    <Text style={{ fontSize: 16 }}>◎</Text>
                  </View>
                  <Text style={[styles.suggestionMain, { color: colors.rideBlue, fontWeight: "600" }]}>Your Location</Text>
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
    top: 50,
    left: 16,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  exitDrivingText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
});
