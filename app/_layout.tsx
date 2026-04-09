import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { NavigationProvider } from "@googlemaps/react-native-navigation-sdk";
import { colors } from "../src/theme";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark ? colors.dark : colors.light;

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
