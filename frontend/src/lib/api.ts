import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "bf_auth_token";

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await storage.secureSet(TOKEN_KEY, token);
  else await storage.secureRemove(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(p: string) => request<T>(p, { method: "DELETE" }),
};

// ---- Types ----
export type UserPublic = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  bike_model?: string | null;
  avatar_url?: string | null;
  created_at: string;
};

export type AuthResponse = { access_token: string; token_type: string; user: UserPublic };

export type FriendItem = {
  id: string;
  user: UserPublic;
  status: "accepted" | "incoming" | "outgoing";
  is_riding: boolean;
  current_speed_kmh: number;
  is_on_comms: boolean;
};

export type RideSummary = {
  id: string;
  ride_id: string;
  rider: UserPublic;
  title: string;
  is_group_ride: boolean;
  livekit_room_name?: string | null;
  distance_km: number;
  top_speed_kmh: number;
  avg_speed_kmh: number;
  duration_seconds: number;
  polyline: [number, number][];
  started_at: string;
  ended_at?: string | null;
  status: string;
};

export type LeaderboardEntry = {
  rider: UserPublic;
  total_km: number;
  top_speed_kmh: number;
  total_rides: number;
};
