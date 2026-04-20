import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../src/theme";
import { useTheme } from "../../src/hooks/useTheme";
import {
  HomeIcon,
  RoutesIcon,
  ToursIcon,
  AccountIcon,
} from "../../src/components/DrawerIcons";

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
          tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="routes"
        options={{
          title: "My Tours",
          tabBarIcon: ({ color, size }) => <RoutesIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tours"
        options={{
          title: "Explore",
          tabBarIcon: ({ color, size }) => <ToursIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, size }) => <AccountIcon color={color} size={size} />,
        }}
      />
      {/* Sim Tour — a sub-route inside (tabs) so the bottom tab bar stays visible,
          but hidden from the tab bar itself via href: null */}
      <Tabs.Screen
        name="tour/[id]"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
