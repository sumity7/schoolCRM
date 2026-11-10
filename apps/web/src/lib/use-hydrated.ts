'use client';

import { useEffect, useState } from 'react';

/** false during SSR and until React has hydrated the page. Credential forms keep their submit button disabled until true,
 *  so a pre-hydration submit can never fall back to a native form submission (which would put the password in the URL). */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
