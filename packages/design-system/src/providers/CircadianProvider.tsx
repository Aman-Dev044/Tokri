'use client';

/**
 * PILLAR 2 - CIRCADIAN GROUND
 *
 * The ground shifts with the clock, INSIDE whichever light/dark theme is active.
 * The store at 7am does not look like the store at 11pm.
 *
 *   05:00-11:00  dawn    cool, pale, high-clarity paper
 *   11:00-17:00  day     neutral paper, maximum contrast
 *   17:00-21:00  dusk    warm amber lift, softened edges
 *   21:00-05:00  night   deep ink, low glare, accents dimmed
 *
 * CRITICAL: this is computed CLIENT-SIDE ONLY, in an effect, never during SSR.
 * Server time is not the user's time. Rendering a "night" page for a user at
 * noon is a hydration mismatch - and on a global CDN it is guaranteed.
 *
 * Consequence: the first paint has no `data-time` attribute at all. That is
 * intentional and safe, because :root in tokens.css defines the full neutral
 * "day" token set already; `data-time` only modulates it.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export function timeOfDayFor(date: Date): TimeOfDay {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'dawn';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 21) return 'dusk';
  return 'night';
}

export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  dawn: 'Dawn',
  day: 'Midday',
  dusk: 'Dusk',
  night: 'Night',
};

interface CircadianContextValue {
  /** null until the client effect has run - never read this during render for layout */
  timeOfDay: TimeOfDay | null;
}

const CircadianContext = createContext<CircadianContextValue>({ timeOfDay: null });

export interface CircadianProviderProps {
  children: ReactNode;
  /**
   * Overrides the clock. Used only by the landing page's circadian demo strip
   * and by tests - never in a real route.
   */
  force?: TimeOfDay;
}

export function CircadianProvider({ children, force }: CircadianProviderProps) {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | null>(null);

  useEffect(() => {
    if (force) {
      setTimeOfDay(force);
      return;
    }

    const apply = () => setTimeOfDay(timeOfDayFor(new Date()));
    apply();

    // Re-check hourly. A user who leaves the tab open through 17:00 should
    // watch the ground warm up rather than be stuck in "day" until reload.
    const id = window.setInterval(apply, 60 * 60 * 1000);

    // Waking a laptop after 6 hours would otherwise wait for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') apply();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [force]);

  useEffect(() => {
    if (!timeOfDay) return;
    document.documentElement.setAttribute('data-time', timeOfDay);
  }, [timeOfDay]);

  const value = useMemo<CircadianContextValue>(() => ({ timeOfDay }), [timeOfDay]);

  return (
    <CircadianContext.Provider value={value}>{children}</CircadianContext.Provider>
  );
}

export function useCircadian(): CircadianContextValue {
  return useContext(CircadianContext);
}
