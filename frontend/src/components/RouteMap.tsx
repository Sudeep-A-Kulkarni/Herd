/**
 * RouteMap — Leaflet map with a live route polyline + one-or-more rider markers.
 * Works on native (react-native-webview) and on web (inline iframe).
 */
import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { theme } from "@/src/lib/theme";

export type MapRider = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  self?: boolean;
};

type Props = {
  polyline?: [number, number][];
  center?: { lat: number; lng: number } | null;
  riders?: MapRider[];
  fitAll?: boolean;
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
  .rider-dot { display:flex; align-items:center; gap:6px; }
  .rider-dot .pin {
    width:16px; height:16px; border-radius:8px;
    background: var(--c, ${brand});
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--c, ${brand}) 25%, transparent), 0 0 12px var(--c, ${brand});
  }
  .rider-dot .pin.self { width:18px; height:18px; border-radius:9px; }
  .rider-dot .lbl {
    color:#fff; font: 700 11px/1 -apple-system, system-ui, sans-serif;
    background: rgba(13,14,17,0.85); padding:3px 6px; border-radius:6px;
    border: 1px solid rgba(255,255,255,0.15); white-space: nowrap;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const brand = '${brand}';
  const map = L.map('map', { zoomControl:false, attributionControl:false }).setView([37.7749,-122.4194], 15);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  let poly = L.polyline([], { color: brand, weight: 5, lineCap:'round', lineJoin:'round' }).addTo(map);
  const markers = {}; // id -> marker
  function makeIcon(color, label, self) {
    const c = color || brand;
    const html = '<div class="rider-dot"><span class="pin' + (self?' self':'') + '" style="--c:' + c + '"></span>' +
      (label ? '<span class="lbl">' + label + '</span>' : '') + '</div>';
    return L.divIcon({ className:'', html, iconSize:[0,0], iconAnchor:[9,9] });
  }
  function apply(payload){
    if (payload.polyline) {
      poly.setLatLngs(payload.polyline);
    }
    if (Array.isArray(payload.riders)) {
      const seen = new Set();
      payload.riders.forEach(r => {
        seen.add(r.id);
        const icon = makeIcon(r.color, r.label, r.self);
        if (markers[r.id]) { markers[r.id].setLatLng([r.lat, r.lng]).setIcon(icon); }
        else { markers[r.id] = L.marker([r.lat, r.lng], { icon }).addTo(map); }
      });
      Object.keys(markers).forEach(id => {
        if (!seen.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
      });
    }
    if (payload.center) {
      map.setView([payload.center.lat, payload.center.lng], payload.zoom || map.getZoom() || 15);
    }
    if (payload.fitAll) {
      const bounds = [];
      if (payload.polyline && payload.polyline.length) bounds.push(...payload.polyline);
      if (Array.isArray(payload.riders)) payload.riders.forEach(r => bounds.push([r.lat, r.lng]));
      if (bounds.length === 1) map.setView(bounds[0], 15);
      else if (bounds.length > 1) map.fitBounds(bounds, { padding:[30,30], maxZoom: 16 });
    } else if (payload.follow && payload.polyline && payload.polyline.length) {
      const last = payload.polyline[payload.polyline.length - 1];
      map.setView(last, map.getZoom() < 15 ? 16 : map.getZoom());
    }
  }
  window.__apply = apply;
  window.addEventListener('message', function(e){ try { apply(typeof e.data==='string'?JSON.parse(e.data):e.data); } catch(err){} });
  document.addEventListener('message', function(e){ try { apply(typeof e.data==='string'?JSON.parse(e.data):e.data); } catch(err){} });
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready');
  window.parent && window.parent.postMessage && window.parent.postMessage('ready','*');
</script>
</body></html>`;

function RouteMapWeb({ polyline, center, riders, fitAll, height, testID }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const html = useMemo(() => HTML(theme.color.brand), []);

  const push = () => {
    if (!readyRef.current || !iframeRef.current) return;
    iframeRef.current.contentWindow?.postMessage(
      { polyline, follow: true, center, riders, fitAll }, "*",
    );
  };
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.data === "ready") { readyRef.current = true; push(); } };
    (globalThis as any).addEventListener?.("message", onMsg);
    return () => (globalThis as any).removeEventListener?.("message", onMsg);
  }, []);
  useEffect(() => { push(); }, [polyline, center, riders, fitAll]);

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

function RouteMapNative({ polyline, center, riders, fitAll, height, testID }: Props) {
  const ref = useRef<WebView>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const html = useMemo(() => HTML(theme.color.brand), []);
  const send = (payload: any) => {
    const msg = JSON.stringify(payload);
    if (readyRef.current) ref.current?.injectJavaScript(`(function(){ try{ window.__apply(${JSON.stringify(msg)}); }catch(e){} true; })();`);
    else pendingRef.current = msg;
  };
  useEffect(() => { send({ polyline, follow: true, center, riders, fitAll }); }, [polyline, center, riders, fitAll]);
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
