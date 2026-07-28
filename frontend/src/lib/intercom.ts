/**
 * useIntercom — WebSocket signalling for a group room's intercom.
 *
 * Handles presence, mute state, speaking state. This DOES NOT carry audio —
 * to add real voice you need a native dev build with LiveKit (or Agora, Daily,
 * or self-hosted mediasoup). The UI here is already wired for it: once you
 * have LiveKit tokens minted on the server, replace the speak-simulator with
 * `useLocalParticipant().setMicrophoneEnabled()` and mount `RoomAudioRenderer`.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { getToken } from "@/src/lib/api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type IntercomEvent =
  | { type: "presence"; user_id: string; on_comms: boolean }
  | { type: "mute"; user_id: string; muted: boolean }
  | { type: "speaking"; user_id: string; speaking: boolean }
  | { type: "roster" }
  | { type: "ended" };

export type IntercomState = {
  connected: boolean;
  muted: boolean;
  onComms: boolean; // local user is on comms
  remoteSpeaking: Record<string, boolean>;
  remoteMuted: Record<string, boolean>;
  remoteOnComms: Record<string, boolean>;
  lastEvent?: IntercomEvent;
};

export function useIntercom(rideId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<IntercomState>({
    connected: false, muted: false, onComms: false,
    remoteSpeaking: {}, remoteMuted: {}, remoteOnComms: {},
  });

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState((s) => ({ ...s, connected: false, onComms: false }));
  }, []);

  const connect = useCallback(async () => {
    if (!rideId || wsRef.current) return;
    const token = await getToken();
    if (!token || !BASE) return;
    const wsUrl = BASE.replace(/^http/, "ws") + `/api/ws/intercom/${rideId}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => setState((s) => ({ ...s, connected: true, onComms: true }));
    ws.onclose = () => setState((s) => ({ ...s, connected: false, onComms: false }));
    ws.onerror = () => { /* handled via close */ };
    ws.onmessage = (e) => {
      try {
        const msg: IntercomEvent = JSON.parse(e.data);
        setState((s) => {
          const next = { ...s, lastEvent: msg };
          if (msg.type === "presence") next.remoteOnComms = { ...s.remoteOnComms, [msg.user_id]: msg.on_comms };
          if (msg.type === "mute") next.remoteMuted = { ...s.remoteMuted, [msg.user_id]: msg.muted };
          if (msg.type === "speaking") next.remoteSpeaking = { ...s.remoteSpeaking, [msg.user_id]: msg.speaking };
          return next;
        });
      } catch { /* ignore */ }
    };
  }, [rideId]);

  const setMuted = useCallback((muted: boolean) => {
    setState((s) => ({ ...s, muted }));
    wsRef.current?.send(JSON.stringify({ type: "mute", muted }));
  }, []);

  const setSpeaking = useCallback((speaking: boolean) => {
    wsRef.current?.send(JSON.stringify({ type: "speaking", speaking }));
  }, []);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return { state, connect, disconnect, setMuted, setSpeaking };
}
