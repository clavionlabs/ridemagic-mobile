import { Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fontSize } from "../../src/theme";
import { useTheme } from "../../src/hooks/useTheme";

export default function ToursScreen() {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>Tours</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Your audio tours will appear here
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: fontSize.xl, fontWeight: "700", marginBottom: 8 },
  subtitle: { fontSize: fontSize.md },
});
