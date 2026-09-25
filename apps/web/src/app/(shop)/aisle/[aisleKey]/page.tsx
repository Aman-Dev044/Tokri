import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AISLE_KEYS, getAisle, isAisleKey } from '@mandi/design-system';
import { AisleView } from '@/components/shop/AisleView';

/**
 * ★ PILLAR 1 — THE DEMO MOMENT.
 *
 * Entering an aisle re-tints the ENTIRE interface over 480ms: accent, ambient
 * wash, card edges, button fills, the basket, the focus halo. One custom
 * property, whole-app effect. No competitor does this.
 *
 * ── HOW THE TINT IS STAMPED, TWICE, ON PURPOSE ──────────────────────────────
 * 1. The inline script below runs during the server-rendered document, before
 *    first paint, so a cold load of /aisle/fruits arrives already tomato-red.
 *    Without it the page paints moss-green and snaps — which turns the
 *    signature move into a flash of wrong colour.
 * 2. `AisleView` commits the same key through `AisleProvider` in an effect,
 *    which is what covers client-side navigation (where React does not execute
 *    an injected <script>) and what restores the previous aisle on the way out.
 *
 * The script is safe: `aisleKey` has already been checked against the eight
 * known keys, so the only thing that can reach it is one of eight literals.
 * Nothing user-supplied is interpolated.
 */

interface PageProps {
  params: Promise<{ aisleKey: string }>;
}

/** Eight routes, all statically known. */
export function generateStaticParams(): Array<{ aisleKey: string }> {
  return AISLE_KEYS.map((aisleKey) => ({ aisleKey }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { aisleKey } = await params;
  if (!isAisleKey(aisleKey)) return { title: 'Aisle' };
  const aisle = getAisle(aisleKey);
  return {
    title: `${aisle.name} · ${aisle.hindi}`,
    description: aisle.blurb,
  };
}

export default async function AislePage({ params }: PageProps) {
  const { aisleKey } = await params;
  if (!isAisleKey(aisleKey)) notFound();

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.setAttribute('data-aisle',${JSON.stringify(aisleKey)});`,
        }}
      />
      <AisleView aisleKey={aisleKey} />
    </>
  );
}
