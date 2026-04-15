import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../src/theme";
import { useTheme } from "../../src/hooks/useTheme";

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  // Simple text-based icons — replace with proper icons later
  const icons: Record<string, string> = {
    home: "🏠",
    routes: "🗺️",
    tours: "🔊",
    account: "👤",
  };
  return null; // Icons handled by tabBarIcon below
}

export default function TabLayout() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.rideBlue,
        tabBarInactiveTintColor: isDark ? colors.dark.textSecondary : colors.light.textSecondary,
        tabBarStyle: {
          backgroundColor: isDark ? colors.dark.surface : colors.light.surface,
          borderTopColor: isDark ? colors.dark.border : colors.light.border,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 8,
          height: 64 + (insets.bottom > 0 ? insets.bottom : 0),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="routes"
        options={{
          title: "My Routes",
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="map" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="tours"
        options={{
          title: "Tours",
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="headphones" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, size }) => (
            <TabBarIcon name="user" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

// Simple SVG-free icon component using Unicode
function TabBarIcon({ name, color, size }: { name: string; color: string; size: number }) {
  const { Text } = require("react-native");
  const iconMap: Record<string, string> = {
    home: "⌂",
    map: "🗺",
    headphones: "🎧",
    user: "👤",
  };
  return (
    <Text style={{ fontSize: size - 4, color, textAlign: "center" }}>
      {iconMap[name] || "●"}
    </Text>
  );
}
