'use client';

import type { ReactNode } from 'react';
import { AisleProvider, ThemeProvider, ToastProvider } from '@mandi/design-system';
import { AuthProvider } from '@/components/auth/AuthProvider';

/**
 * One client boundary at the root, so `layout.tsx` itself stays a Server
 * Component and keeps its metadata, fonts and static rendering.
 *
 * Order matters:
 *   ThemeProvider  light / dark / system   -> stamps data-theme
 *   AisleProvider  chromatic aisles        -> stamps data-aisle
 *   AuthProvider   in-memory access token
 *   ToastProvider  sits inside auth so a 401 can raise a toast
 *
 * CircadianProvider was REMOVED here when the design moved to Bento Pop.
 * It stamped `data-time` on <html> from the browser clock, and the old
 * token set shifted the ground for dawn/day/dusk/night off that attribute.
 * Bento Pop has no time-of-day tokens, so nothing read the attribute any
 * more — it was doing nothing but producing a hydration mismatch warning
 * on every page, because the server cannot know the viewer's local hour.
 * The provider itself still ships in the design system for whoever wants
 * that behaviour back; it just is not mounted.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AisleProvider>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </AisleProvider>
    </ThemeProvider>
  );
}
