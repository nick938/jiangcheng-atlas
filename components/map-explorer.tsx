"use client";

import Link from "next/link";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categoryMeta, type CategoryFilter, type Place } from "@/lib/places";

const WUHAN_CENTER: [number, number] = [114.3055, 30.5928];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

function toFeatureCollection(places: Place[]) {
  return {
    type: "FeatureCollection" as const,
    features: places.map((place) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [place.longitude, place.latitude],
      },
      properties: { id: place.id, name: place.name, categoryId: place.categoryId },
    })),
  };
}

type ApiResponse = { places: Place[]; source: "d1" | "seed" };
type MapExplorerProps = { initialPlaces: Place[] };

export function MapExplorer({ initialPlaces }: MapExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const placesRef = useRef(initialPlaces);
  const [places, setPlaces] = useState(initialPlaces);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mapError, setMapError] = useState(false);
  const [dataSource, setDataSource] = useState<"d1" | "seed">("seed");

  const filteredPlaces = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return places.filter((place) => {
      const matchesCategory = category === "all" || place.categoryId === category;
      const searchable = `${place.name} ${place.subtitle} ${place.district} ${place.address}`.toLocaleLowerCase("zh-CN");
      return matchesCategory && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [category, places, query]);

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedId) ?? null,
    [places, selectedId],
  );

  const focusPlace = useCallback((place: Place) => {
    setSelectedId(place.id);
    if (window.matchMedia("(max-width: 760px)").matches) setPanelOpen(false);
    mapRef.current?.flyTo({
      center: [place.longitude, place.latitude],
      zoom: 14.6,
      duration: 1100,
      essential: true,
      offset: [120, 0],
    });

    const url = new URL(window.location.href);
    url.searchParams.set("place", place.slug);
    window.history.replaceState(null, "", url);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    if (window.matchMedia("(max-width: 760px)").matches) setPanelOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("place");
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    placesRef.current = places;
  }, [places]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/places", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Places request failed: ${response.status}`);
        return response.json() as Promise<ApiResponse>;
      })
      .then((payload) => {
        if (payload.places.length > 0) setPlaces(payload.places);
        setDataSource(payload.source);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.warn("Using bundled Wuhan places.", error);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: WUHAN_CENTER,
      zoom: 10.9,
      minZoom: 8.5,
      maxZoom: 18,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
      }),
      "bottom-right",
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("places", {
        type: "geojson",
        data: toFeatureCollection(placesRef.current),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 52,
      });

      map.addLayer({
        id: "place-cluster-halo",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(19, 39, 39, 0.18)",
          "circle-radius": ["step", ["get", "point_count"], 26, 10, 31, 25, 37],
        },
      });
      map.addLayer({
        id: "place-clusters",
        type: "circle",
        source: "places",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#173f3a",
          "circle-radius": ["step", ["get", "point_count"], 20, 10, 25, 25, 31],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#f4f0e6",
        },
      });
      map.addLayer({
        id: "place-cluster-count",
        type: "symbol",
        source: "places",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 13 },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "place-points",
        type: "circle",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 15, 11],
          "circle-color": [
            "match", ["get", "categoryId"],
            "landmark", categoryMeta.landmark.color,
            "nature", categoryMeta.nature.color,
            "culture", categoryMeta.culture.color,
            "neighborhood", categoryMeta.neighborhood.color,
            "campus", categoryMeta.campus.color,
            "food", categoryMeta.food.color,
            "#173f3a",
          ],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#fffdf8",
        },
      });
      map.addLayer({
        id: "place-labels",
        type: "symbol",
        source: "places",
        minzoom: 12.3,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 13,
          "text-offset": [0, 1.35],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#17302d",
          "text-halo-color": "rgba(255, 253, 248, 0.95)",
          "text-halo-width": 2,
        },
      });

      map.on("click", "place-points", (event) => {
        const id = event.features?.[0]?.properties?.id as string | undefined;
        const place = placesRef.current.find((item) => item.id === id);
        if (place) focusPlace(place);
      });
      map.on("click", "place-clusters", (event) => {
        const feature = event.features?.[0];
        if (feature?.geometry.type !== "Point") return;
        map.easeTo({
          center: feature.geometry.coordinates as [number, number],
          zoom: Math.min(map.getZoom() + 2.2, 14),
          duration: 650,
        });
      });
      for (const layer of ["place-points", "place-clusters"]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      }

      setMapReady(true);
      const slug = new URL(window.location.href).searchParams.get("place");
      const sharedPlace = placesRef.current.find((place) => place.slug === slug);
      if (sharedPlace) focusPlace(sharedPlace);
    });

    map.on("error", (event) => {
      console.error("Map rendering error", event.error);
      setMapError(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [focusPlace]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("places") as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(filteredPlaces));
  }, [filteredPlaces, mapReady]);

  return (
    <main className="atlas-shell">
      <div ref={containerRef} className="atlas-map" aria-label="武汉城市地点互动地图" />
      <div className="map-wash" aria-hidden="true" />

      <header className="atlas-header">
        <button className="brand" type="button" onClick={() => mapRef.current?.flyTo({ center: WUHAN_CENTER, zoom: 10.9 })}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 44 44"><path d="M5 25c7-8 11-8 17 0s10 8 17 0" /><path d="M5 17c7-8 11-8 17 0s10 8 17 0" /></svg>
          </span>
          <span><strong>江城图志</strong><small>JIANGCHENG ATLAS</small></span>
        </button>
        <Link href="/east-lake" className="mission-link">东湖差事 <span>NEW</span></Link>
        <div className="header-meta">
          <span className="live-dot" /><span>{places.length} 个地点</span><span className="header-divider" />
          <span>{dataSource === "d1" ? "D1 实时数据" : "首批图志"}</span>
        </div>
      </header>

      {!panelOpen && (
        <button className="explorer-restore" type="button" onClick={() => setPanelOpen(true)} aria-controls="wuhan-explorer-panel">
          › 展开图志
        </button>
      )}

      <aside id="wuhan-explorer-panel" className={`explorer-panel ${panelOpen ? "is-open" : ""}`} aria-hidden={!panelOpen}>
        <div className="panel-intro">
          <button className="panel-collapse" type="button" onClick={() => setPanelOpen(false)} aria-label="收起图志浮层">
            <span aria-hidden="true">‹</span> 收起
          </button>
          <p className="eyebrow">WUHAN · 30.59°N</p>
          <h1>沿江穿城，<br />找回武汉的坐标。</h1>
          <p className="intro-copy">从两江四岸到街巷湖山，收录值得抵达、停留与讲述的江城现场。</p>
        </div>

        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索地点、街区或行政区" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">×</button>}
        </label>

        <div className="category-row" role="list" aria-label="地点分类">
          {(Object.keys(categoryMeta) as CategoryFilter[]).map((id) => (
            <button
              key={id}
              type="button"
              className={category === id ? "active" : ""}
              onClick={() => setCategory(id)}
              style={{ "--category-color": categoryMeta[id].color } as React.CSSProperties}
            >
              <span>{categoryMeta[id].icon}</span>{categoryMeta[id].shortLabel}
            </button>
          ))}
        </div>

        <div className="results-heading"><span>{categoryMeta[category].label}</span><b>{filteredPlaces.length.toString().padStart(2, "0")}</b></div>
        <div className="place-list">
          {filteredPlaces.map((place, index) => {
            const meta = categoryMeta[place.categoryId];
            return (
              <button key={place.id} type="button" className={`place-row ${selectedId === place.id ? "selected" : ""}`} onClick={() => focusPlace(place)}>
                <span className="place-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="place-symbol" style={{ background: meta.color }}>{meta.icon}</span>
                <span className="place-copy"><strong>{place.name}</strong><small>{place.district} · {place.subtitle}</small></span>
                <span className="place-arrow">↗</span>
              </button>
            );
          })}
          {filteredPlaces.length === 0 && <div className="empty-state"><span>⌁</span><strong>还没有找到这个坐标</strong><p>换一个关键词，或者浏览其他分类。</p></div>}
        </div>
        <footer className="panel-footer"><span>首期 · 武汉三镇</span><span>持续生长的城市图鉴</span></footer>
      </aside>

      {selectedPlace && (
        <section className="place-detail" aria-live="polite">
          <button className="detail-close" type="button" onClick={clearSelection} aria-label="关闭地点详情">×</button>
          <div
            className={`detail-visual ${selectedPlace.imageUrl ? "has-image" : ""}`}
            style={{
              "--detail-color": categoryMeta[selectedPlace.categoryId].color,
              ...(selectedPlace.imageUrl ? { backgroundImage: `linear-gradient(180deg, transparent 45%, rgba(17, 28, 26, .72)), url(${JSON.stringify(selectedPlace.imageUrl)})` } : {}),
            } as React.CSSProperties}
          >
            <span>{categoryMeta[selectedPlace.categoryId].icon}</span>
            <small>{selectedPlace.latitude.toFixed(4)}°N · {selectedPlace.longitude.toFixed(4)}°E</small>
          </div>
          <div className="detail-body">
            <div className="detail-tags"><span>{categoryMeta[selectedPlace.categoryId].label}</span><span>{selectedPlace.district}</span>{selectedPlace.featured && <span>本期推荐</span>}</div>
            <h2>{selectedPlace.name}</h2><h3>{selectedPlace.subtitle}</h3><p>{selectedPlace.description}</p>
            <div className="detail-address"><span aria-hidden="true">⌖</span><span><small>地址</small>{selectedPlace.address}</span></div>
            <button type="button" className="share-button" onClick={() => navigator.clipboard.writeText(window.location.href)}>复制这个地点的分享链接</button>
          </div>
        </section>
      )}

      {mapError && <div className="map-notice">底图暂时无法加载，请检查网络后刷新。地点资料仍可在左侧浏览。</div>}
      <div className="map-caption"><span>汉口</span><i /><span>武昌</span><i /><span>汉阳</span></div>
    </main>
  );
}
