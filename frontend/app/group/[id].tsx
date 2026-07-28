import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { api, GroupRide, GroupParticipant } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { useIntercom } from "@/src/lib/intercom";
import { theme } from "@/src/lib/theme";

export default function GroupRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [group, setGroup] = useState<GroupRide | null>(null);
  const [loading, setLoading] = useState(true);
  const intercom = useIntercom(id ?? null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const g = await api.get<GroupRide>(`/groups/${id}`);
      setGroup(g);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresh roster when server broadcasts a change
  useEffect(() => {
    if (!intercom.state.lastEvent) return;
    const t = intercom.state.lastEvent.type;
    if (t === "presence" || t === "roster") load();
    if (t === "ended") router.replace("/(tabs)");
  }, [intercom.state.lastEvent, load, router]);

  // Simulated "speaking" pulse: while unmuted + on comms, pulse every 3s so peers see activity
  useEffect(() => {
    if (!intercom.state.connected || intercom.state.muted) return;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      intercom.setSpeaking(on);
    }, 1500);
    return () => { clearInterval(t); intercom.setSpeaking(false); };
  }, [intercom.state.connected, intercom.state.muted]);

  const leave = async () => {
    intercom.disconnect();
    if (id) { try { await api.post(`/groups/${id}/leave`); } catch { /* ignore */ } }
    router.replace("/(tabs)");
  };

  const shareInvite = async () => {
    if (!group) return;
    try {
      await Share.share({
        message: `Join my BikeFriends ride "${group.title}" — room: ${group.livekit_room_name}`,
      });
    } catch { /* ignore */ }
  };

  if (loading || !group) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={theme.color.brand} />
      </View>
    );
  }

  const isOwner = group.owner.id === user?.id;
  const active = group.participants.filter((p) => p.status === "joined");
  const invited = group.participants.filter((p) => p.status === "invited");

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

          <View style={styles.commsControls}>
            <Pressable
              testID="group-toggle-comms-button"
              style={[styles.bigBtn, intercom.state.connected && styles.bigBtnActive]}
              onPress={() => intercom.state.connected ? intercom.disconnect() : intercom.connect()}
            >
              <Ionicons
                name={intercom.state.connected ? "log-out" : "call"}
                size={22}
                color={intercom.state.connected ? theme.color.onBrand : theme.color.text}
              />
              <Text style={[styles.bigBtnText, intercom.state.connected && { color: theme.color.onBrand }]}>
                {intercom.state.connected ? "Leave intercom" : "Join intercom"}
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
              <Ionicons
                name={intercom.state.muted ? "mic-off" : "mic"}
                size={22}
                color={intercom.state.muted ? theme.color.error : theme.color.text}
              />
            </Pressable>
          </View>

          <View style={styles.disclaimer}>
            <Ionicons name="information-circle" size={13} color={theme.color.textMuted} />
            <Text style={styles.disclaimerText}>
              Voice audio requires a native build. Presence &amp; controls are live now.
            </Text>
          </View>
        </View>

        <SectionHeader title={`Riders (${active.length})`} />
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
            />
          ))}
        </View>

        {invited.length > 0 && (
          <>
            <SectionHeader title={`Invited (${invited.length})`} />
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
        <Pressable style={styles.endBtn} onPress={leave} testID="group-end-button">
          <Ionicons name={isOwner ? "stop" : "exit"} size={18} color={theme.color.text} />
          <Text style={styles.endBtnText}>{isOwner ? "End group ride" : "Leave group"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ParticipantRow({
  p, speaking, muted, onComms, isSelf, isOwner,
}: { p: GroupParticipant; speaking: boolean; muted: boolean; onComms: boolean; isSelf: boolean; isOwner: boolean }) {
  return (
    <View
      testID={`group-participant-${p.user.username}`}
      style={[
        styles.partRow,
        speaking && { borderColor: theme.color.success },
      ]}
    >
      <View style={[styles.avatar, speaking && styles.avatarSpeaking]}>
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
          {onComms ? (speaking ? "Speaking…" : muted ? "Muted" : "Connected") : "Not on comms"}
        </Text>
      </View>
      <Ionicons
        name={!onComms ? "radio-outline" : muted ? "mic-off" : speaking ? "mic" : "mic-outline"}
        size={20}
        color={!onComms ? theme.color.textDim : muted ? theme.color.error : speaking ? theme.color.success : theme.color.textMuted}
      />
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
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
  content: { paddingHorizontal: theme.space.lg, paddingBottom: 120, gap: theme.space.md },
  commsCard: {
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.lg,
    padding: theme.space.lg, gap: theme.space.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  commsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  commsHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  commsHeaderText: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  pill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  pillText: { fontSize: 10, fontWeight: "800" },
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
  disclaimer: { flexDirection: "row", alignItems: "center", gap: 6 },
  disclaimerText: { color: theme.color.textMuted, fontSize: 11, flex: 1 },
  sectionTitle: { color: theme.color.text, fontSize: 15, fontWeight: "700", marginTop: theme.space.md },
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
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: theme.space.lg, backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  endBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.color.error, paddingVertical: 14, borderRadius: theme.radius.md,
  },
  endBtnText: { color: theme.color.text, fontWeight: "800", fontSize: 15 },
});
