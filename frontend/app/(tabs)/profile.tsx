import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, RideSummary } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { theme } from "@/src/lib/theme";
import { formatDuration } from "@/src/lib/ride-tracker";

export default function Profile() {
  const { user, signOut, refresh } = useAuth();
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [bikeModel, setBikeModel] = useState(user?.bike_model || "");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<RideSummary[]>("/rides/mine");
      setRides(r);
    } catch { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalKm = rides.reduce((sum, r) => sum + (r.status === "completed" ? r.distance_km : 0), 0);
  const totalRides = rides.filter((r) => r.status === "completed").length;
  const topSpeed = rides.reduce((max, r) => Math.max(max, r.top_speed_kmh), 0);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/auth/me", { display_name: displayName, bike_model: bikeModel });
      await refresh();
      setEditing(false);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]} testID="profile-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <LinearGradient
            colors={[theme.color.brandTint, theme.color.surface]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.display_name || "R").slice(0, 1).toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.identity}>
          <Text style={styles.name} testID="profile-name">{user?.display_name}</Text>
          <Text style={styles.username}>@{user?.username}</Text>
          <View style={styles.bikeRow}>
            <Ionicons name="bicycle" size={14} color={theme.color.brand} />
            <Text style={styles.bike}>{user?.bike_model || "No bike set"}</Text>
          </View>
        </View>

        <View style={styles.stats}>
          <Stat label="Distance" value={totalKm.toFixed(0)} unit="km" testID="profile-stat-distance" />
          <Stat label="Rides" value={totalRides.toString()} testID="profile-stat-rides" />
          <Stat label="Top Speed" value={Math.round(topSpeed).toString()} unit="km/h" testID="profile-stat-topspeed" />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Profile</Text>
            <Pressable
              testID="profile-edit-button"
              onPress={() => (editing ? save() : setEditing(true))}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color={theme.color.brand} /> :
                <Text style={styles.editText}>{editing ? "Save" : "Edit"}</Text>}
            </Pressable>
          </View>

          <ProfileField
            label="Display name"
            editing={editing}
            value={displayName}
            onChangeText={setDisplayName}
            testID="profile-displayname"
          />
          <ProfileField
            label="Bike model"
            editing={editing}
            value={bikeModel}
            onChangeText={setBikeModel}
            testID="profile-bikemodel"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent rides</Text>
          {rides.length === 0 ? (
            <Text style={styles.empty}>No rides yet</Text>
          ) : (
            rides.slice(0, 5).map((r) => (
              <View key={r.id} style={styles.rideRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rideTitle}>{r.title}</Text>
                  <Text style={styles.rideMeta}>{new Date(r.started_at).toLocaleDateString()} · {formatDuration(r.duration_seconds)}</Text>
                </View>
                <Text style={styles.rideKm}>{r.distance_km.toFixed(1)} km</Text>
              </View>
            ))
          )}
        </View>

        <Pressable style={styles.signOutBtn} onPress={signOut} testID="profile-sign-out-button">
          <Ionicons name="log-out" size={18} color={theme.color.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, unit, testID }: { label: string; value: string; unit?: string; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
        <Text style={styles.statVal}>{value}</Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ProfileField({ label, editing, value, onChangeText, testID }: any) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {editing ? (
        <TextInput
          testID={`${testID}-input`}
          value={value}
          onChangeText={onChangeText}
          style={styles.fieldInput}
          placeholderTextColor={theme.color.textDim}
        />
      ) : (
        <Text style={styles.fieldValue} testID={`${testID}-value`}>{value || "—"}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  content: { paddingBottom: theme.space.xxxl },
  banner: { height: 130, position: "relative" },
  avatar: {
    position: "absolute", left: theme.space.lg, bottom: -32,
    width: 80, height: 80, borderRadius: 40, backgroundColor: theme.color.brand,
    alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: theme.color.surface,
  },
  avatarText: { color: theme.color.onBrand, fontSize: 32, fontWeight: "900" },
  identity: { paddingHorizontal: theme.space.lg, marginTop: theme.space.xl + 12, gap: 2 },
  name: { color: theme.color.text, fontSize: 22, fontWeight: "800" },
  username: { color: theme.color.textMuted, fontSize: 14 },
  bikeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  bike: { color: theme.color.text, fontSize: 13 },
  stats: {
    flexDirection: "row", gap: theme.space.sm,
    marginHorizontal: theme.space.lg, marginTop: theme.space.lg,
  },
  stat: {
    flex: 1, backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.md, borderWidth: 1, borderColor: theme.color.border,
  },
  statVal: { color: theme.color.text, fontSize: 22, fontWeight: "900" },
  statUnit: { color: theme.color.textMuted, fontSize: 11 },
  statLabel: { color: theme.color.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  card: {
    marginHorizontal: theme.space.lg, marginTop: theme.space.lg,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.lg, gap: theme.space.md, borderWidth: 1, borderColor: theme.color.border,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: theme.color.text, fontSize: 15, fontWeight: "700" },
  editText: { color: theme.color.brand, fontWeight: "800", fontSize: 13 },
  field: { gap: 4 },
  fieldLabel: { color: theme.color.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  fieldValue: { color: theme.color.text, fontSize: 15 },
  fieldInput: {
    color: theme.color.text, fontSize: 15,
    backgroundColor: theme.color.surface3, borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm, paddingVertical: 8,
    borderWidth: 1, borderColor: theme.color.border,
  },
  rideRow: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    paddingVertical: theme.space.sm, borderTopColor: theme.color.border, borderTopWidth: 1,
  },
  rideTitle: { color: theme.color.text, fontWeight: "700", fontSize: 14 },
  rideMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  rideKm: { color: theme.color.brand, fontWeight: "900", fontSize: 15 },
  empty: { color: theme.color.textMuted, fontSize: 13, textAlign: "center", paddingVertical: theme.space.md },
  signOutBtn: {
    marginHorizontal: theme.space.lg, marginTop: theme.space.xl,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.error + "66",
    backgroundColor: theme.color.error + "11",
  },
  signOutText: { color: theme.color.error, fontWeight: "800", fontSize: 15 },
});
