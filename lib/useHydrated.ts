'use client';
import { useEffect, useState } from 'react';

// localStorage-backed state only exists on the client. Render a skeleton until
// mounted to avoid SSR/CSR hydration mismatches with the static export.
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
