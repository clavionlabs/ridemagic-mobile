import { View, Text, StyleSheet, useColorScheme, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, fontSize, spacing, borderRadius } from "../../src/theme";
import { useAuth } from "../../src/hooks/useAuth";

export default function AccountScreen() {
  const isDark = useColorScheme() === "dark";
  const theme = isDark ? colors.dark : colors.light;
  const { user, signOut } = useAuth();
  const router = useRouter();

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
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>Account</Text>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>Email</Text>
        <Text style={[styles.value, { color: theme.text }]}>{user?.email || "Not signed in"}</Text>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  title: { fontSize: fontSize.xxl, fontWeight: "700", marginBottom: spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  label: { fontSize: fontSize.xs, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  value: { fontSize: fontSize.md, fontWeight: "600" },
  signOutButton: {
    backgroundColor: colors.errorRed,
    borderRadius: borderRadius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  signOutText: { color: "#fff", fontSize: fontSize.md, fontWeight: "700" },
});
