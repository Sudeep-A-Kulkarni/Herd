import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView, RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, FriendItem, UserPublic } from "@/src/lib/api";
import { theme } from "@/src/lib/theme";

export default function FriendsScreen() {
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserPublic[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await api.get<FriendItem[]>("/friends");
      setFriends(list);
    } catch { /* ignore */ }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doSearch = async () => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await api.get<UserPublic[]>(`/friends/search?q=${encodeURIComponent(query.trim())}`);
      setResults(r);
    } catch { /* ignore */ }
    finally { setSearching(false); }
  };

  const sendRequest = async (u: UserPublic) => {
    try {
      await api.post<FriendItem>("/friends/request", { username: u.username });
      setMessage(`Request sent to @${u.username}`);
      setTimeout(() => setMessage(null), 2500);
      setResults((r) => r.filter((x) => x.id !== u.id));
      load();
    } catch (e: any) {
      setMessage(e.message || "Failed to send request");
      setTimeout(() => setMessage(null), 2500);
    }
  };

  const accept = async (id: string) => {
    try { await api.post(`/friends/${id}/accept`); load(); } catch { /* ignore */ }
  };
  const decline = async (id: string) => {
    try { await api.post(`/friends/${id}/decline`); load(); } catch { /* ignore */ }
  };

  const incoming = friends.filter((f) => f.status === "incoming");
  const accepted = friends.filter((f) => f.status === "accepted");
  const outgoing = friends.filter((f) => f.status === "outgoing");

  return (
    <SafeAreaView style={styles.screen} edges={["top"]} testID="friends-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>Friends</Text>
        <Text style={styles.sub}>{accepted.length} riding companions</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={theme.color.textMuted} />
        <TextInput
          testID="friends-search-input"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by username"
          placeholderTextColor={theme.color.textDim}
          autoCapitalize="none"
          onSubmitEditing={doSearch}
          returnKeyType="search"
          style={styles.searchInput}
        />
        {searching ? (
          <ActivityIndicator color={theme.color.brand} />
        ) : query.length > 0 ? (
          <Pressable onPress={doSearch} testID="friends-search-button">
            <Ionicons name="arrow-forward-circle" size={22} color={theme.color.brand} />
          </Pressable>
        ) : null}
      </View>

      {message ? <Text style={styles.toast} testID="friends-message">{message}</Text> : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.color.brand} />}
      >
        {results.length > 0 ? (
          <Section title="Search results">
            {results.map((u) => (
              <View key={u.id} style={styles.row} testID={`friend-search-result-${u.username}`}>
                <Avatar name={u.display_name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{u.display_name}</Text>
                  <Text style={styles.meta}>@{u.username} · {u.bike_model || "Rider"}</Text>
                </View>
                <Pressable
                  testID={`friend-add-${u.username}`}
                  style={styles.addBtn} onPress={() => sendRequest(u)}
                >
                  <Ionicons name="person-add" size={16} color={theme.color.onBrand} />
                  <Text style={styles.addBtnText}>Add</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        ) : null}

        {incoming.length > 0 && (
          <Section title="Requests">
            {incoming.map((f) => (
              <View key={f.id} style={styles.row} testID={`friend-incoming-${f.user.username}`}>
                <Avatar name={f.user.display_name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{f.user.display_name}</Text>
                  <Text style={styles.meta}>@{f.user.username}</Text>
                </View>
                <Pressable testID={`friend-accept-${f.user.username}`} style={styles.acceptBtn} onPress={() => accept(f.id)}>
                  <Ionicons name="checkmark" size={16} color={theme.color.onBrand} />
                </Pressable>
                <Pressable testID={`friend-decline-${f.user.username}`} style={styles.declineBtn} onPress={() => decline(f.id)}>
                  <Ionicons name="close" size={16} color={theme.color.text} />
                </Pressable>
              </View>
            ))}
          </Section>
        )}

        <Section title={`Riding companions (${accepted.length})`}>
          {accepted.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={28} color={theme.color.textDim} />
              <Text style={styles.emptyText}>No friends yet</Text>
              <Text style={styles.emptySub}>Search a username above to send a request.</Text>
            </View>
          ) : accepted.map((f) => (
            <View key={f.id} style={styles.row} testID={`friend-${f.user.username}`}>
              <Avatar name={f.user.display_name} riding={f.is_riding} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{f.user.display_name}</Text>
                <Text style={styles.meta}>@{f.user.username} · {f.user.bike_model || "Rider"}</Text>
              </View>
              {f.is_riding ? (
                <View style={styles.ridingBadge}>
                  <View style={styles.ridingDot} />
                  <Text style={styles.ridingText}>{Math.round(f.current_speed_kmh)} km/h</Text>
                </View>
              ) : (
                <Text style={styles.offlineText}>offline</Text>
              )}
            </View>
          ))}
        </Section>

        {outgoing.length > 0 && (
          <Section title="Pending">
            {outgoing.map((f) => (
              <View key={f.id} style={styles.row} testID={`friend-outgoing-${f.user.username}`}>
                <Avatar name={f.user.display_name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{f.user.display_name}</Text>
                  <Text style={styles.meta}>@{f.user.username} · Waiting for response</Text>
                </View>
                <Ionicons name="time-outline" size={20} color={theme.color.textMuted} />
              </View>
            ))}
          </Section>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Avatar({ name, riding }: { name: string; riding?: boolean }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
      {riding ? <View style={styles.avatarDot} /> : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: theme.space.sm, marginTop: theme.space.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ gap: theme.space.sm }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.space.lg, paddingTop: theme.space.sm },
  h1: { color: theme.color.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  sub: { color: theme.color.textMuted, marginTop: 2 },
  searchWrap: {
    marginHorizontal: theme.space.lg, marginTop: theme.space.md,
    backgroundColor: theme.color.surface2, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
    flexDirection: "row", alignItems: "center", gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  searchInput: { flex: 1, color: theme.color.text, paddingVertical: 12, fontSize: 15 },
  toast: {
    marginHorizontal: theme.space.lg, marginTop: theme.space.sm,
    color: theme.color.brand, fontSize: 13, fontWeight: "600",
  },
  content: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xxxl },
  sectionTitle: { color: theme.color.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
  row: {
    flexDirection: "row", alignItems: "center", gap: theme.space.md,
    backgroundColor: theme.color.surface2, padding: theme.space.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.brandTint,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: theme.color.text, fontWeight: "800" },
  avatarDot: {
    position: "absolute", right: -2, bottom: -2, width: 12, height: 12,
    borderRadius: 6, backgroundColor: theme.color.success, borderWidth: 2, borderColor: theme.color.surface2,
  },
  name: { color: theme.color.text, fontWeight: "700", fontSize: 15 },
  meta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: theme.color.brand, paddingHorizontal: theme.space.md,
    paddingVertical: 8, borderRadius: theme.radius.pill,
  },
  addBtnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 13 },
  acceptBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.success,
    alignItems: "center", justifyContent: "center",
  },
  declineBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surface3,
    alignItems: "center", justifyContent: "center",
  },
  empty: { alignItems: "center", gap: 6, padding: theme.space.xl },
  emptyText: { color: theme.color.text, fontWeight: "700" },
  emptySub: { color: theme.color.textMuted, fontSize: 12, textAlign: "center" },
  ridingBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: theme.color.success + "22", borderColor: theme.color.success, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.pill,
  },
  ridingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.success },
  ridingText: { color: theme.color.success, fontSize: 11, fontWeight: "800" },
  offlineText: { color: theme.color.textDim, fontSize: 12 },
});
