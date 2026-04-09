import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fontSize, spacing, borderRadius } from "../../src/theme";
import { useAuth } from "../../src/hooks/useAuth";
import { supabase } from "../../src/lib/supabase";

interface Route {
  id: string;
  origin_address: string;
  destination_address: string;
  total_distance_m: number;
  total_duration_sec: number;
  tour_theme: string | null;
  tour_summary: string | null;
  status: string;
  created_at: string;
  poi_count?: number;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const gradientColors = [
  [colors.rideBlue, "#7C5CFC"],
  ["#7C5CFC", colors.magicGreen],
  [colors.magicGreen, colors.rideBlue],
];

export default function RoutesScreen() {
  const isDark = useColorScheme() === "dark";
  const theme = isDark ? colors.dark : colors.light;
  const router = useRouter();
  const { user } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function fetchRoutes() {
      const { data } = await supabase
        .from("routes")
        .select(
          "id, origin_address, destination_address, total_distance_m, total_duration_sec, tour_theme, tour_summary, status, created_at"
        )
        .eq("user_id", user!.id)
        .eq("status", "ready")
        .order("created_at", { ascending: false });

      if (data && data.length > 0) {
        // Get POI counts
        const routeIds = data.map((r: Route) => r.id);
        const { data: poiData } = await supabase
          .from("route_pois")
          .select("route_id")
          .in("route_id", routeIds);

        const poiCounts: Record<string, number> = {};
        poiData?.forEach((p: { route_id: string }) => {
          poiCounts[p.route_id] = (poiCounts[p.route_id] || 0) + 1;
        });

        setRoutes(
          data.map((r: Route) => ({ ...r, poi_count: poiCounts[r.id] || 0 }))
        );
      }
      setLoading(false);
    }

    fetchRoutes();
  }, [user]);

  const renderRoute = ({ item, index }: { item: Route; index: number }) => {
    const originShort = item.origin_address.split(",")[0];
    const destShort = item.destination_address.split(",")[0];
    const gradientIdx = index % gradientColors.length;

    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        {/* Gradient top bar */}
        <View
          style={[
            styles.gradientBar,
            { backgroundColor: gradientColors[gradientIdx][0] },
          ]}
        />

        <View style={styles.cardContent}>
          <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {item.tour_theme || `${originShort} → ${destShort}`}
          </Text>
          <Text style={[styles.cardDate, { color: theme.textSecondary }]}>
            {formatDate(item.created_at)}
          </Text>

          {item.tour_summary && (
            <Text
              style={[styles.cardSummary, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {item.tour_summary}
            </Text>
          )}

          <View style={styles.cardMeta}>
            <Text style={[styles.cardMetaText, { color: theme.textSecondary }]}>
              {formatDistance(item.total_distance_m)} ·{" "}
              {formatDuration(item.total_duration_sec)}
            </Text>
            {item.poi_count ? (
              <Text style={[styles.cardMetaText, { color: theme.textSecondary }]}>
                · {item.poi_count} POIs
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            style={styles.viewButton}
            onPress={() => router.push(`/tour/${item.id}`)}
          >
            <Text style={styles.viewButtonText}>View Tour</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View
        style={[styles.emptyIcon, { backgroundColor: "rgba(124, 92, 252, 0.1)" }]}
      >
        <Text style={{ fontSize: 28 }}>🗺</Text>
      </View>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>No routes yet</Text>
      <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
        Plan your first ride from the dashboard
      </Text>
      <TouchableOpacity
        style={styles.planButton}
        onPress={() => router.push("/(tabs)")}
      >
        <Text style={styles.planButtonText}>✨ Plan a Ride</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>My Routes</Text>

      {loading ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.skeleton,
                { backgroundColor: isDark ? colors.charcoal : "#E5E0DB" },
              ]}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={routes}
          renderItem={renderRoute}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={routes.length === 0 ? styles.emptyList : styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg },
  title: {
    fontSize: fontSize.xl,
    fontWeight: "700",
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  loadingContainer: { gap: spacing.md },
  skeleton: {
    height: 140,
    borderRadius: borderRadius.md,
  },
  list: { paddingBottom: spacing.xxl, gap: spacing.md },
  emptyList: { flex: 1 },
  card: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  gradientBar: {
    height: 4,
    width: "100%",
  },
  cardContent: {
    padding: spacing.md,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: "700",
    marginBottom: 2,
  },
  cardDate: {
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
  },
  cardSummary: {
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  cardMetaText: {
    fontSize: fontSize.sm,
  },
  viewButton: {
    backgroundColor: colors.rideBlue,
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    alignItems: "center",
  },
  viewButtonText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.md,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  planButton: {
    backgroundColor: colors.rideBlue,
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  planButtonText: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
});
