import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { api, FriendItem, RideSummary } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { theme } from "@/src/lib/theme";
import { Badge } from "@/src/components/ui";
import { formatDuration } from "@/src/lib/ride-tracker";

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [f, r] = await Promise.all([
        api.get<FriendItem[]>("/friends"),
        api.get<RideSummary[]>("/rides/mine"),
      ]);
      setFriends(f);
      setRides(r);
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const riding = friends.filter((f) => f.status === "accepted" && f.is_riding);
  const accepted = friends.filter((f) => f.status === "accepted");

  return (
    <SafeAreaView style={styles.screen} testID="home-screen" edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.color.brand} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.hello}>Hey, {user?.display_name?.split(" ")[0] || "Rider"}</Text>
            <Text style={styles.subtitle}>Ready to hit the road?</Text>
          </View>
          <Pressable
            testID="home-start-ride-button"
            style={styles.startBtn}
            onPress={() => router.push("/(tabs)/ride")}
          >
            <Ionicons name="play" size={18} color={theme.color.onBrand} />
            <Text style={styles.startBtnText}>Start Ride</Text>
          </Pressable>
        </View>

        <SectionHeader title="Live now" count={riding.length} />
        {riding.length === 0 ? (
          <View style={styles.emptyCard} testID="home-no-live-friends">
            <Ionicons name="pulse" size={24} color={theme.color.textDim} />
            <Text style={styles.emptyText}>No friends riding right now</Text>
            <Text style={styles.emptySub}>They'll show up here when they start a ride.</Text>
          </View>
        ) : (
          <View style={{ gap: theme.space.sm }}>
            {riding.map((f) => (
              <View key={f.id} style={styles.liveCard} testID={`home-live-${f.user.username}`}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{f.user.display_name.slice(0, 1).toUpperCase()}</Text>
                  <View style={styles.liveDot} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.liveName}>{f.user.display_name}</Text>
                  <Text style={styles.liveMeta}>@{f.user.username} · {f.user.bike_model || "Rider"}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.liveSpeed}>{Math.round(f.current_speed_kmh)}</Text>
                  <Text style={styles.liveUnit}>km/h</Text>
                </View>
                {f.is_on_comms ? <Badge text="COMMS" color={theme.color.success} /> : null}
              </View>
            ))}
          </View>
        )}

        <SectionHeader title={`Friends (${accepted.length})`} />
        <View style={{ gap: theme.space.sm }}>
          {accepted.slice(0, 5).map((f) => (
            <View key={f.id} style={styles.friendRow}>
              <View style={styles.avatarSmall}>
                <Text style={styles.avatarText}>{f.user.display_name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.friendName}>{f.user.display_name}</Text>
                <Text style={styles.friendMeta}>@{f.user.username}</Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: f.is_riding ? theme.color.success : theme.color.surface3 }]} />
            </View>
          ))}
          {accepted.length === 0 && (
            <Pressable style={styles.emptyCard} onPress={() => router.push("/(tabs)/friends")} testID="home-add-friend-cta">
              <Ionicons name="person-add" size={22} color={theme.color.brand} />
              <Text style={styles.emptyText}>Add your first friend</Text>
            </Pressable>
          )}
        </View>

        <SectionHeader title="Recent rides" />
        {rides.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="map" size={22} color={theme.color.textDim} />
            <Text style={styles.emptyText}>No rides yet</Text>
            <Text style={styles.emptySub}>Start your first ride from the Ride tab.</Text>
          </View>
        ) : (
          <View style={{ gap: theme.space.sm }}>
            {rides.slice(0, 5).map((r) => (
              <View key={r.id} style={styles.rideCard} testID={`home-ride-${r.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rideTitle}>{r.title}</Text>
                  <Text style={styles.rideMeta}>{new Date(r.started_at).toLocaleDateString()}</Text>
                </View>
                <View style={styles.rideStats}>
                  <Text style={styles.rideStatValue}>{r.distance_km.toFixed(1)} km</Text>
                  <Text style={styles.rideStatMeta}>{formatDuration(r.duration_seconds)} · {Math.round(r.top_speed_kmh)} km/h top</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {typeof count === "number" ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  content: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xxxl, gap: theme.space.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: theme.space.sm },
  hello: { color: theme.color.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  subtitle: { color: theme.color.textMuted, marginTop: 2 },
  startBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: theme.color.brand, paddingHorizontal: theme.space.lg, paddingVertical: 10,
    borderRadius: theme.radius.pill,
  },
  startBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 14 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: theme.space.lg },
  sectionTitle: { color: theme.color.text, fontSize: 18, fontWeight: "700" },
  sectionCount: { color: theme.color.textMuted, fontSize: 13 },
  emptyCard: {
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.lg, alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: theme.color.border,
  },
  emptyText: { color: theme.color.text, fontSize: 15, fontWeight: "600" },
  emptySub: { color: theme.color.textMuted, fontSize: 13, textAlign: "center" },
  liveCard: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md, padding: theme.space.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brandTint,
    alignItems: "center", justifyContent: "center",
  },
  avatarSmall: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.text, fontWeight: "800" },
  liveDot: {
    position: "absolute", right: -2, bottom: -2, width: 12, height: 12,
    borderRadius: 6, backgroundColor: theme.color.success, borderWidth: 2, borderColor: theme.color.surface2,
  },
  liveName: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  liveMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  liveSpeed: { color: theme.color.brand, fontSize: 24, fontWeight: "800" },
  liveUnit: { color: theme.color.textMuted, fontSize: 11 },
  friendRow: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.md, borderWidth: 1, borderColor: theme.color.border,
  },
  friendName: { color: theme.color.text, fontWeight: "600", fontSize: 14 },
  friendMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  rideCard: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.md, borderWidth: 1, borderColor: theme.color.border,
  },
  rideTitle: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  rideMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  rideStats: { alignItems: "flex-end" },
  rideStatValue: { color: theme.color.brand, fontWeight: "800", fontSize: 16 },
  rideStatMeta: { color: theme.color.textMuted, fontSize: 11, marginTop: 2 },
});
