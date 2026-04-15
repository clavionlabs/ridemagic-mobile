import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, fontSize, spacing, borderRadius } from "../../src/theme";
import { useAuth } from "../../src/hooks/useAuth";
import { useTheme, type ThemeOption } from "../../src/hooks/useTheme";
import * as api from "../../src/services/api";

interface JourneyStats {
  total_routes: number;
  total_pois_visited: number;
  total_neighborhoods_visited: number;
  total_distance_miles: number;
  total_audio_minutes: number;
  first_tour_at: string | null;
  last_tour_at: string | null;
}

interface TopicItem {
  topic_id: string;
  topic_name: string;
  topic_category: string;
  mention_count: number;
}

const NOTIFICATIONS_KEY = "@ridemagic:notifications";

export default function AccountScreen() {
  const { isDark, theme, themePref, setThemePref } = useTheme();
  const { user, signOut } = useAuth();
  const router = useRouter();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [stats, setStats] = useState<JourneyStats | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const displayName =
    (user as any)?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Load saved notifications preference (theme is owned by ThemeProvider)
  useEffect(() => {
    (async () => {
      try {
        const storedNotif = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
        if (storedNotif !== null) {
          setNotificationsEnabled(storedNotif === "true");
        }
      } catch {}
    })();
  }, []);

  // Fetch journey stats and topics
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [statsRes, topicsRes] = await Promise.all([
          api.getUserStats().catch(() => null),
          api.getUserTopics().catch(() => null),
        ]);
        if (statsRes?.stats) setStats(statsRes.stats);
        if (topicsRes?.topics) setTopics(topicsRes.topics);
      } catch {
        // Stats are non-critical
      } finally {
        setStatsLoading(false);
      }
    })();
  }, [user]);

  const handleThemeChange = async (newTheme: ThemeOption) => {
    await setThemePref(newTheme);
  };

  const handleNotificationsToggle = async (value: boolean) => {
    setNotificationsEnabled(value);
    try { await AsyncStorage.setItem(NOTIFICATIONS_KEY, String(value)); } catch {}
  };

  const handleSignOut = async () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.displayName, { color: theme.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.email, { color: theme.textSecondary }]} numberOfLines={1}>
              {email}
            </Text>
          </View>
        </View>

        {/* Journey Stats */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>YOUR JOURNEY</Text>

        {statsLoading ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, padding: spacing.lg, alignItems: "center" }]}>
            <ActivityIndicator color={colors.rideBlue} />
          </View>
        ) : stats && stats.total_routes > 0 ? (
          <>
            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.statValue, { color: colors.rideBlue }]}>{stats.total_routes}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Tours</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.statValue, { color: colors.mysticPurple }]}>{stats.total_pois_visited}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Places Visited</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.statValue, { color: colors.magicGreen }]}>{stats.total_neighborhoods_visited}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Neighborhoods</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.statValue, { color: theme.text }]}>
                  {Number(stats.total_distance_miles).toFixed(1)}
                </Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Miles Explored</Text>
              </View>
            </View>

            <View style={[styles.audioCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={styles.audioIcon}>
                <Text style={{ fontSize: 18 }}>⏱</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.audioMinutes, { color: theme.text }]}>
                  {Number(stats.total_audio_minutes).toFixed(0)} minutes
                </Text>
                <Text style={[styles.audioSub, { color: theme.textSecondary }]}>Audio listened</Text>
              </View>
            </View>

            {topics.length > 0 && (
              <View style={[styles.topicsCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.topicsTitle, { color: theme.textSecondary }]}>TOPICS EXPLORED</Text>
                <View style={styles.topicsRow}>
                  {topics.slice(0, 8).map((t) => (
                    <View key={t.topic_id} style={styles.topicChip}>
                      <Text style={styles.topicText}>
                        {t.topic_name}
                        {t.mention_count > 1 && (
                          <Text style={styles.topicCount}> ×{t.mention_count}</Text>
                        )}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        ) : (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, padding: spacing.lg, alignItems: "center" }]}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              No tours yet. Start exploring!
            </Text>
            <TouchableOpacity
              style={styles.planButton}
              onPress={() => router.push("/(tabs)")}
            >
              <Text style={styles.planButtonText}>Plan Your First Tour</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Settings */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: spacing.lg }]}>SETTINGS</Text>

        <View style={[styles.settingsCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {/* Appearance */}
          <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
            <Text style={[styles.settingLabel, { color: theme.text, marginBottom: spacing.sm }]}>
              Appearance
            </Text>
            <View style={[styles.themeToggle, { backgroundColor: isDark ? colors.nearBlack : colors.cream }]}>
              {(["light", "dark", "system"] as ThemeOption[]).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => handleThemeChange(opt)}
                  style={[
                    styles.themeOption,
                    themePref === opt && { backgroundColor: isDark ? colors.charcoal : "#fff" },
                  ]}
                >
                  <Text
                    style={[
                      styles.themeOptionText,
                      { color: themePref === opt ? theme.text : theme.textSecondary },
                    ]}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Audio Quality */}
          <View style={[styles.settingRow, styles.settingRowInline, { borderBottomColor: theme.border }]}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Audio Quality</Text>
            <Text style={[styles.settingValue, { color: colors.rideBlue }]}>High</Text>
          </View>

          {/* Notifications */}
          <View style={[styles.settingRow, styles.settingRowInline, { borderBottomWidth: 0 }]}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Notifications</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotificationsToggle}
              trackColor={{ false: theme.border, true: colors.rideBlue }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.rideBlue,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  displayName: { fontSize: fontSize.lg, fontWeight: "700" },
  email: { fontSize: fontSize.sm, marginTop: 2 },

  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },

  card: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
  },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statCard: {
    flexBasis: "48%",
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  statValue: { fontSize: fontSize.xxl, fontWeight: "800" },
  statLabel: { fontSize: fontSize.xs, marginTop: 4 },

  audioCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  audioIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 120, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  audioMinutes: { fontSize: fontSize.md, fontWeight: "600" },
  audioSub: { fontSize: fontSize.xs, marginTop: 2 },

  topicsCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  topicsTitle: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  topicsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  topicChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(124, 92, 252, 0.1)",
  },
  topicText: { color: colors.mysticPurple, fontSize: fontSize.xs, fontWeight: "500" },
  topicCount: { color: "rgba(124, 92, 252, 0.6)" },

  emptyText: { fontSize: fontSize.sm, marginBottom: spacing.md },
  planButton: {
    backgroundColor: colors.rideBlue,
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  planButtonText: { color: "#fff", fontWeight: "600", fontSize: fontSize.sm },

  settingsCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    overflow: "hidden",
  },
  settingRow: {
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingRowInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  settingLabel: { fontSize: fontSize.md, fontWeight: "500" },
  settingValue: { fontSize: fontSize.md, fontWeight: "500" },

  themeToggle: {
    flexDirection: "row",
    borderRadius: borderRadius.md,
    padding: 4,
    gap: 4,
  },
  themeOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
    alignItems: "center",
  },
  themeOptionText: { fontSize: fontSize.xs, fontWeight: "600" },

  signOutButton: {
    marginTop: spacing.xl,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.errorRed,
    borderRadius: borderRadius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutText: { color: colors.errorRed, fontSize: fontSize.md, fontWeight: "700" },
});
