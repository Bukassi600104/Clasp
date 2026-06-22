'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { authenticate, isPiBrowser } from '@/lib/pi-client';
import type { SessionUser, Profile } from '@/lib/types';

interface AuthState {
  user: SessionUser | null;
  profile: Profile | null;
  unread: number;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  inPiBrowser: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inPiBrowser, setInPiBrowser] = useState(true);
  const [piReady, setPiReady] = useState(false);
  const autoSignedIn = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store', credentials: 'include' });
      const json = await res.json();
      setUser(json.data?.user ?? null);
      setProfile(json.data?.profile ?? null);
      setUnread(json.data?.unread ?? 0);
    } catch {
      /* offline */
    } finally {
      setLoading(false);
    }
  }, []);

  // Load any existing session from the cookie.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // The Pi SDK script loads after-interactive, so poll briefly until window.Pi
  // is available, then mark the app as running inside Pi Browser.
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const probe = () => {
      if (isPiBrowser()) {
        setPiReady(true);
        setInPiBrowser(true);
        return;
      }
      // The Pi SDK script loads after-interactive; keep polling ~15s before
      // concluding we're not inside Pi Browser.
      if (tries++ < 60) timer = setTimeout(probe, 250);
      else setInPiBrowser(false);
    };
    probe();
    return () => clearTimeout(timer);
  }, []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      // Inside Pi Browser, use real Pi auth. Outside it (preview / sandbox),
      // fall back to a generated sandbox token so the app stays explorable.
      const accessToken = isPiBrowser()
        ? (await authenticate()).accessToken
        : `sandbox_${Math.random().toString(36).slice(2, 10)}`;
      const res = await fetch('/api/auth', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? 'Sign-in failed.');
      }
      await refresh();
    } catch (e) {
      // Surface the real Pi SDK error (its rejections aren't always Error
      // instances) so failures are diagnosable instead of a generic message.
      const msg =
        e instanceof Error ? e.message
        : typeof e === 'string' ? e
        : (e as { message?: string })?.message ?? JSON.stringify(e);
      setError(msg || 'Sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  }, [refresh]);

  // Auto-trigger Pi authentication once on load when running inside Pi Browser
  // and no session exists yet. The manual "Sign in with Pi" button remains too.
  useEffect(() => {
    if (piReady && !loading && !user && !signingIn && !autoSignedIn.current) {
      autoSignedIn.current = true;
      void signIn();
    }
  }, [piReady, loading, user, signingIn, signIn]);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    setProfile(null);
    setUnread(0);
  }, []);

  return (
    <Ctx.Provider
      value={{ user, profile, unread, loading, signingIn, error, inPiBrowser, signIn, signOut, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
