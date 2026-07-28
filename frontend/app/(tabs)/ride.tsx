import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Switch, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { api, RideSummary } from "@/src/lib/api";
import { useRideTracker, formatDuration } from "@/src/lib/ride-tracker";
import { RouteMap } from "@/src/components/RouteMap";
import { theme } from "@/src/lib/theme";

export default function RideScreen() {
  const tracker = useRideTracker();
  const [activeSession, setActiveSession] = useState<RideSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [isGroup, setIsGroup] = useState(false);
  const [joinedComms, setJoinedComms] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const liveSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadActive = useCallback(async () => {
    try {
      const s = await api.get<RideSummary | null>("/rides/active");
      setActiveSession(s);
    } catch { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => { loadActive(); }, [loadActive]));

  // Push live status to server every 5s while tracking
  useEffect(() => {
    if (tracker.tracking && activeSession && tracker.stats.points.length > 0) {
      const push = async () => {
        const last = tracker.stats.points[tracker.stats.points.length - 1];
        try {
          await api.post("/live-status", {
            ride_session_id: activeSession.id,
            lat: last.lat, lng: last.lng,
            speed_kmh: last.speedKmh, is_on_comms: joinedComms && !muted,
          });
        } catch { /* ignore */ }
      };
      push();
      liveSyncRef.current = setInterval(push, 5000);
      return () => { if (liveSyncRef.current) clearInterval(liveSyncRef.current); };
    }
  }, [tracker.tracking, activeSession, tracker.stats.points.length, joinedComms, muted]);

  const onStart = async () => {
    setStarting(true); setError(null);
    try {
      const session = await api.post<RideSummary>("/rides/start", {
        title: isGroup ? "Group Ride" : "Solo Ride",
        is_group_ride: isGroup,
      });
      setActiveSession(session);
      await tracker.start();
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch (e: any) {
      setError(e.message || "Failed to start ride");
    } finally { setStarting(false); }
  };

  const onEnd = async () => {
    if (!activeSession) return;
    setEnding(true);
    const final = tracker.stop();
    try {
      await api.post<RideSummary>(`/rides/${activeSession.id}/end`, {
        distance_km: final.distanceKm,
        top_speed_kmh: final.topSpeedKmh,
        avg_speed_kmh: final.avgSpeedKmh,
        duration_seconds: final.durationSeconds,
        polyline: final.polyline,
      });
      setActiveSession(null);
      setJoinedComms(false); setMuted(false);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch (e: any) {
      setError(e.message || "Failed to end ride");
    } finally { setEnding(false); }
  };

  const s = tracker.stats;
  const last = s.points[s.points.length - 1];
  const center = last ? { lat: last.lat, lng: last.lng } : null;

  return (
    <View style={styles.screen} testID="ride-screen">
      <View style={styles.mapWrap}>
        <RouteMap polyline={s.polyline} center={center} testID="ride-map" />
      </View>

      <SafeAreaView edges={["top"]} style={styles.topSafe} pointerEvents="box-none">
        <View style={styles.topHud} pointerEvents="box-none">
          <View style={styles.topLeft}>
            <Text style={styles.hudLabel}>Ride</Text>
            <Text style={styles.hudTitle}>{activeSession ? activeSession.title : "Ready"}</Text>
          </View>
          {activeSession?.is_group_ride ? (
            <View style={styles.commsBox} testID="ride-comms-panel">
              <View style={styles.commsRow}>
                <Ionicons name="radio" size={16} color={joinedComms ? theme.color.success : theme.color.textMuted} />
                <Text style={styles.commsText}>Intercom {joinedComms ? "Connected" : "Idle"}</Text>
              </View>
              <View style={styles.commsBtnRow}>
                <Pressable
                  testID="ride-toggle-comms-button"
                  onPress={() => setJoinedComms((v) => !v)}
                  style={[styles.commsBtn, joinedComms && { backgroundColor: theme.color.brand }]}
                >
                  <Ionicons name={joinedComms ? "log-out" : "call"} size={16} color={joinedComms ? theme.color.onBrand : theme.color.text} />
                  <Text style={[styles.commsBtnText, joinedComms && { color: theme.color.onBrand }]}>
                    {joinedComms ? "Leave" : "Join"}
                  </Text>
                </Pressable>
                <Pressable
                  testID="ride-mute-button"
                  disabled={!joinedComms}
                  onPress={() => setMuted((v) => !v)}
                  style={[styles.commsIconBtn, muted && { backgroundColor: theme.color.error + "33", borderColor: theme.color.error }]}
                >
                  <Ionicons name={muted ? "mic-off" : "mic"} size={18} color={muted ? theme.color.error : theme.color.text} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.bottomSafe} pointerEvents="box-none">
        <View style={styles.bottomHud}>
          {error ? <Text style={styles.errorText} testID="ride-error">{error}</Text> : null}
          {!activeSession ? (
            <View style={{ gap: theme.space.md }}>
              <View style={styles.groupRow}>
                <View>
                  <Text style={styles.groupTitle}>Group Ride</Text>
                  <Text style={styles.groupSub}>Enable voice intercom room</Text>
                </View>
                <Switch
                  testID="ride-group-toggle"
                  value={isGroup}
                  onValueChange={setIsGroup}
                  trackColor={{ true: theme.color.brand, false: theme.color.surface3 }}
                  thumbColor={theme.color.text}
                />
              </View>
              <Pressable
                testID="ride-start-button"
                style={styles.startBtn}
                onPress={onStart}
                disabled={starting}
              >
                {starting
                  ? <ActivityIndicator color={theme.color.onBrand} />
                  : <><Ionicons name="play" size={20} color={theme.color.onBrand} />
                      <Text style={styles.startText}>Start Ride</Text></>}
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.speedRow}>
                <View style={styles.speedMain} testID="ride-current-speed">
                  <Text style={styles.speedValue}>{Math.round(s.currentSpeedKmh)}</Text>
                  <Text style={styles.speedUnit}>km/h</Text>
                </View>
                <View style={styles.miniStats}>
                  <Mini label="Distance" value={s.distanceKm.toFixed(2)} unit="km" testID="ride-distance" />
                  <Mini label="Top" value={Math.round(s.topSpeedKmh).toString()} unit="km/h" testID="ride-top-speed" />
                  <Mini label="Time" value={formatDuration(s.durationSeconds)} testID="ride-duration" />
                </View>
              </View>
              <Pressable
                testID="ride-end-button"
                style={styles.endBtn}
                onPress={onEnd}
                disabled={ending}
              >
                {ending
                  ? <ActivityIndicator color={theme.color.text} />
                  : <><Ionicons name="stop" size={20} color={theme.color.text} />
                      <Text style={styles.endText}>End Ride</Text></>}
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function Mini({ label, value, unit, testID }: { label: string; value: string; unit?: string; testID?: string }) {
  return (
    <View style={styles.mini} testID={testID}>
      <Text style={styles.miniLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
        <Text style={styles.miniValue}>{value}</Text>
        {unit ? <Text style={styles.miniUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  mapWrap: { ...StyleSheet.absoluteFillObject },
  topSafe: { position: "absolute", top: 0, left: 0, right: 0 },
  topHud: {
    marginTop: theme.space.sm, marginHorizontal: theme.space.md,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: theme.space.md,
  },
  topLeft: {
    backgroundColor: "rgba(13,14,17,0.85)", paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
  },
  hudLabel: { color: theme.color.textMuted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  hudTitle: { color: theme.color.text, fontSize: 16, fontWeight: "700" },
  commsBox: {
    flex: 1, maxWidth: 220, backgroundColor: "rgba(13,14,17,0.9)", borderRadius: theme.radius.md,
    padding: theme.space.sm, gap: theme.space.sm, borderWidth: 1, borderColor: theme.color.border,
  },
  commsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  commsText: { color: theme.color.text, fontSize: 12, fontWeight: "600" },
  commsBtnRow: { flexDirection: "row", gap: 6 },
  commsBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    backgroundColor: theme.color.surface3, paddingVertical: 8, borderRadius: theme.radius.sm,
  },
  commsBtnText: { color: theme.color.text, fontWeight: "700", fontSize: 12 },
  commsIconBtn: {
    width: 36, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.color.surface3, borderRadius: theme.radius.sm,
    borderWidth: 1, borderColor: theme.color.border,
  },
  bottomSafe: { position: "absolute", bottom: 0, left: 0, right: 0 },
  bottomHud: {
    margin: theme.space.md, backgroundColor: "rgba(13,14,17,0.94)",
    borderRadius: theme.radius.lg, padding: theme.space.lg,
    borderWidth: 1, borderColor: theme.color.border, gap: theme.space.md,
  },
  speedRow: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  speedMain: {
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: theme.space.md,
  },
  speedValue: { color: theme.color.brand, fontSize: 64, fontWeight: "900", letterSpacing: -2, lineHeight: 68 },
  speedUnit: { color: theme.color.textMuted, fontSize: 12, marginTop: -4, letterSpacing: 1 },
  miniStats: { flex: 1, gap: theme.space.sm },
  mini: {
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.md, paddingVertical: 8,
    borderWidth: 1, borderColor: theme.color.border,
  },
  miniLabel: { color: theme.color.textDim, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" },
  miniValue: { color: theme.color.text, fontSize: 18, fontWeight: "800" },
  miniUnit: { color: theme.color.textMuted, fontSize: 11 },
  groupRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: theme.color.surface2, padding: theme.space.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  groupTitle: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  groupSub: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  startBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.color.brand, paddingVertical: 16, borderRadius: theme.radius.md,
  },
  startText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 16, letterSpacing: 0.3 },
  endBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.color.error, paddingVertical: 14, borderRadius: theme.radius.md,
  },
  endText: { color: theme.color.text, fontWeight: "800", fontSize: 15, letterSpacing: 0.3 },
  errorText: { color: theme.color.error, fontSize: 12, textAlign: "center" },
});
