"use client";

import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommunityAuthModal } from "@/components/community-auth-modal";
import type { ActivityType, CityActivity, CommunityUser } from "@/lib/community-types";
import { categoryMeta, type CategoryFilter, type Place } from "@/lib/places";

const WUHAN_CORE_BOUNDS: [[number, number], [number, number]] = [
  [114.215, 30.472],
  [114.445, 30.662],
];
const WUHAN_MAX_BOUNDS: [[number, number], [number, number]] = [
  [114.15, 30.41],
  [114.51, 30.73],
];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const EVENT_COLOR = "#88b800";

const activityTypeMeta: Record<ActivityType, { label: string; short: string }> = {
  ride: { label: "骑行", short: "骑" },
  walk: { label: "散步 / City Walk", short: "走" },
  sports: { label: "运动", short: "动" },
  food: { label: "吃喝", short: "食" },
  photo: { label: "拍照", short: "拍" },
  other: { label: "其他召集", short: "集" },
};

const SAMPLE_ACTIVITY: CityActivity = {
  id: "east-lake-ride-sample",
  activityType: "ride",
  routeId: null,
  routeName: null,
  routeColor: null,
  title: "周六东湖绿道轻松骑",
  details: "梨园集合，沿湖中道轻松骑行。以看风景、找搭子为主，不拼速度；请自备头盔和饮用水。",
  startsAt: "2026-08-01T00:00:00.000Z",
  meetingName: "东湖绿道梨园入口",
  meetingLongitude: 114.386,
  meetingLatitude: 30.5794,
  capacity: 8,
  pace: null,
  status: "open",
  creator: {
    id: "sample-organizer",
    username: "jiangcheng",
    displayName: "江城图志",
    avatarColor: "#173f3a",
  },
  joinedCount: 1,
  joinedByMe: false,
  isOwner: false,
};

type PlacesResponse = { places: Place[]; source: "d1" | "seed" };
type ActivitiesResponse = { activities: CityActivity[]; user: CommunityUser | null; error?: string };
type MapExplorerProps = { initialPlaces: Place[] };
type ScreenPosition = { x: number; y: number };
type ExplorerCategory = CategoryFilter | "event";
type ActivityDraft = {
  activityType: ActivityType;
  title: string;
  details: string;
  startsAt: string;
  meetingName: string;
  meetingLongitude: number;
  meetingLatitude: number;
  capacity: number;
};
type PendingAction =
  | { kind: "publish"; draft: ActivityDraft }
  | { kind: "join"; activityId: string };

const explorerCategories: { id: ExplorerCategory; label: string; color: string }[] = [
  { id: "all", label: "全部", color: "#49635e" },
  { id: "landmark", label: "地标", color: categoryMeta.landmark.color },
  { id: "nature", label: "自然", color: categoryMeta.nature.color },
  { id: "culture", label: "人文", color: categoryMeta.culture.color },
  { id: "neighborhood", label: "街区", color: categoryMeta.neighborhood.color },
  { id: "campus", label: "高校", color: categoryMeta.campus.color },
  { id: "food", label: "美食", color: categoryMeta.food.color },
  { id: "event", label: "事件", color: EVENT_COLOR },
];

const categoryIconBody: Record<ExplorerCategory, string> = {
  all: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  landmark: '<path d="M5 21V8l7-5 7 5v13M3 21h18M9 21v-7h6v7"/><path d="M8 9h.01M12 9h.01M16 9h.01"/>',
  nature: '<path d="M20 4c-7 0-12 3-14 8-1.4 3.4.2 6.5 3 7.5 3.3 1.2 6.8-.8 8-4.5 1-3 1-7 3-11Z"/><path d="M5 21c3-5 7-8 12-11"/>',
  culture: '<path d="m3 9 9-5 9 5M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M4 18h16M3 21h18"/>',
  neighborhood: '<path d="M3 21V8h8v13M11 21V4h10v17M6 11h2M6 15h2M14 8h2M18 8h1M14 12h2M18 12h1M14 16h2M18 16h1M2 21h20"/>',
  campus: '<path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11v5c3 3 9 3 12 0v-5M22 9v6"/>',
  food: '<path d="M4 13h16c0 4-3.6 7-8 7s-8-3-8-7ZM8 10c-1-1-.8-2.2.2-3.2M12 10c-1-1-.8-2.2.2-3.2M16 10c-1-1-.8-2.2.2-3.2M7 21h10"/>',
  event: '<path d="M6 21V4M7 5h11l-2 4 2 4H7"/>',
};

function CategoryPictogram({ id }: { id: ExplorerCategory }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: categoryIconBody[id] }} />;
}

function markerSvg(id: ExplorerCategory, color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <g transform="translate(12 12) scale(1.67)" fill="none" stroke="rgba(13,23,21,.96)" stroke-width="5.25" stroke-linecap="round" stroke-linejoin="round">${categoryIconBody[id]}</g>
    <g transform="translate(12 12) scale(1.67)" fill="none" stroke="${color}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${categoryIconBody[id]}</g>
  </svg>`;
}

function toPlaceFeatureCollection(places: Place[]) {
  return {
    type: "FeatureCollection" as const,
    features: places.map((place) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.longitude, place.latitude] },
      properties: { id: place.id, name: place.name, categoryId: place.categoryId },
    })),
  };
}

function toActivityFeatureCollection(activities: CityActivity[]) {
  return {
    type: "FeatureCollection" as const,
    features: activities.map((activity) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [activity.meetingLongitude, activity.meetingLatitude],
      },
      properties: { id: activity.id, name: activity.title },
    })),
  };
}

function getCoreMapPadding() {
  return window.matchMedia("(max-width: 760px)").matches
    ? { top: 82, right: 18, bottom: 24, left: 72 }
    : { top: 102, right: 38, bottom: 34, left: 100 };
}

function defaultStartTime() {
  const date = new Date(Date.now() + 24 * 60 * 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "请求失败");
  return result;
}

async function registerMapIcons(map: MapLibreMap) {
  await Promise.all(
    explorerCategories
      .filter((item) => item.id !== "all")
      .map((item) => new Promise<void>((resolve, reject) => {
        const image = new Image(64, 64);
        image.onload = () => {
          const imageId = `category-${item.id}`;
          if (!map.hasImage(imageId)) map.addImage(imageId, image, { pixelRatio: 2 });
          resolve();
        };
        image.onerror = () => reject(new Error(`Unable to load ${item.id} map icon`));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markerSvg(item.id, item.color))}`;
      })),
  );
}

export function MapExplorer({ initialPlaces }: MapExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const placesRef = useRef(initialPlaces);
  const activitiesRef = useRef<CityActivity[]>([SAMPLE_ACTIVITY]);
  const createOpenRef = useRef(false);
  const [places, setPlaces] = useState(initialPlaces);
  const [activities, setActivities] = useState<CityActivity[]>([SAMPLE_ACTIVITY]);
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [detailPosition, setDetailPosition] = useState<ScreenPosition | null>(null);
  const [activeCategory, setActiveCategory] = useState<ExplorerCategory>("all");
  const [categoryListOpen, setCategoryListOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftLocation, setDraftLocation] = useState<[number, number] | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedPlace = useMemo(
    () => places.find((place) => place.id === selectedPlaceId) ?? null,
    [places, selectedPlaceId],
  );
  const selectedActivity = useMemo(
    () => activities.find((activity) => activity.id === selectedActivityId) ?? null,
    [activities, selectedActivityId],
  );
  const categoryPlaces = useMemo(
    () => activeCategory === "all"
      ? places
      : activeCategory === "event"
        ? []
        : places.filter((place) => place.categoryId === activeCategory),
    [activeCategory, places],
  );
  const categoryHasActivities = activeCategory === "all" || activeCategory === "event";
  const categoryActivities = categoryHasActivities ? activities : [];
  const categoryCount = categoryPlaces.length + categoryActivities.length;
  const activeCategoryMeta = explorerCategories.find((item) => item.id === activeCategory) ?? explorerCategories[0];

  const clearSelection = useCallback(() => {
    setSelectedPlaceId(null);
    setSelectedActivityId(null);
    setDetailPosition(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("place");
    url.searchParams.delete("event");
    url.searchParams.delete("mission");
    window.history.replaceState(null, "", url);
  }, []);

  const focusPlace = useCallback((place: Place) => {
    setSelectedActivityId(null);
    setSelectedPlaceId(place.id);
    mapRef.current?.flyTo({
      center: [place.longitude, place.latitude],
      zoom: 14.6,
      duration: 900,
      essential: true,
      offset: [0, 150],
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("event");
    url.searchParams.set("place", place.slug);
    window.history.replaceState(null, "", url);
  }, []);

  const focusActivity = useCallback((activity: CityActivity) => {
    setSelectedPlaceId(null);
    setSelectedActivityId(activity.id);
    mapRef.current?.flyTo({
      center: [activity.meetingLongitude, activity.meetingLatitude],
      zoom: 14.2,
      duration: 900,
      essential: true,
      offset: [0, 145],
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("place");
    url.searchParams.set("event", activity.id);
    window.history.replaceState(null, "", url);
  }, []);

  const refreshActivities = useCallback(async () => {
    try {
      const payload = await jsonRequest<ActivitiesResponse>("/api/activities", { cache: "no-store" });
      const merged = [
        SAMPLE_ACTIVITY,
        ...payload.activities.filter((activity) => activity.id !== SAMPLE_ACTIVITY.id),
      ];
      setActivities(merged);
      setUser(payload.user);
      return merged;
    } catch (error) {
      console.warn("Using the bundled sample activity.", error);
      return activitiesRef.current;
    }
  }, []);

  const resetCoreView = useCallback(() => {
    clearSelection();
    setCreateOpen(false);
    mapRef.current?.fitBounds(WUHAN_CORE_BOUNDS, {
      padding: getCoreMapPadding(),
      maxZoom: 12.15,
      duration: 900,
      essential: true,
    });
  }, [clearSelection]);

  const openCreatePanel = useCallback((location?: [number, number]) => {
    clearSelection();
    setCategoryListOpen(false);
    setActiveCategory("event");
    setDraftLocation(location ?? null);
    setCreateOpen(true);
    setNotice(location ? "已带入示例活动的集合位置，可以继续调整。" : "点击地图，选择差事的集合位置。");
  }, [clearSelection]);

  const publishDraft = useCallback(async (draft: ActivityDraft) => {
    setBusy(true);
    setNotice("");
    try {
      const result = await jsonRequest<{ id: string }>("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const nextActivities = await refreshActivities();
      setCreateOpen(false);
      const created = nextActivities.find((activity) => activity.id === result.id);
      if (created) focusActivity(created);
      setNotice("差事已经发布到地图上。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }, [focusActivity, refreshActivities]);

  const mutateActivity = useCallback(async (activity: CityActivity) => {
    if (activity.id === SAMPLE_ACTIVITY.id) {
      openCreatePanel([activity.meetingLongitude, activity.meetingLatitude]);
      return;
    }
    if (!user) {
      setPendingAction({ kind: "join", activityId: activity.id });
      setAuthOpen(true);
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const path = activity.isOwner ? `/api/activities/${activity.id}` : `/api/activities/${activity.id}/join`;
      const method = activity.isOwner || activity.joinedByMe ? "DELETE" : "POST";
      await jsonRequest(path, { method });
      const nextActivities = await refreshActivities();
      const next = nextActivities.find((item) => item.id === activity.id);
      if (next) focusActivity(next);
      setNotice(activity.isOwner ? "差事已取消。" : activity.joinedByMe ? "已退出这次差事。" : "已加入这次差事。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }, [focusActivity, openCreatePanel, refreshActivities, user]);

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftLocation) {
      setNotice("请先点击地图，选择集合位置。");
      return;
    }
    const form = new FormData(event.currentTarget);
    const startTime = new Date(String(form.get("startsAt"))).getTime();
    if (!Number.isFinite(startTime)) {
      setNotice("请选择有效的开始时间。");
      return;
    }
    const draft: ActivityDraft = {
      activityType: String(form.get("activityType")) as ActivityType,
      title: String(form.get("title") ?? "").trim(),
      details: String(form.get("details") ?? "").trim(),
      startsAt: new Date(startTime).toISOString(),
      meetingName: String(form.get("meetingName") ?? "").trim(),
      meetingLongitude: draftLocation[0],
      meetingLatitude: draftLocation[1],
      capacity: Number(form.get("capacity")),
    };
    if (!user) {
      setPendingAction({ kind: "publish", draft });
      setAuthOpen(true);
      return;
    }
    void publishDraft(draft);
  };

  const completeAuthentication = async (authenticatedUser: CommunityUser) => {
    setUser(authenticatedUser);
    setAuthOpen(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === "publish") {
      await publishDraft(action.draft);
      return;
    }
    const activity = activitiesRef.current.find((item) => item.id === action.activityId);
    if (activity) {
      setBusy(true);
      try {
        await jsonRequest(`/api/activities/${activity.id}/join`, { method: "POST" });
        const nextActivities = await refreshActivities();
        const next = nextActivities.find((item) => item.id === activity.id);
        if (next) focusActivity(next);
        setNotice("已加入这次差事。");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "报名失败");
      } finally {
        setBusy(false);
      }
    }
  };

  const chooseCategory = (categoryId: ExplorerCategory) => {
    if (categoryId === activeCategory) {
      setCategoryListOpen((open) => !open);
      return;
    }
    clearSelection();
    setActiveCategory(categoryId);
    setCategoryListOpen(true);
  };

  useEffect(() => {
    placesRef.current = places;
  }, [places]);

  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);

  useEffect(() => {
    createOpenRef.current = createOpen;
  }, [createOpen]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/places", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Places request failed: ${response.status}`);
        return response.json() as Promise<PlacesResponse>;
      })
      .then((payload) => {
        if (payload.places.length > 0) setPlaces(payload.places);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.warn("Using bundled Wuhan places.", error);
      });
    queueMicrotask(() => void refreshActivities());
    return () => controller.abort();
  }, [refreshActivities]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      bounds: WUHAN_CORE_BOUNDS,
      fitBoundsOptions: { padding: getCoreMapPadding(), maxZoom: 12.15 },
      maxBounds: WUHAN_MAX_BOUNDS,
      minZoom: 10.2,
      maxZoom: 18,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", async () => {
      map.addSource("places", { type: "geojson", data: toPlaceFeatureCollection(placesRef.current) });
      await registerMapIcons(map);
      if (mapRef.current !== map) return;
      map.addLayer({
        id: "place-icons",
        type: "symbol",
        source: "places",
        layout: {
          "icon-image": [
            "match", ["get", "categoryId"],
            "landmark", "category-landmark",
            "nature", "category-nature",
            "culture", "category-culture",
            "neighborhood", "category-neighborhood",
            "campus", "category-campus",
            "food", "category-food",
            "category-landmark",
          ],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.92, 15, 1.28],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-padding": 2,
        },
      });
      map.addLayer({
        id: "place-labels",
        type: "symbol",
        source: "places",
        minzoom: 12.3,
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
      map.addSource("activities", {
        type: "geojson",
        data: toActivityFeatureCollection(activitiesRef.current),
      });
      map.addLayer({
        id: "event-icons",
        type: "symbol",
        source: "activities",
        layout: {
          "icon-image": "category-event",
          "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 1.38],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
      map.on("click", "place-icons", (event) => {
        if (createOpenRef.current) return;
        const id = event.features?.[0]?.properties?.id as string | undefined;
        const place = placesRef.current.find((item) => item.id === id);
        if (place) focusPlace(place);
      });
      map.on("click", "event-icons", (event) => {
        if (createOpenRef.current) return;
        const id = event.features?.[0]?.properties?.id as string | undefined;
        const activity = activitiesRef.current.find((item) => item.id === id);
        if (activity) focusActivity(activity);
      });
      for (const layer of ["place-icons", "event-icons"]) {
        map.on("mouseenter", layer, () => {
          if (!createOpenRef.current) map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          if (!createOpenRef.current) map.getCanvas().style.cursor = "";
        });
      }
      setMapReady(true);
      const pageUrl = new URL(window.location.href);
      const slug = pageUrl.searchParams.get("place");
      const sharedPlace = placesRef.current.find((place) => place.slug === slug);
      if (sharedPlace) focusPlace(sharedPlace);
      const eventId = pageUrl.searchParams.get("event");
      const sharedActivity = activitiesRef.current.find((activity) => activity.id === eventId);
      if (sharedActivity) focusActivity(sharedActivity);
    });
    map.on("error", (event) => {
      console.error("Map rendering error", event.error);
      setMapError(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [focusActivity, focusPlace]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("places") as GeoJSONSource | undefined;
    source?.setData(toPlaceFeatureCollection(categoryPlaces));
  }, [categoryPlaces, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("activities") as GeoJSONSource | undefined;
    source?.setData(toActivityFeatureCollection(activities));
    mapRef.current?.setLayoutProperty("event-icons", "visibility", categoryHasActivities ? "visible" : "none");
  }, [activities, categoryHasActivities, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !createOpen) return;
    const canvas = map.getCanvas();
    const chooseLocation = (event: maplibregl.MapMouseEvent) => {
      setDraftLocation([event.lngLat.lng, event.lngLat.lat]);
      setNotice("集合位置已标记，可以继续填写并发布。");
    };
    canvas.classList.add("map-picking-location");
    canvas.style.cursor = "crosshair";
    map.on("click", chooseLocation);
    return () => {
      map.off("click", chooseLocation);
      canvas.classList.remove("map-picking-location");
      canvas.style.cursor = "";
    };
  }, [createOpen, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const target = selectedPlace
      ? [selectedPlace.longitude, selectedPlace.latitude] as [number, number]
      : selectedActivity
        ? [selectedActivity.meetingLongitude, selectedActivity.meetingLatitude] as [number, number]
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
  }, [mapReady, selectedActivity, selectedPlace]);

  useEffect(() => {
    if (!mapReady || selectedActivityId) return;
    const eventId = new URL(window.location.href).searchParams.get("event");
    const shared = activities.find((activity) => activity.id === eventId);
    if (shared) queueMicrotask(() => focusActivity(shared));
  }, [activities, focusActivity, mapReady, selectedActivityId]);

  return (
    <main className="atlas-shell">
      <div ref={containerRef} className="atlas-map" aria-label="武汉城市地点与活动互动地图" />
      <div className="map-wash" aria-hidden="true" />

      <header className="atlas-header">
        <button className="brand" type="button" onClick={resetCoreView}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 44 44"><path d="M5 25c7-8 11-8 17 0s10 8 17 0" /><path d="M5 17c7-8 11-8 17 0s10 8 17 0" /></svg>
          </span>
          <span><strong>江城图志</strong><small>JIANGCHENG ATLAS</small></span>
        </button>
        <div className="header-actions">
          <button type="button" className="mission-link create-event-link" onClick={() => openCreatePanel()}>
            创建差事 <span>＋</span>
          </button>
        </div>
      </header>

      <aside className="legend-explorer" aria-label="地图分类图例">
        <nav className="legend-rail" aria-label="地图分类">
          <span className="legend-rail-title">图例</span>
          {explorerCategories.map((item) => {
            const count = item.id === "all"
              ? places.length + activities.length
              : item.id === "event"
                ? activities.length
                : places.filter((place) => place.categoryId === item.id).length;
            return (
              <button
                key={item.id}
                type="button"
                className={activeCategory === item.id ? "active" : ""}
                onClick={() => chooseCategory(item.id)}
                aria-pressed={activeCategory === item.id}
                aria-label={`${item.label}，${count} 个`}
                title={`${item.label} · ${count}`}
                style={{ "--legend-color": item.color } as React.CSSProperties}
              >
                <i><CategoryPictogram id={item.id} /></i>
                <span>{item.label}</span>
                <em>{count}</em>
              </button>
            );
          })}
        </nav>

        {categoryListOpen && (
          <section className="legend-list-panel" aria-live="polite">
            <header>
              <div><span>MAP INDEX</span><h2>{activeCategoryMeta.label}</h2></div>
              <b>{categoryCount.toString().padStart(2, "0")}</b>
              <button type="button" onClick={() => setCategoryListOpen(false)} aria-label="关闭分类列表">×</button>
            </header>
            <div className="legend-result-list">
              {categoryActivities.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  className={selectedActivityId === activity.id ? "selected event-row" : "event-row"}
                  onClick={() => {
                    focusActivity(activity);
                    if (window.matchMedia("(max-width: 760px)").matches) setCategoryListOpen(false);
                  }}
                  style={{ "--item-color": EVENT_COLOR } as React.CSSProperties}
                >
                  <i><CategoryPictogram id="event" /></i>
                  <span><strong>{activity.title}</strong><small>{activityTypeMeta[activity.activityType].label} · {dateLabel(activity.startsAt)}</small></span>
                  <em>↗</em>
                </button>
              ))}
              {categoryPlaces.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  className={selectedPlaceId === place.id ? "selected" : ""}
                  onClick={() => {
                    focusPlace(place);
                    if (window.matchMedia("(max-width: 760px)").matches) setCategoryListOpen(false);
                  }}
                  style={{ "--item-color": categoryMeta[place.categoryId].color } as React.CSSProperties}
                >
                  <i><CategoryPictogram id={place.categoryId} /></i>
                  <span><strong>{place.name}</strong><small>{place.district} · {place.subtitle}</small></span>
                  <em>↗</em>
                </button>
              ))}
            </div>
          </section>
        )}
      </aside>

      {createOpen && (
        <section className="create-event-panel" aria-label="创建差事">
          <header>
            <div><span>NEW EVENT</span><h2>在武汉，发起一件事。</h2></div>
            <button type="button" onClick={() => setCreateOpen(false)} aria-label="关闭创建面板">×</button>
          </header>
          <div className={draftLocation ? "create-location picked" : "create-location"}>
            <i><CategoryPictogram id="event" /></i>
            <span>
              <b>{draftLocation ? "集合位置已选择" : "先在地图上点一个集合位置"}</b>
              <small>{draftLocation ? `${draftLocation[1].toFixed(4)}°N · ${draftLocation[0].toFixed(4)}°E` : "地图现在可以直接点击"}</small>
            </span>
          </div>
          <form onSubmit={submitCreate}>
            <div className="create-form-row">
              <label>活动类型<select name="activityType" defaultValue="ride">{Object.entries(activityTypeMeta).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select></label>
              <label>人数上限<input name="capacity" type="number" min={2} max={50} defaultValue={8} required /></label>
            </div>
            <label>差事标题<input name="title" minLength={4} maxLength={48} placeholder="例如：周六东湖绿道轻松骑" required /></label>
            <label>开始时间<input name="startsAt" type="datetime-local" defaultValue={defaultStartTime()} required /></label>
            <label>集合地点<input name="meetingName" minLength={2} maxLength={80} placeholder="例如：东湖绿道梨园入口" required /></label>
            <label>活动详情<textarea name="details" minLength={10} maxLength={600} placeholder="行程安排、适合人群、需要携带什么、注意事项……" required /></label>
            <button type="submit" className="create-submit" disabled={busy}>{busy ? "正在发布…" : user ? "发布到地图" : "继续发布"}</button>
            <small className="create-identity-note">{user ? `将以「${user.displayName}」发布` : "可以先填完全部内容，真正发布时再确认身份。"}</small>
          </form>
        </section>
      )}

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
            <span><CategoryPictogram id={selectedPlace.categoryId} /></span>
            {selectedPlace.imageSourceUrl && (
              <a className="detail-photo-credit" href={selectedPlace.imageSourceUrl} target="_blank" rel="noreferrer">
                图片：{selectedPlace.imageCredit ?? "Wikimedia Commons"} ↗
              </a>
            )}
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

      {selectedActivity && detailPosition && (
        <section className="place-detail event-detail" aria-live="polite" style={{ left: detailPosition.x, top: detailPosition.y }}>
          <button className="detail-close" type="button" onClick={clearSelection} aria-label="关闭差事详情">×</button>
          <div className="mission-visual">
            <span>EVENT · {activityTypeMeta[selectedActivity.activityType].label}</span>
            <b>{activityTypeMeta[selectedActivity.activityType].short}</b>
            <small>{selectedActivity.status === "open" ? "正在召集" : "已结束"}</small>
          </div>
          <div className="detail-body">
            <div className="detail-tags"><span>差事</span><span>{activityTypeMeta[selectedActivity.activityType].label}</span><span>{dateLabel(selectedActivity.startsAt)}</span></div>
            <h2>{selectedActivity.title}</h2>
            <h3>集合 · {selectedActivity.meetingName}</h3>
            <p>{selectedActivity.details}</p>
            <div className="event-facts">
              <span><small>时间</small>{dateLabel(selectedActivity.startsAt)}</span>
              <span><small>队伍</small>{selectedActivity.joinedCount} / {selectedActivity.capacity} 人</span>
            </div>
            <div className="event-owner">
              <i style={{ background: selectedActivity.creator.avatarColor }}>{selectedActivity.creator.displayName.slice(0, 1)}</i>
              <span><small>发起人</small>{selectedActivity.creator.displayName}</span>
            </div>
            {selectedActivity.status === "open" && (
              <button
                type="button"
                className="share-button event-action"
                disabled={busy || (
                  selectedActivity.id !== SAMPLE_ACTIVITY.id
                  && !selectedActivity.isOwner
                  && !selectedActivity.joinedByMe
                  && selectedActivity.joinedCount >= selectedActivity.capacity
                )}
                onClick={() => void mutateActivity(selectedActivity)}
              >
                {selectedActivity.id === SAMPLE_ACTIVITY.id
                  ? "创建一个类似差事"
                  : selectedActivity.isOwner
                    ? "取消这个差事"
                    : selectedActivity.joinedByMe
                      ? "退出这次差事"
                      : selectedActivity.joinedCount >= selectedActivity.capacity
                        ? "队伍已满"
                        : "报名参加"}
              </button>
            )}
          </div>
        </section>
      )}

      {authOpen && (
        <CommunityAuthModal
          onClose={() => { setAuthOpen(false); setPendingAction(null); }}
          onAuthenticated={completeAuthentication}
        />
      )}
      {notice && <button type="button" className="map-notice map-toast" onClick={() => setNotice("")}>{notice} ×</button>}
      {mapError && <div className="map-notice">底图暂时无法加载，请检查网络后刷新。</div>}
      <div className="map-caption"><span>汉口</span><i /><span>武昌</span><i /><span>汉阳</span></div>
    </main>
  );
}
