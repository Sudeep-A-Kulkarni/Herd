/**
 * useIntercom — WebSocket signalling + push-to-talk audio relay.
 *
 * Presence, mute, and speaking are broadcast to every participant.
 * Audio: on browsers (web preview + Chrome/Safari/Firefox), holding the PTT
 * button records via MediaRecorder and streams the clip as base64 through the
 * same WebSocket. Other participants auto-play received clips.
 *
 * Native (Expo Go) does NOT support MediaRecorder — the API exposes
 * `audioSupported=false` and the UI falls back to "presence only".
 * A native dev build can add expo-audio recording behind the same interface.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import { getToken } from "@/src/lib/api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type IntercomEvent =
  | { type: "presence"; user_id: string; on_comms: boolean }
  | { type: "mute"; user_id: string; muted: boolean }
  | { type: "speaking"; user_id: string; speaking: boolean }
  | { type: "audio"; user_id: string; username: string; display_name: string; data: string; mime: string }
  | { type: "roster" }
  | { type: "ended" };

export type IntercomState = {
  connected: boolean;
  muted: boolean;
  onComms: boolean;
  audioSupported: boolean;
  transmitting: boolean;
  remoteSpeaking: Record<string, boolean>;
  remoteMuted: Record<string, boolean>;
  remoteOnComms: Record<string, boolean>;
  lastSpeaker?: { user_id: string; display_name: string; ts: number };
  lastEvent?: IntercomEvent;
};

const webAudioSupported =
  Platform.OS === "web" &&
  typeof globalThis !== "undefined" &&
  typeof (globalThis as any).MediaRecorder !== "undefined" &&
  typeof (globalThis as any).navigator !== "undefined" &&
  !!(globalThis as any).navigator.mediaDevices;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

export function useIntercom(rideId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [state, setState] = useState<IntercomState>({
    connected: false, muted: false, onComms: false,
    audioSupported: webAudioSupported, transmitting: false,
    remoteSpeaking: {}, remoteMuted: {}, remoteOnComms: {},
  });

  const disconnect = useCallback(() => {
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    recorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setState((s) => ({ ...s, connected: false, onComms: false, transmitting: false }));
  }, []);

  const send = (payload: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const playAudio = (base64: string, mime: string) => {
    if (Platform.OS !== "web") return; // playback needs native audio module; wire via expo-audio in a native build
    try {
      const url = `data:${mime};base64,${base64}`;
      const audio = new (globalThis as any).Audio(url);
      audio.play?.().catch(() => { /* autoplay might be blocked */ });
    } catch { /* ignore */ }
  };

  const connect = useCallback(async () => {
    if (!rideId || wsRef.current) return;
    const token = await getToken();
    if (!token || !BASE) return;
    const wsUrl = BASE.replace(/^http/, "ws") + `/api/ws/intercom/${rideId}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => setState((s) => ({ ...s, connected: true, onComms: true }));
    ws.onclose = () => setState((s) => ({ ...s, connected: false, onComms: false, transmitting: false }));
    ws.onerror = () => { /* handled via close */ };
    ws.onmessage = (e) => {
      try {
        const msg: IntercomEvent = JSON.parse(e.data);
        setState((s) => {
          const next = { ...s, lastEvent: msg };
          if (msg.type === "presence") next.remoteOnComms = { ...s.remoteOnComms, [msg.user_id]: msg.on_comms };
          if (msg.type === "mute") next.remoteMuted = { ...s.remoteMuted, [msg.user_id]: msg.muted };
          if (msg.type === "speaking") next.remoteSpeaking = { ...s.remoteSpeaking, [msg.user_id]: msg.speaking };
          if (msg.type === "audio") next.lastSpeaker = { user_id: msg.user_id, display_name: msg.display_name, ts: Date.now() };
          return next;
        });
        if (msg.type === "audio") playAudio(msg.data, msg.mime);
      } catch { /* ignore */ }
    };
  }, [rideId]);

  const setMuted = useCallback((muted: boolean) => {
    setState((s) => ({ ...s, muted }));
    send({ type: "mute", muted });
  }, []);

  const setSpeaking = useCallback((speaking: boolean) => {
    send({ type: "speaking", speaking });
  }, []);

  const startTransmit = useCallback(async () => {
    if (!webAudioSupported || !wsRef.current) return;
    try {
      const stream = await (globalThis as any).navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const MR = (globalThis as any).MediaRecorder;
      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
      const mime = mimeCandidates.find((m) => !m || MR.isTypeSupported?.(m)) || "";
      const recorder = mime ? new MR(stream, { mimeType: mime }) : new MR(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (ev: any) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        chunksRef.current = [];
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        recorderRef.current = null;
        if (blob.size > 0) {
          const b64 = await blobToBase64(blob);
          send({ type: "audio", data: b64, mime: mime || "audio/webm" });
        }
        setSpeaking(false);
        setState((s) => ({ ...s, transmitting: false }));
      };
      recorder.start();
      setSpeaking(true);
      setState((s) => ({ ...s, transmitting: true }));
    } catch (err) {
      // Mic permission denied, or unsupported
      setState((s) => ({ ...s, transmitting: false }));
    }
  }, [setSpeaking]);

  const stopTransmit = useCallback(() => {
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return { state, connect, disconnect, setMuted, setSpeaking, startTransmit, stopTransmit };
}
