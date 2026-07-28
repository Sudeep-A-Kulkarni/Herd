import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Share, Modal, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { api, GroupRide, GroupParticipant, FriendItem, RideSummary } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { useIntercom } from "@/src/lib/intercom";
import { useRideTracker, formatDuration } from "@/src/lib/ride-tracker";
import { theme } from "@/src/lib/theme";

export default function GroupRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [group, setGroup] = useState<GroupRide | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rideSession, setRideSession] = useState<RideSummary | null>(null);
  const [startingRide, setStartingRide] = useState(false);
  const [endingRide, setEndingRide] = useState(false);
  const [rideError, setRideError] = useState<string | null>(null);
  const intercom = useIntercom(id ?? null);
  const tracker = useRideTracker();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [g, activeSess] = await Promise.all([
        api.get<GroupRide>(`/groups/${id}`),
        api.get<RideSummary | null>("/rides/active").catch(() => null),
      ]);
      setGroup(g);
      // Hydrate rideSession if the backend already knows about an active session for THIS group
      if (activeSess && activeSess.ride_id === id) setRideSession(activeSess);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresh roster on server events
  useEffect(() => {
    if (!intercom.state.lastEvent) return;
    const t = intercom.state.lastEvent.type;
    if (t === "presence" || t === "roster") load();
    if (t === "ended") router.replace(`/group/${id}/recap`);
  }, [intercom.state.lastEvent, load, router, id]);

  // Push live status while tracking
  useEffect(() => {
    if (!(tracker.tracking && rideSession && tracker.stats.points.length > 0)) return;
    const push = async () => {
      const last = tracker.stats.points[tracker.stats.points.length - 1];
      try {
        await api.post("/live-status", {
          ride_session_id: rideSession.id,
          lat: last.lat, lng: last.lng,
          speed_kmh: last.speedKmh,
          is_on_comms: intercom.state.connected && !intercom.state.muted,
        });
      } catch { /* ignore */ }
    };
    push();
    const iv = setInterval(push, 5000);
    return () => clearInterval(iv);
  }, [tracker.tracking, rideSession, tracker.stats.points.length, intercom.state.connected, intercom.state.muted]);

  const leave = async () => {
    intercom.disconnect();
    if (tracker.tracking) tracker.stop();
    if (id) { try { await api.post(`/groups/${id}/leave`); } catch { /* ignore */ } }
    router.replace("/(tabs)");
  };

  const shareInvite = async () => {
    if (!group) return;
    try {
      await Share.share({ message: `Join my BikeFriends ride "${group.title}" — room: ${group.livekit_room_name}` });
    } catch { /* ignore */ }
  };

  const onStartRide = async () => {
    if (!id) return;
    setStartingRide(true); setRideError(null);
    let session: RideSummary | null = null;
    try {
      session = await api.post<RideSummary>(`/groups/${id}/start-ride`, {});
      setRideSession(session);
      await tracker.start();
    } catch (e: any) {
      // Roll back the DB session if tracker permission was denied
      if (session) {
        try {
          await api.post(`/rides/${session.id}/end`, {
            distance_km: 0, top_speed_kmh: 0, avg_speed_kmh: 0, duration_seconds: 0, polyline: [],
          });
        } catch { /* ignore */ }
        setRideSession(null);
      }
      setRideError(e?.message || "Location permission is required to track a ride");
    } finally { setStartingRide(false); }
  };

  const onEndRide = async () => {
    if (!rideSession) return;
    setEndingRide(true);
    const final = tracker.stop();
    try {
      await api.post(`/rides/${rideSession.id}/end`, {
        distance_km: final.distanceKm,
        top_speed_kmh: final.topSpeedKmh,
        avg_speed_kmh: final.avgSpeedKmh,
        duration_seconds: final.durationSeconds,
        polyline: final.polyline,
      });
      setRideSession(null);
    } catch { /* ignore */ }
    finally { setEndingRide(false); }
  };

  const goToRecap = () => router.push(`/group/${id}/recap`);

  if (loading || !group) {
    return <View style={styles.loader}><ActivityIndicator color={theme.color.brand} /></View>;
  }

  const isOwner = group.owner.id === user?.id;
  const active = group.participants.filter((p) => p.status === "joined");
  const invited = group.participants.filter((p) => p.status === "invited");
  const invitedUsernames = new Set(group.participants.map((p) => p.user.username));
  const stats = tracker.stats;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]} testID="group-room-screen">
      <View style={styles.header}>
        <Pressable onPress={leave} testID="group-leave-button" style={styles.closeBtn}>
          <Ionicons name="chevron-down" size={22} color={theme.color.text} />
        </Pressable>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={styles.headerTitle}>{group.title}</Text>
          <Text style={styles.headerSub}>Room · {group.livekit_room_name}</Text>
        </View>
        <Pressable onPress={shareInvite} testID="group-share-button" style={styles.closeBtn}>
          <Ionicons name="share-outline" size={20} color={theme.color.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Intercom card */}
        <View style={styles.commsCard} testID="group-intercom-card">
          <View style={styles.commsHeader}>
            <View style={styles.commsHeaderLeft}>
              <Ionicons
                name="radio"
                size={20}
                color={intercom.state.connected ? theme.color.success : theme.color.textMuted}
              />
              <Text style={styles.commsHeaderText}>
                Intercom · {intercom.state.connected ? "Connected" : "Idle"}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: theme.color.success + "22", borderColor: theme.color.success }]}>
              <Text style={[styles.pillText, { color: theme.color.success }]}>No distance limit</Text>
            </View>
          </View>

          {intercom.state.lastSpeaker && Date.now() - intercom.state.lastSpeaker.ts < 4000 ? (
            <View style={styles.nowSpeaking} testID="group-now-speaking">
              <Ionicons name="volume-high" size={14} color={theme.color.brand} />
              <Text style={styles.nowSpeakingText}>{intercom.state.lastSpeaker.display_name}</Text>
            </View>
          ) : null}

          <View style={styles.commsControls}>
            <Pressable
              testID="group-toggle-comms-button"
              style={[styles.bigBtn, intercom.state.connected && styles.bigBtnActive]}
              onPress={() => intercom.state.connected ? intercom.disconnect() : intercom.connect()}
            >
              <Ionicons
                name={intercom.state.connected ? "log-out" : "call"}
                size={20}
                color={intercom.state.connected ? theme.color.onBrand : theme.color.text}
              />
              <Text style={[styles.bigBtnText, intercom.state.connected && { color: theme.color.onBrand }]}>
                {intercom.state.connected ? "Leave" : "Join intercom"}
              </Text>
            </Pressable>

            <Pressable
              testID="group-mute-button"
              disabled={!intercom.state.connected}
              onPress={() => intercom.setMuted(!intercom.state.muted)}
              style={[
                styles.iconBtn,
                intercom.state.muted && { backgroundColor: theme.color.error + "33", borderColor: theme.color.error },
                !intercom.state.connected && { opacity: 0.4 },
              ]}
            >
              <Ionicons name={intercom.state.muted ? "mic-off" : "mic"} size={22} color={intercom.state.muted ? theme.color.error : theme.color.text} />
            </Pressable>
          </View>

          {/* Push-to-talk */}
          <Pressable
            testID="group-ptt-button"
            disabled={!intercom.state.connected || !intercom.state.audioSupported}
            onPressIn={() => intercom.startTransmit()}
            onPressOut={() => intercom.stopTransmit()}
            style={[
              styles.pttBtn,
              intercom.state.transmitting && styles.pttBtnActive,
              (!intercom.state.connected || !intercom.state.audioSupported) && { opacity: 0.45 },
            ]}
          >
            <Ionicons
              name={intercom.state.transmitting ? "mic" : "mic-outline"}
              size={26}
              color={intercom.state.transmitting ? theme.color.onBrand : theme.color.text}
            />
            <Text style={[styles.pttText, intercom.state.transmitting && { color: theme.color.onBrand }]}>
              {intercom.state.transmitting ? "TRANSMITTING…" : "HOLD TO TALK"}
            </Text>
          </Pressable>

          <Text style={styles.disclaimerText}>
            {intercom.state.audioSupported
              ? "Push-to-talk voice enabled · Works over cellular/WiFi, any distance"
              : "Push-to-talk needs a browser or native build (mic API unavailable here)"}
          </Text>
        </View>

        {/* Ride tracking card */}
        <View style={styles.rideCard} testID="group-ride-card">
          <View style={styles.rideCardHead}>
            <Text style={styles.cardTitle}>My ride</Text>
            {tracker.tracking ? (
              <View style={[styles.pill, { backgroundColor: theme.color.brand + "22", borderColor: theme.color.brand }]}>
                <Text style={[styles.pillText, { color: theme.color.brand }]}>TRACKING</Text>
              </View>
            ) : null}
          </View>

          {tracker.tracking || rideSession ? (
            <>
              <View style={styles.miniStatsRow}>
                <MiniStat label="Distance" value={stats.distanceKm.toFixed(2)} unit="km" testID="group-ride-distance" />
                <MiniStat label="Speed" value={Math.round(stats.currentSpeedKmh).toString()} unit="km/h" testID="group-ride-speed" />
                <MiniStat label="Top" value={Math.round(stats.topSpeedKmh).toString()} unit="km/h" testID="group-ride-top" />
                <MiniStat label="Time" value={formatDuration(stats.durationSeconds)} testID="group-ride-time" />
              </View>
              <Pressable
                testID="group-end-ride-button"
                style={[styles.smallBtn, { backgroundColor: theme.color.error }]}
                onPress={onEndRide}
                disabled={endingRide}
              >
                {endingRide ? <ActivityIndicator color={theme.color.text} /> :
                  <><Ionicons name="stop" size={16} color={theme.color.text} />
                    <Text style={styles.smallBtnText}>End my ride</Text></>}
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                testID="group-start-ride-button"
                style={[styles.smallBtn, { backgroundColor: theme.color.brand }]}
                onPress={onStartRide}
                disabled={startingRide}
              >
                {startingRide ? <ActivityIndicator color={theme.color.onBrand} /> :
                  <><Ionicons name="play" size={16} color={theme.color.onBrand} />
                    <Text style={[styles.smallBtnText, { color: theme.color.onBrand }]}>Start my ride</Text></>}
              </Pressable>
              {rideError ? (
                <Text style={styles.rideErrorText} testID="group-ride-error">{rideError}</Text>
              ) : null}
            </>
          )}
        </View>

        {/* Roster */}
        <View style={styles.rosterHead}>
          <Text style={styles.sectionTitle}>Riders ({active.length})</Text>
          <Pressable style={styles.inviteMore} onPress={() => setInviteOpen(true)} testID="group-invite-more-button">
            <Ionicons name="person-add" size={14} color={theme.color.brand} />
            <Text style={styles.inviteMoreText}>Invite more</Text>
          </Pressable>
        </View>

        <View style={{ gap: theme.space.sm }}>
          {active.map((p) => (
            <ParticipantRow
              key={p.user.id}
              p={p}
              speaking={intercom.state.remoteSpeaking[p.user.id] ?? p.speaking}
              muted={intercom.state.remoteMuted[p.user.id] ?? p.muted}
              onComms={intercom.state.remoteOnComms[p.user.id] ?? p.on_comms}
              isSelf={p.user.id === user?.id}
              isOwner={p.user.id === group.owner.id}
              highlight={
                !!intercom.state.lastSpeaker &&
                intercom.state.lastSpeaker.user_id === p.user.id &&
                Date.now() - intercom.state.lastSpeaker.ts < 3000
              }
            />
          ))}
        </View>

        {invited.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Invited ({invited.length})</Text>
            <View style={{ gap: theme.space.sm }}>
              {invited.map((p) => (
                <View key={p.user.id} style={styles.pendingRow}>
                  <View style={styles.avatarSmall}><Text style={styles.avatarText}>{p.user.display_name.slice(0,1).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{p.user.display_name}</Text>
                    <Text style={styles.meta}>Waiting to join…</Text>
                  </View>
                  <Ionicons name="hourglass-outline" size={18} color={theme.color.textMuted} />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.recapBtn} onPress={goToRecap} testID="group-view-recap-button">
          <Ionicons name="receipt-outline" size={16} color={theme.color.text} />
          <Text style={styles.recapBtnText}>Live recap</Text>
        </Pressable>
        <Pressable style={styles.endGroupBtn} onPress={leave} testID="group-end-button">
          <Ionicons name={isOwner ? "stop" : "exit"} size={18} color={theme.color.text} />
          <Text style={styles.endBtnText}>{isOwner ? "End group ride" : "Leave"}</Text>
        </Pressable>
      </View>

      <InviteMoreSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        rideId={id ?? ""}
        excludeUsernames={invitedUsernames}
        onInvited={() => { setInviteOpen(false); load(); }}
      />
    </SafeAreaView>
  );
}

function MiniStat({ label, value, unit, testID }: { label: string; value: string; unit?: string; testID?: string }) {
  return (
    <View style={styles.miniStat} testID={testID}>
      <Text style={styles.miniLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
        <Text style={styles.miniValue}>{value}</Text>
        {unit ? <Text style={styles.miniUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function ParticipantRow({
  p, speaking, muted, onComms, isSelf, isOwner, highlight,
}: {
  p: GroupParticipant; speaking: boolean; muted: boolean; onComms: boolean;
  isSelf: boolean; isOwner: boolean; highlight: boolean;
}) {
  const active = speaking || highlight;
  return (
    <View
      testID={`group-participant-${p.user.username}`}
      style={[styles.partRow, active && { borderColor: theme.color.success }]}
    >
      <View style={[styles.avatar, active && styles.avatarSpeaking]}>
        <Text style={styles.avatarText}>{p.user.display_name.slice(0, 1).toUpperCase()}</Text>
        {onComms ? <View style={styles.onCommsDot} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.name}>{p.user.display_name}</Text>
          {isSelf ? <Text style={styles.tag}>You</Text> : null}
          {isOwner ? <Text style={[styles.tag, { color: theme.color.brand }]}>Owner</Text> : null}
        </View>
        <Text style={styles.meta}>
          {!onComms ? "Not on comms" : muted ? "Muted" : active ? "Speaking…" : "Connected"}
        </Text>
      </View>
      <Ionicons
        name={!onComms ? "radio-outline" : muted ? "mic-off" : active ? "volume-high" : "mic-outline"}
        size={20}
        color={!onComms ? theme.color.textDim : muted ? theme.color.error : active ? theme.color.success : theme.color.textMuted}
      />
    </View>
  );
}

function InviteMoreSheet({
  visible, onClose, rideId, excludeUsernames, onInvited,
}: {
  visible: boolean; onClose: () => void; rideId: string;
  excludeUsernames: Set<string>; onInvited: () => void;
}) {
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const f = await api.get<FriendItem[]>("/friends");
        setFriends(f.filter((x) => x.status === "accepted" && !excludeUsernames.has(x.user.username)));
      } catch { /* ignore */ }
    })();
  }, [visible, excludeUsernames]);

  const toggle = (u: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(u)) n.delete(u); else n.add(u);
      return n;
    });
  };

  const submit = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await api.post(`/groups/${rideId}/invite`, { invite_usernames: Array.from(selected) });
      setSelected(new Set());
      onInvited();
    } catch { /* ignore */ }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet} testID="invite-more-sheet">
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Invite more friends</Text>
            <Pressable onPress={onClose} testID="invite-more-close">
              <Ionicons name="close" size={22} color={theme.color.text} />
            </Pressable>
          </View>

          {friends.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={22} color={theme.color.textDim} />
              <Text style={styles.emptyText}>Everyone's already invited</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: theme.space.sm, padding: theme.space.md }}>
              {friends.map((f) => {
                const on = selected.has(f.user.username);
                return (
                  <Pressable
                    key={f.id}
                    testID={`invite-more-friend-${f.user.username}`}
                    onPress={() => toggle(f.user.username)}
                    style={[styles.friendRow, on && styles.friendRowOn]}
                  >
                    <View style={styles.avatar}><Text style={styles.avatarText}>{f.user.display_name.slice(0,1).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{f.user.display_name}</Text>
                      <Text style={styles.meta}>@{f.user.username}</Text>
                    </View>
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on ? <Ionicons name="checkmark" size={14} color={theme.color.onBrand} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.sheetFoot}>
            <Pressable
              testID="invite-more-submit"
              style={[styles.submitBtn, selected.size === 0 && { opacity: 0.5 }]}
              onPress={submit}
              disabled={busy || selected.size === 0}
            >
              {busy ? <ActivityIndicator color={theme.color.onBrand} /> :
                <Text style={styles.submitBtnText}>Invite {selected.size > 0 ? `(${selected.size})` : ""}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  loader: { flex: 1, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    paddingHorizontal: theme.space.lg, paddingBottom: theme.space.sm,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surface2,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: theme.color.text, fontSize: 17, fontWeight: "800" },
  headerSub: { color: theme.color.textMuted, fontSize: 11, marginTop: 2 },
  content: { paddingHorizontal: theme.space.lg, paddingBottom: 130, gap: theme.space.md },
  commsCard: {
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.lg,
    padding: theme.space.lg, gap: theme.space.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  commsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  commsHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  commsHeaderText: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill, borderWidth: 1 },
  pillText: { fontSize: 10, fontWeight: "800" },
  nowSpeaking: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: theme.color.brandTint, borderColor: theme.color.brand, borderWidth: 1,
    paddingHorizontal: theme.space.md, paddingVertical: 6, borderRadius: theme.radius.pill,
    alignSelf: "flex-start",
  },
  nowSpeakingText: { color: theme.color.brand, fontWeight: "800", fontSize: 12 },
  commsControls: { flexDirection: "row", gap: theme.space.sm },
  bigBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.color.surface3, borderRadius: theme.radius.md, paddingVertical: 14,
    borderWidth: 1, borderColor: theme.color.border,
  },
  bigBtnActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  bigBtnText: { color: theme.color.text, fontWeight: "800", fontSize: 14 },
  iconBtn: {
    width: 54, alignItems: "center", justifyContent: "center",
    backgroundColor: theme.color.surface3, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  pttBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: theme.color.surface3, borderRadius: theme.radius.md,
    paddingVertical: 20, borderWidth: 2, borderColor: theme.color.border,
  },
  pttBtnActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  pttText: { color: theme.color.text, fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  disclaimerText: { color: theme.color.textMuted, fontSize: 11, textAlign: "center" },
  rideCard: {
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.md, gap: theme.space.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  rideCardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  miniStatsRow: { flexDirection: "row", gap: theme.space.sm, flexWrap: "wrap" },
  miniStat: {
    flexBasis: "22%", flexGrow: 1,
    backgroundColor: theme.color.surface3, borderRadius: theme.radius.sm,
    padding: theme.space.sm, borderWidth: 1, borderColor: theme.color.border,
  },
  miniLabel: { color: theme.color.textDim, fontSize: 9, letterSpacing: 1, textTransform: "uppercase" },
  miniValue: { color: theme.color.text, fontSize: 16, fontWeight: "900" },
  miniUnit: { color: theme.color.textMuted, fontSize: 10 },
  smallBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: theme.radius.md,
  },
  smallBtnText: { color: theme.color.text, fontWeight: "800", fontSize: 13 },
  rideErrorText: { color: theme.color.error, fontSize: 12, textAlign: "center", marginTop: 4 },
  rosterHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: theme.space.sm,
  },
  sectionTitle: { color: theme.color.text, fontSize: 15, fontWeight: "700" },
  inviteMore: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: theme.space.sm, paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brandTint, borderWidth: 1, borderColor: theme.color.brand,
  },
  inviteMoreText: { color: theme.color.brand, fontWeight: "800", fontSize: 12 },
  partRow: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, padding: theme.space.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
  },
  pendingRow: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, padding: theme.space.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    opacity: 0.7,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  avatarSmall: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  avatarSpeaking: { borderWidth: 2, borderColor: theme.color.success },
  avatarText: { color: theme.color.text, fontWeight: "800" },
  onCommsDot: {
    position: "absolute", right: -2, bottom: -2, width: 12, height: 12,
    borderRadius: 6, backgroundColor: theme.color.success,
    borderWidth: 2, borderColor: theme.color.surface2,
  },
  name: { color: theme.color.text, fontWeight: "700", fontSize: 14 },
  tag: { color: theme.color.textMuted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  meta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: theme.space.sm,
    padding: theme.space.lg, backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  recapBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: theme.space.lg, paddingVertical: 14, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface2, borderWidth: 1, borderColor: theme.color.border,
  },
  recapBtnText: { color: theme.color.text, fontWeight: "700", fontSize: 13 },
  endGroupBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.color.error, paddingVertical: 14, borderRadius: theme.radius.md,
  },
  endBtnText: { color: theme.color.text, fontWeight: "800", fontSize: 15 },
  // Invite sheet
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.color.surface2,
    borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
    maxHeight: "80%",
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  sheetHandle: {
    alignSelf: "center", marginTop: 8, width: 40, height: 4, borderRadius: 2,
    backgroundColor: theme.color.textDim,
  },
  sheetHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md,
    borderBottomColor: theme.color.border, borderBottomWidth: 1,
  },
  sheetTitle: { color: theme.color.text, fontSize: 17, fontWeight: "800" },
  friendRow: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface3, padding: theme.space.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
  },
  friendRowOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  check: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: theme.color.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  checkOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  empty: { alignItems: "center", padding: theme.space.xl, gap: 4 },
  emptyText: { color: theme.color.textMuted, fontSize: 14 },
  sheetFoot: {
    padding: theme.space.lg, borderTopColor: theme.color.border, borderTopWidth: 1,
    backgroundColor: theme.color.surface2,
  },
  submitBtn: {
    backgroundColor: theme.color.brand, borderRadius: theme.radius.md,
    paddingVertical: 14, alignItems: "center",
  },
  submitBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
});
