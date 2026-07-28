import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, GroupRecap } from "@/src/lib/api";
import { RouteMap } from "@/src/components/RouteMap";
import { formatDuration } from "@/src/lib/ride-tracker";
import { theme } from "@/src/lib/theme";

export default function Recap() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [recap, setRecap] = useState<GroupRecap | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get<GroupRecap>(`/groups/${id}/recap`);
      setRecap(r);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const share = async () => {
    if (!recap) return;
    const lines = [
      `🏁 ${recap.title} — BikeFriends recap`,
      `${recap.total_riders} riders · ${recap.crew_total_km} km total`,
      `Top speed: ${Math.round(recap.crew_top_speed_kmh)} km/h`,
      `Ride together. Track together. — bikefriends.app`,
    ];
    try {
      if (Platform.OS === "web" && (globalThis as any).navigator?.share) {
        await (globalThis as any).navigator.share({ text: lines.join("\n"), title: "BikeFriends Recap" });
      } else {
        await Share.share({ message: lines.join("\n") });
      }
    } catch { /* ignore */ }
  };

  if (loading || !recap) {
    return <View style={styles.loader}><ActivityIndicator color={theme.color.brand} /></View>;
  }

  const merged = recap.members.flatMap((m) => m.polyline);
  const topRider = [...recap.members].sort((a, b) => b.top_speed_kmh - a.top_speed_kmh)[0];
  const distanceLeader = [...recap.members].sort((a, b) => b.distance_km - a.distance_km)[0];

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]} testID="recap-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.replace("/(tabs)")} style={styles.closeBtn} testID="recap-close-button">
          <Ionicons name="close" size={22} color={theme.color.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Ride recap</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card} testID="recap-card">
          <LinearGradient
            colors={[theme.color.brand, theme.color.brandDim, theme.color.brandTint]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardKicker}>BIKEFRIENDS</Text>
              <Text style={styles.cardTitle}>{recap.title}</Text>
              <Text style={styles.cardDate}>{new Date(recap.started_at).toLocaleDateString()}</Text>
            </View>
            <View style={styles.crewBadge}>
              <Ionicons name="people" size={12} color={theme.color.onBrand} />
              <Text style={styles.crewBadgeText}>{recap.total_riders}</Text>
            </View>
          </View>

          <View style={styles.mapThumb}>
            {merged.length > 1
              ? <RouteMap polyline={merged} height="100%" testID="recap-map" />
              : <View style={styles.mapEmpty}><Ionicons name="map-outline" size={30} color={theme.color.textMuted} /></View>}
          </View>

          <View style={styles.bigStatsRow}>
            <BigStat label="CREW KM" value={recap.crew_total_km.toFixed(1)} testID="recap-crew-km" />
            <BigStat label="TOP SPEED" value={Math.round(recap.crew_top_speed_kmh).toString()} unit="km/h" testID="recap-top-speed" />
          </View>
          <View style={styles.bigStatsRow}>
            <BigStat label="AVG SPEED" value={Math.round(recap.crew_avg_speed_kmh).toString()} unit="km/h" testID="recap-avg-speed" />
            <BigStat
              label="LONGEST"
              value={distanceLeader ? `${distanceLeader.rider.display_name.split(" ")[0]}` : "—"}
              testID="recap-longest"
              small
            />
          </View>
        </View>

        {topRider ? (
          <View style={styles.mvpCard} testID="recap-mvp">
            <View style={styles.mvpBadge}>
              <Ionicons name="flash" size={16} color={theme.color.onBrand} />
              <Text style={styles.mvpBadgeText}>SPEED KING</Text>
            </View>
            <Text style={styles.mvpName}>{topRider.rider.display_name}</Text>
            <Text style={styles.mvpMeta}>Top {Math.round(topRider.top_speed_kmh)} km/h · {topRider.distance_km.toFixed(1)} km</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Crew</Text>
        <View style={{ gap: theme.space.sm }}>
          {recap.members.map((m) => (
            <View key={m.rider.id} style={styles.memberRow} testID={`recap-member-${m.rider.username}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{m.rider.display_name.slice(0,1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{m.rider.display_name}</Text>
                <Text style={styles.memberMeta}>{formatDuration(m.duration_seconds)} · top {Math.round(m.top_speed_kmh)} km/h</Text>
              </View>
              <Text style={styles.memberKm}>{m.distance_km.toFixed(1)}<Text style={styles.memberKmUnit}> km</Text></Text>
            </View>
          ))}
        </View>

        <View style={styles.tipCard}>
          <Ionicons name="share-social" size={16} color={theme.color.brand} />
          <Text style={styles.tipText}>Share your recap — every share brings a new rider to the crew.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.shareBtn} onPress={share} testID="recap-share-button">
          <Ionicons name="share" size={18} color={theme.color.onBrand} />
          <Text style={styles.shareText}>Share recap</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function BigStat({ label, value, unit, testID, small }: { label: string; value: string; unit?: string; testID?: string; small?: boolean }) {
  return (
    <View style={styles.bigStat} testID={testID}>
      <Text style={styles.bigStatLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
        <Text style={[styles.bigStatValue, small && { fontSize: 22 }]}>{value}</Text>
        {unit ? <Text style={styles.bigStatUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  loader: { flex: 1, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: theme.space.lg, paddingBottom: theme.space.sm,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surface2,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: theme.color.text, fontSize: 17, fontWeight: "800" },
  content: { padding: theme.space.lg, paddingBottom: 110, gap: theme.space.md },
  card: {
    borderRadius: theme.radius.lg, padding: theme.space.lg,
    overflow: "hidden",
    gap: theme.space.md,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardKicker: { color: "rgba(0,0,0,0.6)", fontSize: 10, letterSpacing: 3, fontWeight: "900" },
  cardTitle: { color: theme.color.onBrand, fontSize: 26, fontWeight: "900", marginTop: 4 },
  cardDate: { color: "rgba(0,0,0,0.7)", fontSize: 12, fontWeight: "600", marginTop: 2 },
  crewBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill,
  },
  crewBadgeText: { color: theme.color.onBrand, fontWeight: "900", fontSize: 13 },
  mapThumb: {
    height: 160, borderRadius: theme.radius.md, overflow: "hidden",
    backgroundColor: theme.color.surface,
  },
  mapEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  bigStatsRow: { flexDirection: "row", gap: theme.space.md },
  bigStat: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: theme.radius.md, padding: theme.space.md,
  },
  bigStatLabel: { color: theme.color.onBrand, fontSize: 10, letterSpacing: 2, fontWeight: "800", opacity: 0.85 },
  bigStatValue: { color: theme.color.onBrand, fontSize: 32, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  bigStatUnit: { color: theme.color.onBrand, fontSize: 12, fontWeight: "700", opacity: 0.75 },
  mvpCard: {
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.lg, gap: 4,
    borderWidth: 1, borderColor: theme.color.brand,
  },
  mvpBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: theme.color.brand, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: theme.radius.pill, alignSelf: "flex-start",
  },
  mvpBadgeText: { color: theme.color.onBrand, fontWeight: "900", fontSize: 10, letterSpacing: 1 },
  mvpName: { color: theme.color.text, fontSize: 20, fontWeight: "900", marginTop: 6 },
  mvpMeta: { color: theme.color.textMuted, fontSize: 12 },
  sectionTitle: { color: theme.color.text, fontSize: 15, fontWeight: "700", marginTop: theme.space.md },
  memberRow: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, padding: theme.space.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.text, fontWeight: "800" },
  memberName: { color: theme.color.text, fontWeight: "700", fontSize: 14 },
  memberMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  memberKm: { color: theme.color.brand, fontWeight: "900", fontSize: 16 },
  memberKmUnit: { color: theme.color.textMuted, fontSize: 12, fontWeight: "600" },
  tipCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: theme.color.brandTint, borderRadius: theme.radius.md,
    padding: theme.space.md, borderWidth: 1, borderColor: theme.color.brand,
    marginTop: theme.space.md,
  },
  tipText: { color: theme.color.text, fontSize: 12, flex: 1 },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: theme.space.lg, backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border,
  },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.color.brand, paddingVertical: 16, borderRadius: theme.radius.md,
  },
  shareText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
});
