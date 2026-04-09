import { View, Text, StyleSheet, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fontSize } from "../../src/theme";

export default function ToursScreen() {
  const isDark = useColorScheme() === "dark";
  const theme = isDark ? colors.dark : colors.light;

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
