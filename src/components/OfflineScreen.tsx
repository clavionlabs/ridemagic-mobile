import { useEffect, useState, ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../hooks/useTheme";
import { colors, spacing, fontSize, borderRadius } from "../theme";

/**
 * Wraps the entire app and renders a fullscreen "No Internet Connection"
 * screen whenever the device loses connectivity (WiFi off + mobile data off,
 * or both unable to reach the internet). Auto-dismisses when reconnected.
 */
export function OfflineGate({ children }: { children: ReactNode }) {
  const { isDark, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Subscribe to connection changes — fires whenever WiFi/mobile flips
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable is null on first emit; treat null as connected
      // until we get a definitive false.
      const reachable = state.isInternetReachable;
      const connected = state.isConnected && reachable !== false;
      setIsOnline(!!connected);
    });

    // Initial check on mount
    NetInfo.fetch().then((state) => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(!!connected);
    });

    return () => unsubscribe();
  }, []);

  const handleRetry = async () => {
    setChecking(true);
    try {
      const state = await NetInfo.fetch();
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsOnline(!!connected);
    } finally {
      setChecking(false);
    }
  };

  if (isOnline) return <>{children}</>;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={styles.content}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.1)" },
          ]}
        >
          <Text style={styles.iconText}>📡</Text>
        </View>

        <Text style={[styles.title, { color: theme.text }]}>No Internet Connection</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          RideMagic needs an internet connection to discover tours and stream audio.
          Please check your WiFi or mobile data and try again.
        </Text>

        <TouchableOpacity
          style={[styles.retryButton, checking && styles.retryButtonDisabled]}
          onPress={handleRetry}
          disabled={checking}
          activeOpacity={0.8}
        >
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.retryText}>Try Again</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  content: {
    alignItems: "center",
    maxWidth: 360,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  iconText: {
    fontSize: 48,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    fontSize: fontSize.md,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  retryButton: {
    backgroundColor: colors.rideBlue,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    minWidth: 160,
    alignItems: "center",
  },
  retryButtonDisabled: { opacity: 0.6 },
  retryText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
});
