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
  Platform,
} from "react-native";
import * as Location from "expo-location";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Audio } from "expo-av";
import { ENV } from "../../src/config/env";
import { colors, spacing, fontSize, borderRadius } from "../../src/theme";
import { lightMapStyle, darkMapStyle } from "../../src/theme/mapStyles";
import { markerImages } from "../../src/lib/markerAssets";
import { useAuth } from "../../src/hooks/useAuth";
import { supabase } from "../../src/lib/supabase";
import * as api from "../../src/services/api";

// 3-stop brand gradient: #7C5CFC → #0078FF → #00E89D
function getGradientColor(factor: number): string {
  const stops = [
    [124, 92, 252],  // #7C5CFC
    [0, 120, 255],   // #0078FF
    [0, 232, 157],   // #00E89D
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

// Split path into gradient segments
function getGradientSegments(path: { lat: number; lng: number }[], numSegments = 20) {
  if (path.length < 2) return [];
  const segSize = Math.max(1, Math.floor(path.length / numSegments));
  const segments: { coordinates: { latitude: number; longitude: number }[]; color: string }[] = [];

  for (let i = 0; i < path.length - 1; i += segSize) {
    const end = Math.min(i + segSize + 1, path.length);
    const factor = i / (path.length - 1);
    segments.push({
      coordinates: path.slice(i, end).map((p) => ({ latitude: p.lat, longitude: p.lng })),
      color: getGradientColor(factor),
    });
  }
  return segments;
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? colors.dark : colors.light;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const mapRef = useRef<MapView>(null);
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
  const [isDriving, setIsDriving] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);

  // Get user's current location
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setUserLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    })();
  }, []);

  const soundRef = useRef<Audio.Sound | null>(null);
  const bgMusicRef = useRef<Audio.Sound | null>(null);
  const triggeredPoisRef = useRef<Set<string>>(new Set());
  const [tourPois, setTourPois] = useState<any[]>([]);
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
    if (routeData) { setRouteData(null); setPois([]); setTourReady(false); setRouteId(null); }
  }, [routeData]);

  // Redirect to auth if not logged in
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (!authLoading && !user && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/(auth)/login");
    }
  }, [user, authLoading]);

  // Fit map to route when routeData changes
  useEffect(() => {
    if (!routeData?.decodedPath || routeData.decodedPath.length < 2) return;

    const coordinates = routeData.decodedPath.map((p: any) => ({
      latitude: p.lat,
      longitude: p.lng,
    }));

    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 80, right: 40, bottom: 300, left: 40 },
        animated: true,
      });
    }, 500);
  }, [routeData]);

  // Location tracking for driving mode
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const [drivingLocation, setDrivingLocation] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);

  useEffect(() => {
    if (!isDriving) {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
      setDrivingLocation(null);
      return;
    }

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 1000 },
        (loc) => {
          const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading };
          setDrivingLocation(coords);

          // Follow user
          mapRef.current?.animateCamera({
            center: { latitude: coords.lat, longitude: coords.lng },
            pitch: 45,
            heading: coords.heading || 0,
            zoom: 17,
          }, { duration: 800 });
        }
      );
    })();

    return () => { locationSubRef.current?.remove(); };
  }, [isDriving]);

  // POI geofencing during driving
  useEffect(() => {
    if (!isDriving || !drivingLocation || tourPois.length === 0) return;

    const TRIGGER_RADIUS_M = 150;
    const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
      const R = 6371000;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    for (const poi of tourPois) {
      if (triggeredPoisRef.current.has(poi.id)) continue;
      const dist = haversine(drivingLocation.lat, drivingLocation.lng, poi.lat, poi.lng);
      if (dist <= TRIGGER_RADIUS_M && poi.audio_url) {
        triggeredPoisRef.current.add(poi.id);

        (async () => {
          if (bgMusicRef.current) await bgMusicRef.current.setVolumeAsync(0.05);
          if (soundRef.current) await soundRef.current.unloadAsync();
          const { sound } = await Audio.Sound.createAsync(
            { uri: poi.audio_url },
            { shouldPlay: true }
          );
          soundRef.current = sound;
          sound.setOnPlaybackStatusUpdate((status: any) => {
            if (status.isLoaded && status.didJustFinish) {
              bgMusicRef.current?.setVolumeAsync(0.15);
            }
          });
        })();
        break;
      }
    }
  }, [isDriving, drivingLocation, tourPois]);

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

    togglePanel(false);
    setIsDriving(true);

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    });

    try {
      const { data: routeRow } = await supabase
        .from("routes")
        .select("welcome_audio_url, music_track_id")
        .eq("id", routeId)
        .single();

      const { data: poiRows } = await supabase
        .from("route_pois")
        .select("id, name, lat, lng, audio_url, audio_duration_sec, is_neighborhood_intro")
        .eq("route_id", routeId)
        .order("sequence_order", { ascending: true });

      if (poiRows) setTourPois(poiRows);
      triggeredPoisRef.current = new Set();

      if (routeRow?.welcome_audio_url) {
        if (soundRef.current) await soundRef.current.unloadAsync();
        const { sound } = await Audio.Sound.createAsync(
          { uri: routeRow.welcome_audio_url },
          { shouldPlay: true }
        );
        soundRef.current = sound;
      }

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
        } catch {}
      }
    } catch (e) {
      console.warn("Start tour failed:", e);
    }
  };

  const handleExitDriving = async () => {
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

    if (routeData?.decodedPath?.length > 1) {
      const coordinates = routeData.decodedPath.map((p: any) => ({
        latitude: p.lat,
        longitude: p.lng,
      }));
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 80, right: 40, bottom: 300, left: 40 },
        animated: true,
      });
    } else if (userLoc) {
      mapRef.current?.animateToRegion({
        latitude: userLoc.lat,
        longitude: userLoc.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
  };

  // Gradient polyline segments
  const gradientSegments = routeData?.decodedPath ? getGradientSegments(routeData.decodedPath) : [];

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
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        customMapStyle={isDark ? darkMapStyle : lightMapStyle}
        showsUserLocation={!isDriving}
        showsMyLocationButton={false}
        initialRegion={{
          latitude: userLoc?.lat || 37.7749,
          longitude: userLoc?.lng || -122.4194,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Route polyline with gradient */}
        {gradientSegments.map((seg, i) => (
          <Polyline
            key={`route-seg-${i}`}
            coordinates={seg.coordinates}
            strokeColor={seg.color}
            strokeWidth={5}
          />
        ))}

        {/* Origin marker */}
        {routeData && (
          <Marker
            coordinate={{ latitude: routeData.originLat, longitude: routeData.originLng }}
            title="Start"
            image={markerImages.origin}
          />
        )}

        {/* Destination marker */}
        {routeData && (
          <Marker
            coordinate={{ latitude: routeData.destinationLat, longitude: routeData.destinationLng }}
            title="Destination"
            image={markerImages.destination}
          />
        )}

        {/* POI markers — numbered circles with brand colors */}
        {pois.map((poi: any, i: number) => (
          <Marker
            key={`poi-${i}`}
            coordinate={{ latitude: poi.location.lat, longitude: poi.location.lng }}
            title={poi.name}
          >
            <View style={[styles.poiMarker, {
              backgroundColor: isDark ? colors.mysticPurple : colors.rideBlue,
              borderColor: isDark ? colors.nearBlack : "#fff",
            }]}>
              <Text style={styles.poiMarkerText}>{i + 1}</Text>
            </View>
          </Marker>
        ))}

        {/* User location marker in driving mode */}
        {isDriving && drivingLocation && (
          <Marker
            coordinate={{ latitude: drivingLocation.lat, longitude: drivingLocation.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={drivingLocation.heading || 0}
            image={markerImages.userArrow}
          />
        )}
      </MapView>

      {/* Exit driving mode button */}
      {isDriving && (
        <TouchableOpacity style={styles.exitDrivingButton} onPress={handleExitDriving}>
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

          {/* Origin row — collapsed by default, shows "Current Location" */}
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
              {/* "Use Current Location" option for origin field */}
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
  poiMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  poiMarkerText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
});
