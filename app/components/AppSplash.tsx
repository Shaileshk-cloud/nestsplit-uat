"use client";

/**
 * AppSplash — launch-only animated intro for NestSplit.
 *
 * Lifecycle contract (driven by parent):
 *   authReady prop:  false while Supabase session is initializing
 *                    true  once initialization completes (success or error)
 *
 *   onDone callback: called once after:
 *     (a) the full animation sequence has played through (~3 s), AND
 *     (b) authReady is true
 *   Whichever condition arrives later, the component waits for both.
 *
 * Replay prevention:
 *   sessionStorage flag "ns:splashed" is set on first render.
 *   If the flag is already set (e.g. React HMR, workspace switch, soft nav)
 *   the component calls onDone immediately and renders nothing — the normal
 *   app takes over with zero delay.
 *
 * Reduced-motion:
 *   matchMedia("prefers-reduced-motion: reduce") is checked at mount.
 *   If true, the ANIMATION_MS constant is shortened to 400 ms so the
 *   branding appears briefly without any movement, then hands off.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import "./splash.css";

// Total duration of the animation sequence before the outro begins (ms).
// Must match the CSS hold point (~3 000 ms normal, ~400 ms reduced-motion).
const ANIMATION_MS_NORMAL  = 3000;
const ANIMATION_MS_REDUCED = 400;

// sessionStorage key — set on first show, checked to skip on subsequent mounts.
const SPLASH_FLAG = "ns:splashed";

interface AppSplashProps {
  /** True once auth/session init has completed (success or error). */
  authReady: boolean;
  /** Called when both the animation has finished and authReady is true. */
  onDone: () => void;
}

export default function AppSplash({ authReady, onDone }: AppSplashProps) {
  // ── Replay guard ────────────────────────────────────────────────────────
  // Check once at module evaluation time (SSR-safe: typeof window guard).
  // Using a module-level variable avoids a render cycle for the "skip" path.
  const shouldSkip =
    typeof window !== "undefined" &&
    window.sessionStorage.getItem(SPLASH_FLAG) === "1";

  const [leaving, setLeaving]         = useState(false);
  const [visible, setVisible]         = useState(!shouldSkip);
  const animDoneRef                   = useRef(false);
  const authReadyRef                  = useRef(authReady);
  const onDoneRef                     = useRef(onDone);
  const timerRef                      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync without adding them to dependency arrays.
  useEffect(() => { authReadyRef.current = authReady; }, [authReady]);
  useEffect(() => { onDoneRef.current = onDone; },      [onDone]);

  // ── Trigger the dismiss sequence ────────────────────────────────────────
  const dismiss = useCallback(() => {
    // Add .sp-leaving to trigger the CSS opacity-0 transition (320 ms).
    setLeaving(true);
    // After the CSS transition completes, remove the overlay from the DOM.
    timerRef.current = setTimeout(() => {
      setVisible(false);
      onDoneRef.current();
    }, 340);
  }, []);

  // ── Main animation timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (shouldSkip) {
      // Skip replay: fire onDone synchronously on the next tick so the
      // parent React tree has already committed before we signal done.
      const id = setTimeout(() => onDoneRef.current(), 0);
      return () => clearTimeout(id);
    }

    // Mark as shown for this browser session.
    window.sessionStorage.setItem(SPLASH_FLAG, "1");

    // Check reduced-motion preference.
    const prefersReduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = prefersReduced ? ANIMATION_MS_REDUCED : ANIMATION_MS_NORMAL;

    timerRef.current = setTimeout(() => {
      animDoneRef.current = true;
      // If auth is already done, dismiss immediately.
      if (authReadyRef.current) {
        dismiss();
      }
      // Otherwise we hold the final frame and wait for authReady (see below).
    }, duration);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once

  // ── Auth arrives after animation ─────────────────────────────────────────
  // When auth becomes ready, check if the animation has already finished.
  // If yes, dismiss now. If no, the timer above will dismiss when it fires.
  useEffect(() => {
    if (authReady && animDoneRef.current && visible && !leaving) {
      dismiss();
    }
  }, [authReady, dismiss, leaving, visible]);

  if (!visible) return null;

  return (
    <div className={`sp-overlay${leaving ? " sp-leaving" : ""}`} aria-label="NestSplit loading" role="status">
      <div className="sp-stage">
        {/* Glow behind logo */}
        <div className="sp-logo-glow" aria-hidden="true" />

        {/* Expanding ring */}
        <div className="sp-ring" aria-hidden="true" />

        {/* Finance elements — Stage 2 */}
        <span className="sp-el sp-el-rupee"  aria-hidden="true">₹</span>
        <span className="sp-el sp-el-person" aria-hidden="true">👤</span>
        <span className="sp-el sp-el-receipt" aria-hidden="true">🧾</span>
        <span className="sp-el sp-el-card"   aria-hidden="true">💳</span>

        {/* NestSplit N logo — always on top */}
        <div className="sp-logo sp-bounce" aria-hidden="true">N</div>
      </div>

      {/* Wordmark + tagline — Stage 4 */}
      <div className="sp-wordmark">
        <p className="sp-wordmark-name">NestSplit</p>
        <p className="sp-wordmark-tagline">Split smart. Settle easy.</p>
      </div>
    </div>
  );
}
