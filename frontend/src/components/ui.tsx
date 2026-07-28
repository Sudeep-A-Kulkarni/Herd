import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "@/src/lib/theme";

type Props = { children: React.ReactNode; testID?: string };
export function Screen({ children, testID }: Props) {
  return <View style={styles.screen} testID={testID}>{children}</View>;
}

export function StatCard({ label, value, unit, testID }: { label: string; value: string; unit?: string; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statRow}>
        <Text style={styles.statValue}>{value}</Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

export function Badge({ text, color, testID }: { text: string; color?: string; testID?: string }) {
  return (
    <View style={[styles.badge, color ? { backgroundColor: color + "22", borderColor: color } : null]} testID={testID}>
      <Text style={[styles.badgeText, color ? { color } : null]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  stat: {
    flex: 1,
    backgroundColor: theme.color.surface2,
    borderRadius: theme.radius.md,
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  statLabel: { color: theme.color.textDim, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  statRow: { flexDirection: "row", alignItems: "baseline", marginTop: 4, gap: 4 },
  statValue: { color: theme.color.text, fontSize: 28, fontWeight: "700" },
  statUnit: { color: theme.color.textMuted, fontSize: 12 },
  badge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface3,
  },
  badgeText: { color: theme.color.textMuted, fontSize: 11, fontWeight: "600" },
});
