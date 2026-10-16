/**
 * ════════════════════════════════════════════════════════════════════════
 *  EVERYTHING YOU'D LIKE TO KNOW
 * ════════════════════════════════════════════════════════════════════════
 *
 * Built on `<details>`/`<summary>`, not on `useState`. The browser gives
 * the open/closed state, the keyboard handling, the ARIA semantics and
 * find-in-page — Ctrl+F finds text inside a COLLAPSED native accordion,
 * which a div-and-state one hides from the browser entirely. On a page
 * whose job is to answer questions, that matters more than the animation
 * a hand-rolled version would buy.
 *
 * It also means this section is a server component: no JavaScript ships
 * for it at all.
 *
 * ── Every answer here is checked against the code ───────────────────────
 * These are not marketing sentences. The ₹2,000 cash ceiling, the free
 * cancellation until a vendor accepts, the per-line refund on a part
 * fulfilment and the integer-paise pricing are all real behaviour of this
 * API. An FAQ that promises something the service does not do is a support
 * ticket with extra steps.
 */

const QUESTIONS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'How long does an order take?',
    a: 'Typically about twenty minutes from the shop accepting it to the handover at your door, in the cities we serve. You see each stage as it happens — accepted, packed, picked up, on the way — rather than a countdown that guesses.',
  },
  {
    q: 'Can I pay cash?',
    a: 'Yes, up to ₹2,000, on any shop that has cash on delivery switched on. It is not a grudging fallback buried under a payment sheet here; it is half of how India buys groceries.',
  },
  {
    q: 'What if something I ordered is out of stock?',
    a: 'The shop part-fulfils the order and that single line refunds itself. Your whole basket does not fail over one missing lemon, and the price you were shown for everything else does not change.',
  },
  {
    q: 'Can I cancel?',
    a: 'Freely, with no charge and no argument, right up to the moment a vendor accepts. After that it needs their nod — and every step of that conversation is on the record.',
  },
  {
    q: 'Where do the groceries actually come from?',
    a: 'From shops already on your street — the kirana, the dairy, the bakery. Tokri is not a warehouse with a catalogue stapled on: each order is picked by a real shop near you, and you can browse store by store if you would rather.',
  },
  {
    q: 'Do you deliver to my area?',
    a: 'Check your PIN code above — it asks the same list the checkout uses, so a yes there is a yes at payment. We are in Bengaluru, Mumbai, New Delhi, Hyderabad, Pune and Ahmedabad so far.',
  },
  {
    q: 'How do I sell on Tokri?',
    a: 'Apply as a vendor and you get your own console: your catalogue, your stock, your orders and your settlements, kept separate from every other shop on the platform. Approval is a human reading your application, not an automatic yes.',
  },
];

export function Faq() {
  return (
    <section className="mk-sec" id="faq">
      <div className="mk-shell">
        <header className="mk-sec__head">
          <p className="mk-eyebrow">Questions</p>
          <h2 className="mk-title">Everything you&rsquo;d like to know.</h2>
        </header>

        <div className="mk-faq">
          {QUESTIONS.map((item) => (
            <details className="mk-faq__item" key={item.q}>
              <summary className="mk-faq__q">
                <span>{item.q}</span>
                <span className="mk-faq__mark" aria-hidden="true" />
              </summary>
              <p className="mk-faq__a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
