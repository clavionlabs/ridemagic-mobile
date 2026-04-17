import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { NavigationProvider } from "@googlemaps/react-native-navigation-sdk";
import { ThemeProvider, useTheme } from "../src/hooks/useTheme";
import { ActiveTourProvider } from "../src/hooks/useActiveTour";

function ThemedRoot() {
  const { isDark, theme } = useTheme();
  return (
    <NavigationProvider
      termsAndConditionsDialogOptions={{
        title: "RideMagic Navigation",
        companyName: "RideMagic",
        showOnlyDisclaimer: true,
      }}
    >
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="tour/[id]"
          options={{
            headerShown: false,
            presentation: "fullScreenModal",
            gestureEnabled: false,
          }}
        />
      </Stack>
    </NavigationProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ActiveTourProvider>
        <ThemedRoot />
      </ActiveTourProvider>
    </ThemeProvider>
  );
}
