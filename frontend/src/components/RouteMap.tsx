/**
 * RouteMap — Leaflet-in-WebView on native, inline iframe fallback on web.
 * Renders live polyline + rider marker.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { theme } from "@/src/lib/theme";

type Props = {
  polyline: [number, number][];
  center?: { lat: number; lng: number } | null;
  height?: number | "100%";
  testID?: string;
};

const HTML = (brand: string) => `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#0D0E11; }
  .rider-dot { width:18px; height:18px; border-radius:9px; background:${brand}; box-shadow:0 0 0 4px rgba(255,107,0,0.25), 0 0 12px ${brand}; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const map = L.map('map', { zoomControl:false, attributionControl:false }).setView([37.7749,-122.4194], 15);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  let poly = L.polyline([], { color: '${brand}', weight: 5, lineCap:'round', lineJoin:'round' }).addTo(map);
  const riderIcon = L.divIcon({ className:'', html:'<div class="rider-dot"></div>', iconSize:[18,18], iconAnchor:[9,9] });
  let marker = null;
  function apply(payload){
    if (payload.polyline) {
      poly.setLatLngs(payload.polyline);
      if (payload.polyline.length > 0) {
        const last = payload.polyline[payload.polyline.length - 1];
        if (!marker) marker = L.marker(last, { icon: riderIcon }).addTo(map);
        else marker.setLatLng(last);
        if (payload.follow) map.setView(last, map.getZoom() < 15 ? 16 : map.getZoom());
        if (payload.fit && payload.polyline.length > 1) map.fitBounds(poly.getBounds(), { padding:[30,30] });
      }
    }
    if (payload.center && !payload.polyline?.length) {
      map.setView([payload.center.lat, payload.center.lng], 15);
      if (!marker) marker = L.marker([payload.center.lat, payload.center.lng], { icon: riderIcon }).addTo(map);
      else marker.setLatLng([payload.center.lat, payload.center.lng]);
    }
    if (payload.polyline && payload.polyline.length > 1 && payload.fitOnce) {
      map.fitBounds(poly.getBounds(), { padding:[30,30] });
    }
  }
  window.__apply = apply;
  window.addEventListener('message', function(e){ try { apply(typeof e.data==='string'?JSON.parse(e.data):e.data); } catch(err){} });
  document.addEventListener('message', function(e){ try { apply(typeof e.data==='string'?JSON.parse(e.data):e.data); } catch(err){} });
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready');
  window.parent && window.parent.postMessage && window.parent.postMessage('ready','*');
</script>
</body></html>`;

// ---- Web variant: inline iframe ----
function RouteMapWeb({ polyline, center, height, testID }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const html = useMemo(() => HTML(theme.color.brand), []);

  const push = () => {
    if (!readyRef.current || !iframeRef.current) return;
    iframeRef.current.contentWindow?.postMessage({ polyline, follow: true, center, fitOnce: true }, "*");
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data === "ready") { readyRef.current = true; push(); }
    };
    (globalThis as any).addEventListener?.("message", onMsg);
    return () => (globalThis as any).removeEventListener?.("message", onMsg);
  }, []);

  useEffect(() => { push(); }, [polyline, center]);

  return (
    <View style={[styles.wrap, { height }]} testID={testID}>
      {/* @ts-ignore native-only element on web */}
      <iframe
        ref={iframeRef as any}
        srcDoc={html}
        style={{ width: "100%", height: "100%", border: "0", background: theme.color.surface }}
        title="route-map"
      />
    </View>
  );
}

// ---- Native variant: react-native-webview ----
function RouteMapNative({ polyline, center, height, testID }: Props) {
  const ref = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const html = useMemo(() => HTML(theme.color.brand), []);

  const send = (payload: any) => {
    const msg = JSON.stringify(payload);
    if (readyRef.current) {
      ref.current?.injectJavaScript(`(function(){ try{ window.__apply(${JSON.stringify(msg)}); }catch(e){} true; })();`);
    } else {
      pendingRef.current = msg;
    }
  };

  useEffect(() => { send({ polyline, follow: true, center, fitOnce: true }); }, [polyline, center]);

  return (
    <View style={[styles.wrap, { height }]} testID={testID}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        onMessage={(e) => {
          if (e.nativeEvent.data === "ready") {
            readyRef.current = true;
            if (pendingRef.current) {
              const msg = pendingRef.current;
              ref.current?.injectJavaScript(`(function(){ try{ window.__apply(${JSON.stringify(msg)}); }catch(e){} true; })();`);
              pendingRef.current = null;
            }
          }
        }}
      />
    </View>
  );
}

export function RouteMap(props: Props) {
  return Platform.OS === "web" ? <RouteMapWeb {...props} /> : <RouteMapNative {...props} />;
}

const styles = StyleSheet.create({
  wrap: { width: "100%", backgroundColor: theme.color.surface, overflow: "hidden" },
  web: { flex: 1, backgroundColor: theme.color.surface },
});
