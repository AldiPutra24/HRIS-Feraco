'use client';

import { useEffect } from 'react';
import { sendHeartbeat } from '@/lib/auth/auth-client';
import { useAuth } from '@/lib/auth/auth-provider';

// Backend marks a user Online while the last heartbeat is < 2 minutes old.
const HEARTBEAT_MS = 45_000;

/**
 * Sends a session presence ping while an HRIS tab is open and visible.
 * Only "this session is active" is reported — no screen, input or page data.
 * Hidden tabs pause pings, so a backgrounded tab goes Offline after ~2 min.
 */
export function PresenceHeartbeat() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    const beat = () => {
      if (document.visibilityState === 'visible') sendHeartbeat();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat();
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isAuthenticated]);

  return null;
}
