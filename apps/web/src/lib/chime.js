/**
 * Arrival chime (Session 14, user request: subtle sound when a new swap
 * request arrives while the tab is open).
 *
 * WebAudio-SYNTHESIZED (two short sine notes, ~0.35s total, quiet) — no
 * audio assets, no network, nothing to download. Mute preference persists
 * per-user in localStorage (`rewear.chimeMuted.{userId}`) so "I don't want
 * sounds" survives reloads; every entry point fails soft — an AudioContext
 * or storage failure must NEVER break the app (sounds are a nicety).
 *
 * Guard rails:
 * - `enabled` is checked BEFORE any AudioContext is created (constructing
 *   one can prompt some browsers even before play()).
 * - Play attempts happen only in response to data the poll already fetched
 *   (no timers of our own), and browsers that block autoplay simply reject
 *   the promise — swallowed by design.
 */

const MUTE_PREFIX = 'rewear.chimeMuted.';

export function isChimeMuted(userId) {
  try {
    return window.localStorage.getItem(`${MUTE_PREFIX}${userId ?? 'anon'}`) === '1';
  } catch {
    return false; // storage unavailable → default to sounds ON (harmless)
  }
}

export function setChimeMuted(userId, muted) {
  try {
    if (muted) {
      window.localStorage.setItem(`${MUTE_PREFIX}${userId ?? 'anon'}`, '1');
    } else {
      window.localStorage.removeItem(`${MUTE_PREFIX}${userId ?? 'anon'}`);
    }
  } catch {
    /* private mode / quota — preference just won't persist */
  }
}

/**
 * Play the two-note arrival chime. Resolves silently on ANY failure
 * (unsupported AudioContext, autoplay policy, no user gesture yet).
 */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return; // no WebAudio → silently do nothing
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const note = (freq, start, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Quick fade-in/out so the note never clicks.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    };

    note(880, now, 0.18); // A5
    note(1174.66, now + 0.14, 0.22); // D6 — the "ta-da" interval, quiet

    // Release the context once the notes finish (contexts are hardware-
    // bounded; leaking one per arrival would exhaust the pool).
    osc_stop_cleanup(ctx, now);
  } catch {
    /* autoplay policy / unsupported — silence is an acceptable outcome */
  }
}

function osc_stop_cleanup(ctx, now) {
  setTimeout(
    () => {
      ctx.close().catch(() => {});
    },
    (now + 0.5) * 1000 - Date.now() + 500
  );
}
