import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, LeaderboardEntry } from "@/src/lib/api";
import { theme } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";

type Scope = "all" | "week" | "month";

export default function Leaderboard() {
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>("all");
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      const r = await api.get<LeaderboardEntry[]>(`/leaderboard?scope=${s}`);
      setRows(r);
    } catch { /* ignore */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(scope); }, [load, scope]));

  return (
    <SafeAreaView style={styles.screen} edges={["top"]} testID="leaderboard-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>Leaderboard</Text>
        <Text style={styles.sub}>Ranked by total distance</Text>
      </View>

      <View style={styles.tabs}>
        {(["all", "month", "week"] as Scope[]).map((s) => (
          <Pressable
            key={s}
            testID={`leaderboard-tab-${s}`}
            onPress={() => setScope(s)}
            style={[styles.tab, scope === s && styles.tabActive]}
          >
            <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>
              {s === "all" ? "All-time" : s === "month" ? "Month" : "Week"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.color.brand} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="trophy-outline" size={40} color={theme.color.textDim} />
          <Text style={styles.emptyText}>No rides recorded yet</Text>
          <Text style={styles.emptySub}>Complete a ride to appear on the board.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(scope); }} tintColor={theme.color.brand} />}
        >
          <View style={styles.podium}>
            {rows.slice(0, 3).map((r, i) => (
              <PodiumCard key={r.rider.id} rank={i + 1} entry={r} highlight={r.rider.id === user?.id} />
            ))}
          </View>
          <View style={{ gap: theme.space.sm, marginTop: theme.space.md }}>
            {rows.slice(3).map((r, i) => (
              <View
                key={r.rider.id}
                style={[styles.row, r.rider.id === user?.id && styles.rowMe]}
                testID={`leaderboard-row-${i + 4}`}
              >
                <Text style={styles.rank}>#{i + 4}</Text>
                <View style={styles.avatar}><Text style={styles.avatarText}>{r.rider.display_name.slice(0,1).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{r.rider.display_name}</Text>
                  <Text style={styles.meta}>{r.total_rides} rides · top {Math.round(r.top_speed_kmh)} km/h</Text>
                </View>
                <Text style={styles.km}>{r.total_km.toFixed(1)}<Text style={styles.kmUnit}> km</Text></Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PodiumCard({ rank, entry, highlight }: { rank: number; entry: LeaderboardEntry; highlight: boolean }) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉";
  return (
    <View
      testID={`leaderboard-podium-${rank}`}
      style={[
        styles.podiumCard,
        rank === 1 && styles.podiumCard1,
        highlight && { borderColor: theme.color.brand, borderWidth: 2 },
      ]}
    >
      <Text style={styles.podiumMedal}>{medal}</Text>
      <View style={styles.podiumAvatar}>
        <Text style={styles.podiumAvatarText}>{entry.rider.display_name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <Text style={styles.podiumName} numberOfLines={1}>{entry.rider.display_name}</Text>
      <Text style={styles.podiumKm}>{entry.total_km.toFixed(1)}<Text style={{ color: theme.color.textMuted, fontSize: 12 }}> km</Text></Text>
      <Text style={styles.podiumMeta}>{entry.total_rides} rides · {Math.round(entry.top_speed_kmh)} km/h</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm },
  h1: { color: theme.color.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  sub: { color: theme.color.textMuted, marginTop: 2 },
  tabs: {
    flexDirection: "row", marginHorizontal: theme.space.lg, marginTop: theme.space.md,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.pill, padding: 4,
    borderWidth: 1, borderColor: theme.color.border,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: theme.radius.pill },
  tabActive: { backgroundColor: theme.color.brand },
  tabText: { color: theme.color.textMuted, fontWeight: "700", fontSize: 13 },
  tabTextActive: { color: theme.color.onBrand },
  content: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xxxl, paddingTop: theme.space.md },
  podium: { flexDirection: "row", gap: theme.space.sm, alignItems: "flex-end" },
  podiumCard: {
    flex: 1, backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.md, alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: theme.color.border,
  },
  podiumCard1: { paddingVertical: theme.space.lg, backgroundColor: theme.color.brandTint, borderColor: theme.color.brand },
  podiumMedal: { fontSize: 22 },
  podiumAvatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  podiumAvatarText: { color: theme.color.text, fontWeight: "800", fontSize: 18 },
  podiumName: { color: theme.color.text, fontWeight: "700", fontSize: 13, textAlign: "center" },
  podiumKm: { color: theme.color.brand, fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
  podiumMeta: { color: theme.color.textMuted, fontSize: 10, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, padding: theme.space.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
  },
  rowMe: { borderColor: theme.color.brand },
  rank: { color: theme.color.textDim, fontWeight: "700", width: 32 },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.text, fontWeight: "800" },
  name: { color: theme.color.text, fontWeight: "700", fontSize: 14 },
  meta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  km: { color: theme.color.brand, fontWeight: "900", fontSize: 16 },
  kmUnit: { color: theme.color.textMuted, fontSize: 12, fontWeight: "600" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: theme.space.xl },
  emptyText: { color: theme.color.text, fontWeight: "700", marginTop: theme.space.sm },
  emptySub: { color: theme.color.textMuted, fontSize: 12, textAlign: "center" },
});
