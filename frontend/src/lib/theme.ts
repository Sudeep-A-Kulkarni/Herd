export const theme = {
  color: {
    surface: "#0D0E11",
    surface2: "#1A1C21",
    surface3: "#262930",
    text: "#F5F6F8",
    textMuted: "#B0B3BC",
    textDim: "#7B7F8B",
    brand: "#FF6B00",
    brandDim: "#CC5600",
    brandTint: "#402008",
    onBrand: "#000000",
    success: "#00E676",
    warning: "#FFD600",
    error: "#FF3B30",
    info: "#00AEEF",
    border: "#262930",
    borderStrong: "#3B3F4A",
    divider: "#1A1C21",
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font: {
    display: "System",
    text: "System",
  },
} as const;

export type Theme = typeof theme;
