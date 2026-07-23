"use client";

import Link from "next/link";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { categoryMeta, type Place } from "@/lib/places";

const WUHAN_CENTER: [number, number] = [114.3055, 30.5928];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const EAST_LAKE_MISSION = {
  id: "east-lake-mission",
  name: "东湖骑行差事",
  subtitle: "找搭子、看路线攻略、约一次同行",
  description: "这里先做活动组织与路线攻略，不记录骑行轨迹，也不提供实时导航。",
  longitude: 114.386,
  latitude: 30.5594,
};

function toFeatureCollection(places: Place[]) {
  return {
    type: "FeatureCollection" as const,
    features: places.map((place) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [place.longitude, place.latitude],
      },
      properties: {
        id: place.id,
        name: place.name,
        categoryId: place.categoryId,
        icon: categoryMeta[place.categoryId].icon,
      },
    })),
  };
}

type ApiResponse = { places: Place[]; source: "d1" | "seed" };
type MapExplorerProps = { initialPlaces: Place[] };
type ScreenPosition = { x: number; y: number };

export function MapExplorer({ initialPlaces }: MapExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const placesRef = useRef(initialPlaces);
  const [places, setPlaces] = useState(initialPlaces);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [missionSelected, setMissionSelected] = useState(false);
  const [detailPosition, setDetailPosition] = useState<ScreenPosition | null>(null);
  const [showPlaces, setShowPlaces] = useState(true);
  const [showMissions, setShowMissions] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [dataSource, setDataSource] = useState<"d1" | "seed">("seed");

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedId) ?? null,
    [places, selectedId],
  );

  const focusPlace = useCallback((place: Place) => {
    setMissionSelected(false);
    setSelectedId(place.id);
    mapRef.current?.flyTo({
      center: [place.longitude, place.latitude],
      zoom: 14.6,
      duration: 1100,
      essential: true,
      offset: [0, 150],
    });

    const url = new URL(window.location.href);
    url.searchParams.set("place", place.slug);
    window.history.replaceState(null, "", url);
  }, []);

  const focusMission = useCallback(() => {
    setSelectedId(null);
    setMissionSelected(true);
    mapRef.current?.flyTo({
      center: [EAST_LAKE_MISSION.longitude, EAST_LAKE_MISSION.latitude],
      zoom: 14.2,
      duration: 1100,
      essential: true,
      offset: [0, 135],
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("place");
    url.searchParams.set("mission", "east-lake");
    window.history.replaceState(null, "", url);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setMissionSelected(false);
    setDetailPosition(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("place");
    url.searchParams.delete("mission");
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
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 15, 14],
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
        id: "place-icons",
        type: "symbol",
        source: "places",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "icon"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 8, 15, 11],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#17302d" },
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

      map.addSource("missions", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [EAST_LAKE_MISSION.longitude, EAST_LAKE_MISSION.latitude],
            },
            properties: { id: EAST_LAKE_MISSION.id, name: EAST_LAKE_MISSION.name },
          }],
        },
      });
      map.addLayer({
        id: "mission-halo",
        type: "circle",
        source: "missions",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 16, 15, 22],
          "circle-color": "rgba(216, 255, 62, .26)",
          "circle-blur": 0.25,
        },
      });
      map.addLayer({
        id: "mission-points",
        type: "circle",
        source: "missions",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 11, 15, 16],
          "circle-color": "#173f3a",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#d8ff3e",
        },
      });
      map.addLayer({
        id: "mission-icons",
        type: "symbol",
        source: "missions",
        layout: {
          "text-field": "!",
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 13, 15, 18],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.on("click", "place-points", (event) => {
        const id = event.features?.[0]?.properties?.id as string | undefined;
        const place = placesRef.current.find((item) => item.id === id);
        if (place) focusPlace(place);
      });
      map.on("click", "place-icons", (event) => {
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
      for (const layer of ["mission-points", "mission-icons"]) {
        map.on("click", layer, focusMission);
      }
      for (const layer of ["place-points", "place-icons", "place-clusters", "mission-points", "mission-icons"]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      }

      setMapReady(true);
      const pageUrl = new URL(window.location.href);
      const slug = pageUrl.searchParams.get("place");
      const sharedPlace = placesRef.current.find((place) => place.slug === slug);
      if (sharedPlace) focusPlace(sharedPlace);
      if (pageUrl.searchParams.get("mission") === "east-lake") focusMission();
    });

    map.on("error", (event) => {
      console.error("Map rendering error", event.error);
      setMapError(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [focusMission, focusPlace]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("places") as GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(showPlaces ? places : []));
  }, [mapReady, places, showPlaces]);

  useEffect(() => {
    if (!mapReady) return;
    const visibility = showMissions ? "visible" : "none";
    for (const layer of ["mission-halo", "mission-points", "mission-icons"]) {
      mapRef.current?.setLayoutProperty(layer, "visibility", visibility);
    }
  }, [mapReady, showMissions]);

  useEffect(() => {
    const map = mapRef.current;
    const target = selectedPlace
      ? [selectedPlace.longitude, selectedPlace.latitude] as [number, number]
      : missionSelected
        ? [EAST_LAKE_MISSION.longitude, EAST_LAKE_MISSION.latitude] as [number, number]
        : null;
    if (!map || !mapReady || !target) {
      setDetailPosition(null);
      return;
    }

    const updatePosition = () => {
      const point = map.project(target);
      setDetailPosition({ x: point.x, y: point.y });
    };
    updatePosition();
    map.on("move", updatePosition);
    map.on("resize", updatePosition);
    return () => {
      map.off("move", updatePosition);
      map.off("resize", updatePosition);
    };
  }, [mapReady, missionSelected, selectedPlace]);

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

      <aside className="map-legend" aria-label="地图图例">
        <div className="legend-heading"><span>MAP LEGEND</span><strong>地图图例</strong></div>
        <button type="button" className={showPlaces ? "active" : ""} onClick={() => setShowPlaces((visible) => !visible)}>
          <i className="legend-place">景</i><span><b>景点</b><small>{places.length} 个城市坐标</small></span><em>{showPlaces ? "显示" : "隐藏"}</em>
        </button>
        <button
          type="button"
          className={showMissions ? "active" : ""}
          onClick={() => {
            if (showMissions && missionSelected) clearSelection();
            setShowMissions((visible) => !visible);
          }}
        >
          <i className="legend-mission">!</i><span><b>差事</b><small>攻略与同城活动</small></span><em>{showMissions ? "显示" : "隐藏"}</em>
        </button>
      </aside>

      {selectedPlace && detailPosition && (
        <section className="place-detail" aria-live="polite" style={{ left: detailPosition.x, top: detailPosition.y }}>
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

      {missionSelected && detailPosition && (
        <section className="place-detail mission-detail" aria-live="polite" style={{ left: detailPosition.x, top: detailPosition.y }}>
          <button className="detail-close" type="button" onClick={clearSelection} aria-label="关闭差事详情">×</button>
          <div className="mission-visual"><span>MISSION · 001</span><b>!</b><small>东湖差事据点</small></div>
          <div className="detail-body">
            <div className="detail-tags"><span>差事</span><span>骑行搭子</span><span>路线攻略</span></div>
            <h2>{EAST_LAKE_MISSION.name}</h2>
            <h3>{EAST_LAKE_MISSION.subtitle}</h3>
            <p>{EAST_LAKE_MISSION.description}</p>
            <Link className="share-button mission-cta" href="/east-lake">查看东湖差事与攻略</Link>
          </div>
        </section>
      )}

      {mapError && <div className="map-notice">底图暂时无法加载，请检查网络后刷新。</div>}
      <div className="map-caption"><span>汉口</span><i /><span>武昌</span><i /><span>汉阳</span></div>
    </main>
  );
}
