'use client';

/**
 * ★ THE NEW-ORDER ALERT.
 *
 * A shop owner is not looking at this screen. They are weighing onions. The
 * panel has to reach across the room, and then stop.
 *
 * ── WHY THE SOUND IS SYNTHESISED ────────────────────────────────────────────
 * Two short sine tones through the Web Audio API rather than an mp3: no asset
 * to ship, no 404 in the one moment it matters, no CSP `media-src` exception,
 * and it is audible over a shop's background noise without being a klaxon.
 *
 * ── WHY IT IS OPT-IN, AND WHY THAT IS NOT LAZINESS ──────────────────────────
 * Every browser refuses to play audio until the user has interacted with the
 * page — an autoplay policy, not a bug. So a "sound on" default would silently
 * fail on a tab nobody has clicked yet, which is worse than being off: the
 * vendor would believe they are being alerted when they are not. The toggle
 * makes the first play a user gesture, and `armed` records whether that gesture
 * has happened.
 *
 * The preference is in localStorage — deliberately. It is a UI preference, not
 * a credential. Nothing sensitive ever goes near storage in this app (plan
 * §4.3); a boolean about beeping is exactly the thing localStorage is for. It
 * is read and written inside try/catch because a private window, a locked-down
 * device or a full quota all throw, and a preference that does not survive a
 * reload is not an error worth breaking a screen over.
 */

const SOUND_KEY = 'mandi.vendor.orderSound';

export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === '1';
  } catch {
    // Private window / storage disabled. Default to silent.
    return false;
  }
}

export function writeSoundPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
  } catch {
    // A preference that does not survive a reload is not an error.
  }
}

/* ------------------------------------------------------------------ */
/* The tone                                                            */
/* ------------------------------------------------------------------ */

type AudioContextCtor = new () => AudioContext;

/**
 * `webkitAudioContext` is still the only constructor on older iOS Safari, and
 * it is not on the `Window` type. Narrowed here rather than cast with `any`,
 * which the project bans outright.
 */
function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/**
 * Two rising notes, ~360ms total. Called once per arrival — never on a loop.
 *
 * Returns false when the browser refused (no Web Audio, or no user gesture
 * yet), so the caller can show the visual alert as the only alert rather than
 * pretending a sound happened.
 */
export function playNewOrderChime(): boolean {
  const ctx = ensureContext();
  if (!ctx) return false;

  try {
    // A context created before any user gesture starts suspended. Resuming is
    // a no-op when it is already running.
    void ctx.resume();

    const now = ctx.currentTime;
    const notes: ReadonlyArray<[number, number]> = [
      [880, 0],
      [1318.5, 0.16],
    ];

    for (const [frequency, offset] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;

      // An envelope, not a square switch: an instant on/off on a sine is a
      // click, and a click is what makes a notification sound cheap.
      const start = now + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Unlock audio from inside a click handler.
 *
 * Playing a silent buffer during a real user gesture is what converts a
 * suspended context into a running one on iOS. Without this the first genuine
 * chime — which arrives with no gesture attached — is dropped.
 */
export function primeAudio(): void {
  const ctx = ensureContext();
  if (!ctx) return;
  try {
    void ctx.resume();
    const buffer = ctx.createBuffer(1, 1, 22_050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Nothing to do — the toggle simply will not make noise on this device.
  }
}
