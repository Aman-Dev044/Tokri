'use client';

/**
 * PILLAR 2, shown rather than described.
 *
 * Four swatch plates, each rendered with `data-time` forced onto it, so the
 * visitor sees the four grounds side by side while the page itself is already
 * sitting in whichever one their clock says.
 *
 * The "you are here" marker is the only part that depends on the real clock,
 * and it is computed in an effect - never during render. Server time is not the
 * user's time, and a server-rendered "night" plate for a user at noon is a
 * hydration mismatch that React will scream about in development and silently
 * mis-paint in production.
 */

import { useEffect, useState } from 'react';
import { TIME_OF_DAY_LABEL, timeOfDayFor } from '@mandi/design-system';
import type { TimeOfDay } from '@mandi/design-system';

const WINDOWS: ReadonlyArray<{ key: TimeOfDay; range: string; note: string }> = [
  { key: 'dawn', range: '05:00 — 11:00', note: 'cool, pale, high-clarity paper' },
  { key: 'day', range: '11:00 — 17:00', note: 'neutral paper, maximum contrast' },
  { key: 'dusk', range: '17:00 — 21:00', note: 'warm amber lift, softened edges' },
  { key: 'night', range: '21:00 — 05:00', note: 'low glare, accents dimmed' },
];

export function CircadianStrip() {
  const [now, setNow] = useState<TimeOfDay | null>(null);

  useEffect(() => {
    setNow(timeOfDayFor(new Date()));
  }, []);

  return (
    <div className="circadian">
      {WINDOWS.map(({ key, range, note }) => {
        const isNow = now === key;
        return (
          // data-time on the plate itself re-scopes the ground tokens to that
          // window, so each plate is a genuine sample and not a painted mockup.
          <figure className="circadian__plate" data-time={key} key={key} data-now={isNow}>
            <div className="circadian__ground">
              <span className="circadian__ink">Aa</span>
              <span className="circadian__chip" aria-hidden="true" />
            </div>
            <figcaption>
              <span className="circadian__name">
                {TIME_OF_DAY_LABEL[key]}
                {isNow ? (
                  <span className="circadian__badge mono">you are here</span>
                ) : null}
              </span>
              <span className="circadian__range mono">{range}</span>
              <span className="circadian__note">{note}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
