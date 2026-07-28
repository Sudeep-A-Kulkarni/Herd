/**
 * RideTracker — accumulates GPS points and exposes running distance/speed stats.
 *
 * - Distance via Haversine.
 * - Speed uses a rolling 5-point average; raw readings > 180 km/h are dropped as GPS noise.
 * - Distance only accrues when smoothed speed > 1 km/h (avoids drift while stationary).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";

const MAX_RAW_SPEED_KMH = 180;
const MIN_MOVING_SPEED_KMH = 1;
const WINDOW = 5;

export type LatLng = { lat: number; lng: number };
export type TrackPoint = LatLng & { speedKmh: number; ts: number };

export type RideStats = {
  distanceKm: number;
  currentSpeedKmh: number;
  topSpeedKmh: number;
  avgSpeedKmh: number;
  durationSeconds: number;
  polyline: [number, number][];
  points: TrackPoint[];
};

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function useRideTracker() {
  const [tracking, setTracking] = useState(false);
  const [stats, setStats] = useState<RideStats>({
    distanceKm: 0,
    currentSpeedKmh: 0,
    topSpeedKmh: 0,
    avgSpeedKmh: 0,
    durationSeconds: 0,
    polyline: [],
    points: [],
  });

  const startedAtRef = useRef<number | null>(null);
  const pointsRef = useRef<TrackPoint[]>([]);
  const speedWindowRef = useRef<number[]>([]);
  const distanceRef = useRef(0);
  const topSpeedRef = useRef(0);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    startedAtRef.current = null;
    pointsRef.current = [];
    speedWindowRef.current = [];
    distanceRef.current = 0;
    topSpeedRef.current = 0;
    setStats({
      distanceKm: 0,
      currentSpeedKmh: 0,
      topSpeedKmh: 0,
      avgSpeedKmh: 0,
      durationSeconds: 0,
      polyline: [],
      points: [],
    });
  }, []);

  const publish = useCallback(() => {
    const started = startedAtRef.current ?? Date.now();
    const durationSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const distanceKm = distanceRef.current;
    const avgSpeedKmh = durationSeconds > 0 ? (distanceKm / (durationSeconds / 3600)) : 0;
    const pts = pointsRef.current;
    setStats({
      distanceKm,
      currentSpeedKmh: pts.length ? pts[pts.length - 1].speedKmh : 0,
      topSpeedKmh: topSpeedRef.current,
      avgSpeedKmh,
      durationSeconds,
      polyline: pts.map((p) => [p.lat, p.lng]),
      points: pts,
    });
  }, []);

  const ingest = useCallback((loc: Location.LocationObject) => {
    const rawSpeedMs = loc.coords.speed ?? 0;
    const rawSpeedKmh = Math.max(0, rawSpeedMs) * 3.6;
    if (rawSpeedKmh > MAX_RAW_SPEED_KMH) return; // GPS noise reject

    const window = speedWindowRef.current;
    window.push(rawSpeedKmh);
    if (window.length > WINDOW) window.shift();
    const smoothed = window.reduce((a, b) => a + b, 0) / window.length;

    const pt: TrackPoint = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      speedKmh: smoothed,
      ts: loc.timestamp,
    };

    const prev = pointsRef.current[pointsRef.current.length - 1];
    if (prev && smoothed > MIN_MOVING_SPEED_KMH) {
      distanceRef.current += haversineKm(prev, pt);
    }
    if (smoothed > topSpeedRef.current) topSpeedRef.current = smoothed;
    pointsRef.current.push(pt);
    publish();
  }, [publish]);

  const start = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      throw new Error("Location permission is required to track a ride");
    }
    reset();
    startedAtRef.current = Date.now();
    setTracking(true);
    // High-accuracy watch; 1s interval, 5m distance
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 5 },
      ingest,
    );
    // Duration tick so timer updates even without new GPS fixes
    tickRef.current = setInterval(publish, 1000);
  }, [ingest, publish, reset]);

  const stop = useCallback((): RideStats => {
    setTracking(false);
    watchRef.current?.remove();
    watchRef.current = null;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    publish();
    // Return a final snapshot
    const started = startedAtRef.current ?? Date.now();
    const durationSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const distanceKm = distanceRef.current;
    const avgSpeedKmh = durationSeconds > 0 ? (distanceKm / (durationSeconds / 3600)) : 0;
    const pts = pointsRef.current;
    return {
      distanceKm,
      currentSpeedKmh: pts.length ? pts[pts.length - 1].speedKmh : 0,
      topSpeedKmh: topSpeedRef.current,
      avgSpeedKmh,
      durationSeconds,
      polyline: pts.map((p) => [p.lat, p.lng]),
      points: pts,
    };
  }, [publish]);

  useEffect(() => () => {
    watchRef.current?.remove();
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  return { tracking, stats, start, stop };
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
