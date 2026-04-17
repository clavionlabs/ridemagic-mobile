import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type TourMode = "driving" | "simulating" | null;

interface ActiveTourContextValue {
  /** The route ID of the currently active tour, or null if none. */
  activeTourId: string | null;
  /** Whether the tour is being driven (home page Nav SDK) or simulated (tour page replay). */
  activeTourMode: TourMode;
  /** Call when starting a tour — sets the active tour + mode. */
  startTour: (routeId: string, mode: "driving" | "simulating") => void;
  /** Call when exiting/completing a tour — clears the active state. */
  stopTour: () => void;
}

const ActiveTourContext = createContext<ActiveTourContextValue | null>(null);

export function ActiveTourProvider({ children }: { children: ReactNode }) {
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [activeTourMode, setActiveTourMode] = useState<TourMode>(null);

  const startTour = useCallback((routeId: string, mode: "driving" | "simulating") => {
    setActiveTourId(routeId);
    setActiveTourMode(mode);
  }, []);

  const stopTour = useCallback(() => {
    setActiveTourId(null);
    setActiveTourMode(null);
  }, []);

  const value = useMemo<ActiveTourContextValue>(
    () => ({ activeTourId, activeTourMode, startTour, stopTour }),
    [activeTourId, activeTourMode, startTour, stopTour]
  );

  return (
    <ActiveTourContext.Provider value={value}>
      {children}
    </ActiveTourContext.Provider>
  );
}

export function useActiveTour(): ActiveTourContextValue {
  const ctx = useContext(ActiveTourContext);
  if (!ctx) {
    throw new Error("useActiveTour must be used inside ActiveTourProvider");
  }
  return ctx;
}
