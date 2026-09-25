'use client';

import type { ReactNode } from 'react';
import {
  AisleProvider,
  CircadianProvider,
  ThemeProvider,
  ToastProvider,
} from '@mandi/design-system';
import { AuthProvider } from '@/components/auth/AuthProvider';

/**
 * One client boundary at the root, so `layout.tsx` itself stays a Server
 * Component and keeps its metadata, fonts and static rendering.
 *
 * Order matters:
 *   ThemeProvider     light / dark / system      -> stamps data-theme
 *   CircadianProvider clock, client-side only    -> stamps data-time
 *   AisleProvider     chromatic aisles           -> stamps data-aisle
 *   AuthProvider      in-memory access token
 *   ToastProvider     needs to sit inside auth so a 401 can raise a toast
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <CircadianProvider>
        <AisleProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </AisleProvider>
      </CircadianProvider>
    </ThemeProvider>
  );
}
