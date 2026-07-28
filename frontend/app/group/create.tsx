import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api, FriendItem, GroupRide } from "@/src/lib/api";
import { theme } from "@/src/lib/theme";

export default function CreateGroup() {
  const router = useRouter();
  const [title, setTitle] = useState("Weekend Ride");
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const f = await api.get<FriendItem[]>("/friends");
        setFriends(f.filter((x) => x.status === "accepted"));
      } catch { /* ignore */ }
    })();
  }, []);

  const toggle = useCallback((username: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }, []);

  const create = async () => {
    setError(null); setCreating(true);
    try {
      const group = await api.post<GroupRide>("/groups", {
        title: title.trim() || "Group Ride",
        invite_usernames: Array.from(selected),
      });
      router.replace(`/group/${group.ride_id}`);
    } catch (e: any) {
      setError(e.message || "Failed to create group");
    } finally { setCreating(false); }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]} testID="create-group-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="create-group-close" style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={theme.color.text} />
        </Pressable>
        <Text style={styles.h1}>New group ride</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Group name</Text>
        <TextInput
          testID="create-group-title-input"
          value={title}
          onChangeText={setTitle}
          placeholder="Weekend Blast"
          placeholderTextColor={theme.color.textDim}
          style={styles.input}
        />

        <View style={styles.sectionHead}>
          <Text style={styles.label}>Invite friends</Text>
          <Text style={styles.selCount}>{selected.size} selected</Text>
        </View>

        {friends.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={26} color={theme.color.textDim} />
            <Text style={styles.emptyText}>Add friends first</Text>
            <Text style={styles.emptySub}>Head to the Friends tab and send a request.</Text>
          </View>
        ) : (
          <View style={{ gap: theme.space.sm }}>
            {friends.map((f) => {
              const on = selected.has(f.user.username);
              return (
                <Pressable
                  key={f.id}
                  testID={`create-group-friend-${f.user.username}`}
                  onPress={() => toggle(f.user.username)}
                  style={[styles.friendRow, on && styles.friendRowOn]}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{f.user.display_name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.friendName}>{f.user.display_name}</Text>
                    <Text style={styles.friendMeta}>@{f.user.username} · {f.user.bike_model || "Rider"}</Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Ionicons name="checkmark" size={16} color={theme.color.onBrand} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          testID="create-group-submit-button"
          onPress={create}
          disabled={creating}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          {creating ? <ActivityIndicator color={theme.color.onBrand} /> : (
            <>
              <Ionicons name="radio" size={20} color={theme.color.onBrand} />
              <Text style={styles.ctaText}>Create group & start intercom</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.hint}>
          Voice goes over the internet — no distance limit.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: theme.space.lg, paddingBottom: theme.space.sm,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: theme.color.surface2,
    alignItems: "center", justifyContent: "center",
  },
  h1: { color: theme.color.text, fontSize: 18, fontWeight: "800" },
  content: { padding: theme.space.lg, paddingBottom: 120, gap: theme.space.sm },
  label: { color: theme.color.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  input: {
    backgroundColor: theme.color.surface2, borderColor: theme.color.border, borderWidth: 1,
    paddingHorizontal: theme.space.lg, paddingVertical: 14, borderRadius: theme.radius.md,
    color: theme.color.text, fontSize: 16,
  },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: theme.space.lg },
  selCount: { color: theme.color.brand, fontSize: 12, fontWeight: "700" },
  friendRow: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, padding: theme.space.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
  },
  friendRowOn: { borderColor: theme.color.brand, backgroundColor: theme.color.brandTint },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.text, fontWeight: "800" },
  friendName: { color: theme.color.text, fontWeight: "700", fontSize: 14 },
  friendMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  check: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: theme.color.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  checkOn: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  empty: {
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    padding: theme.space.xl, alignItems: "center", gap: 6, borderWidth: 1, borderColor: theme.color.border,
  },
  emptyText: { color: theme.color.text, fontWeight: "700", marginTop: 4 },
  emptySub: { color: theme.color.textMuted, fontSize: 12, textAlign: "center" },
  error: { color: theme.color.error, textAlign: "center", marginTop: theme.space.md },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: theme.space.lg, backgroundColor: theme.color.surface,
    borderTopWidth: 1, borderTopColor: theme.color.border, gap: 6,
  },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: theme.color.brand, paddingVertical: 16, borderRadius: theme.radius.md,
  },
  ctaText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15, letterSpacing: 0.3 },
  hint: { color: theme.color.textMuted, fontSize: 11, textAlign: "center" },
});
