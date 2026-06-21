'use client';
import { useEffect } from 'react';

// Registers the hand-rolled offline service worker. Static-export safe — no
// next-pwa, no build coupling. The app runs fully offline once cached.
export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // avoid dev caching noise
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is best-effort; app still works */
    });
  }, []);
  return null;
}
