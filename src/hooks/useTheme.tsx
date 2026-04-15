import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors as palette } from "../theme";

export type ThemeOption = "light" | "dark" | "system";

interface ThemeContextValue {
  themePref: ThemeOption;
  isDark: boolean;
  theme: typeof palette.light;
  setThemePref: (pref: ThemeOption) => Promise<void>;
}

const THEME_STORAGE_KEY = "@ridemagic:theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [themePref, setThemePrefState] = useState<ThemeOption>("system");
  const [hydrated, setHydrated] = useState(false);

  // Load saved preference once on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === "light" || stored === "dark" || stored === "system") {
          setThemePrefState(stored);
        }
      } catch {}
      setHydrated(true);
    })();
  }, []);

  const isDark = themePref === "system"
    ? systemColorScheme === "dark"
    : themePref === "dark";

  const theme = isDark ? palette.dark : palette.light;

  const setThemePref = useCallback(async (pref: ThemeOption) => {
    setThemePrefState(pref);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {}
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ themePref, isDark, theme, setThemePref }),
    [themePref, isDark, theme, setThemePref]
  );

  // Don't render children until we've read the saved preference,
  // otherwise the app flashes in the wrong theme on launch.
  if (!hydrated) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return ctx;
}
