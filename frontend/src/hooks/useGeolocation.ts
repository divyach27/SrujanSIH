import { useCallback, useState } from 'react';

export interface GeoLocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  placeName: string | null;
}

export type GeoStatus = 'idle' | 'requesting' | 'success' | 'denied' | 'unavailable';

// Analysis is done client-side against an uploaded clip, so there's no real
// per-frame GPS to attach - this captures the device's actual location once,
// as the best honest stand-in for "where this analysis happened."
export function useGeolocation() {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [location, setLocation] = useState<GeoLocationResult | null>(null);

  // Resolves with the fix (or null if unavailable/denied) so callers can wait
  // for it before sending a request that should be tagged with location.
  const request = useCallback((): Promise<GeoLocationResult | null> => {
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      return Promise.resolve(null);
    }
    setStatus('requesting');
    return new Promise<GeoLocationResult | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLocation({ latitude, longitude, accuracy, placeName: null });
        setStatus('success');
        resolve({ latitude, longitude, accuracy, placeName: null });

        // Reverse geocoding is a nice-to-have; degrade silently to
        // coordinates-only if it's slow, blocked, or fails.
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { Accept: 'application/json' } }
          );
          if (res.ok) {
            const data = await res.json();
            const placeName: string | undefined = data?.display_name;
            if (placeName) {
              setLocation((prev) => (prev ? { ...prev, placeName } : prev));
            }
          }
        } catch {
          // ignore - coordinates alone are still shown
        }
      },
      () => {
        setStatus('denied');
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
    });
  }, []);

  return { status, location, request };
}
