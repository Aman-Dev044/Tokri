import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StoresView } from '@/components/shop/StoresView';

export const metadata: Metadata = {
  title: 'Stores near you',
  description:
    'The kirana, dairy, bakery and cold store actually near you — with real distance, real opening hours and an honest delivery estimate.',
};

export default function StoresPage() {
  return (
    <Suspense fallback={null}>
      <StoresView />
    </Suspense>
  );
}
