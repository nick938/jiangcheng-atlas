"use client";

import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommunityAuthModal } from "@/components/community-auth-modal";
import { MyActivitiesPanel } from "@/components/my-activities-panel";
import { ActivityDiscussion } from "@/components/activity-discussion";
import { EditActivityPanel } from "@/components/edit-activity-panel";
import { NotificationsPanel } from "@/components/notifications-panel";
import { ProfilePanel } from "@/components/profile-panel";
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
const MAP_VIEW_STORAGE_KEY = "jiangcheng-atlas-map-view";
const MAP_3D_CAMERA = { pitch: 52, bearing: -18 } as const;
const MAP_2D_CAMERA = { pitch: 0, bearing: 0 } as const;

const activityTypeMeta: Record<ActivityType, { label: string; short: string }> = {
  ride: { label: "骑行", short: "骑" },
  walk: { label: "散步 / City Walk", short: "走" },
  sports: { label: "运动", short: "动" },
  food: { label: "吃喝", short: "食" },
  photo: { label: "拍照", short: "拍" },
  other: { label: "其他召集", short: "集" },
};

type PlacesResponse = { places: Place[]; source: "d1" | "seed" };
type ActivitiesResponse = {
  activities: CityActivity[];
  myActivities: CityActivity[];
  user: CommunityUser | null;
  error?: string;
};
type MapExplorerProps = { initialPlaces: Place[] };
type ScreenPosition = { x: number; y: number };
type ExplorerCategory = CategoryFilter | "event";
type MapViewMode = "2d" | "3d";
type ActivityDraft = {
  activityType: ActivityType;
  title: string;
  details: string;
  startsAt: string;
  endsAt: string;
  meetingName: string;
  meetingLongitude: number;
  meetingLatitude: number;
  capacity: number;
  image: File | null;
};
type PendingAction =
  | { kind: "publish"; draft: ActivityDraft }
  | { kind: "join"; activityId: string }
  | { kind: "mine" };

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
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g className="pictogram-outline" dangerouslySetInnerHTML={{ __html: categoryIconBody[id] }} />
      <g className="pictogram-color" dangerouslySetInnerHTML={{ __html: categoryIconBody[id] }} />
    </svg>
  );
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

function toDraftLocationFeatureCollection(location: [number, number] | null) {
  return {
    type: "FeatureCollection" as const,
    features: location ? [{
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: location },
      properties: { kind: "draft-location" },
    }] : [],
  };
}

function baiduNavigationUrl(activity: CityActivity) {
  const query = new URLSearchParams({
    origin: "我的位置",
    destination: `latlng:${activity.meetingLatitude},${activity.meetingLongitude}|name:${activity.meetingName}`,
    mode: "driving",
    region: "武汉",
    coord_type: "wgs84",
    output: "html",
    src: "webapp.jiangcheng.atlas",
  });
  return `https://api.map.baidu.com/direction?${query}`;
}

function amapLocationUrl(activity: CityActivity) {
  const query = new URLSearchParams({
    position: `${activity.meetingLongitude},${activity.meetingLatitude}`,
    name: activity.meetingName,
    coordinate: "wgs84",
    callnative: "1",
    src: "jiangcheng-atlas",
  });
  return `https://uri.amap.com/marker?${query}`;
}

function getCoreMapPadding() {
  return window.matchMedia("(max-width: 760px)").matches
    ? { top: 82, right: 18, bottom: 24, left: 72 }
    : { top: 102, right: 38, bottom: 34, left: 100 };
}

function getStoredMapView(): MapViewMode {
  try {
    return window.localStorage.getItem(MAP_VIEW_STORAGE_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

function storeMapView(mode: MapViewMode) {
  try {
    window.localStorage.setItem(MAP_VIEW_STORAGE_KEY, mode);
  } catch {
    // The camera toggle still works when storage is unavailable.
  }
}

function defaultDateTime(offsetHours: number) {
  const date = new Date(Date.now() + offsetHours * 60 * 60_000);
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

function dateRangeLabel(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  const endLabel = new Intl.DateTimeFormat("zh-CN", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }
  ).format(end);
  return `${dateLabel(startsAt)} – ${endLabel}`;
}

function activityStatusLabel(activity: CityActivity, currentTime: number) {
  if (activity.status === "cancelled") return "已取消";
  if (activity.status === "completed") return "已完成";
  if (new Date(activity.endsAt).getTime() <= currentTime) return "已结束";
  if (new Date(activity.startsAt).getTime() <= currentTime) return "进行中";
  if (activity.joinedCount >= activity.capacity) return "已满员";
  return "正在召集";
}

function formString(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
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
  const activitiesRef = useRef<CityActivity[]>([]);
  const createOpenRef = useRef(false);
  const [currentTime] = useState(() => Date.now());
  const [places, setPlaces] = useState(initialPlaces);
  const [activities, setActivities] = useState<CityActivity[]>([]);
  const [myActivities, setMyActivities] = useState<CityActivity[]>([]);
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [detailPosition, setDetailPosition] = useState<ScreenPosition | null>(null);
  const [activeCategory, setActiveCategory] = useState<ExplorerCategory>("all");
  const [categoryListOpen, setCategoryListOpen] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [myActivitiesOpen, setMyActivitiesOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<CityActivity | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>("3d");
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
    () => activities.find((activity) => activity.id === selectedActivityId)
      ?? myActivities.find((activity) => activity.id === selectedActivityId)
      ?? null,
    [activities, myActivities, selectedActivityId],
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
  const draftLocationDescription = useMemo(() => {
    if (!draftLocation) return "地图现在可以直接点击";
    const nearest = places.reduce<{ place: Place; distance: number } | null>((result, place) => {
      const distance = Math.hypot(
        (place.longitude - draftLocation[0]) * Math.cos(draftLocation[1] * Math.PI / 180),
        place.latitude - draftLocation[1],
      );
      return !result || distance < result.distance ? { place, distance } : result;
    }, null);
    return nearest && nearest.distance < 0.025
      ? `靠近 ${nearest.place.name} · 点击地图可调整`
      : "集合旗标已显示在地图上 · 点击地图可调整";
  }, [draftLocation, places]);

  const switchMapView = useCallback((mode: MapViewMode) => {
    setMapViewMode(mode);
    storeMapView(mode);
    const camera = mode === "3d" ? MAP_3D_CAMERA : MAP_2D_CAMERA;
    mapRef.current?.easeTo({
      ...camera,
      duration: 650,
      essential: true,
    });
  }, []);

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
      setActivities(payload.activities);
      setMyActivities(payload.myActivities);
      setUser(payload.user);
      return payload.activities;
    } catch (error) {
      console.warn("Unable to refresh activities.", error);
      return activitiesRef.current;
    }
  }, []);

  const resetCoreView = useCallback(() => {
    clearSelection();
    setCreateOpen(false);
    setMyActivitiesOpen(false);
    setAccountMenuOpen(false);
    const camera = mapViewMode === "3d" ? MAP_3D_CAMERA : MAP_2D_CAMERA;
    mapRef.current?.fitBounds(WUHAN_CORE_BOUNDS, {
      ...camera,
      padding: getCoreMapPadding(),
      maxZoom: 12.15,
      duration: 900,
      essential: true,
    });
  }, [clearSelection, mapViewMode]);

  const openCreatePanel = useCallback((location?: [number, number]) => {
    clearSelection();
    setCategoryListOpen(false);
    setMyActivitiesOpen(false);
    setAccountMenuOpen(false);
    setActiveCategory("event");
    setDraftLocation(location ?? null);
    setCreateOpen(true);
    setNotice(location ? "已带入集合位置，可以继续调整。" : "点击地图，选择差事的集合位置。");
  }, [clearSelection]);

  const publishDraft = useCallback(async (draft: ActivityDraft) => {
    setBusy(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("activityType", draft.activityType);
      form.set("title", draft.title);
      form.set("details", draft.details);
      form.set("startsAt", draft.startsAt);
      form.set("endsAt", draft.endsAt);
      form.set("meetingName", draft.meetingName);
      form.set("meetingLongitude", String(draft.meetingLongitude));
      form.set("meetingLatitude", String(draft.meetingLatitude));
      form.set("capacity", String(draft.capacity));
      if (draft.image) form.set("image", draft.image);
      const result = await jsonRequest<{ id: string }>("/api/activities", {
        method: "POST",
        body: form,
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
    if (!user) {
      setPendingAction({ kind: "join", activityId: activity.id });
      setAuthOpen(true);
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const method = activity.joinedByMe ? "DELETE" : "POST";
      await jsonRequest(`/api/activities/${activity.id}/join`, { method });
      const nextActivities = await refreshActivities();
      const next = nextActivities.find((item) => item.id === activity.id);
      if (next) focusActivity(next);
      setNotice(activity.joinedByMe ? "已退出这次差事。" : "已加入这次差事。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }, [focusActivity, refreshActivities, user]);

  const updateActivityStatus = useCallback(async (activity: CityActivity, action: "complete" | "cancel") => {
    const prompt = action === "complete"
      ? `确认将「${activity.title}」标记为已完成？`
      : `确认取消「${activity.title}」？参加者仍能在历史记录中看到它。`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setNotice("");
    try {
      await jsonRequest(`/api/activities/${activity.id}`, { method: action === "complete" ? "PATCH" : "DELETE" });
      await refreshActivities();
      clearSelection();
      setNotice(action === "complete" ? "差事已完成，已收进历史记录。" : "差事已取消，已收进历史记录。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "状态更新失败");
    } finally {
      setBusy(false);
    }
  }, [clearSelection, refreshActivities]);

  const openMyActivities = () => {
    clearSelection();
    setCreateOpen(false);
    setNotificationsOpen(false);
    setCategoryListOpen(false);
    setAccountMenuOpen(false);
    if (!user) {
      setPendingAction({ kind: "mine" });
      setAuthOpen(true);
      return;
    }
    setMyActivitiesOpen(true);
  };

  const logout = async () => {
    setBusy(true);
    setNotice("");
    try {
      await jsonRequest<{ user: null }>("/api/auth/session", { method: "DELETE" });
      setUser(null);
      setMyActivities([]);
      setMyActivitiesOpen(false);
      setNotificationsOpen(false);
      setAccountMenuOpen(false);
      clearSelection();
      setNotice("已退出登录。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "退出登录失败");
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftLocation) {
      setNotice("请先点击地图，选择集合位置。");
      return;
    }
    const form = new FormData(event.currentTarget);
    const startTime = new Date(formString(form, "startsAt")).getTime();
    const endTime = new Date(formString(form, "endsAt")).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime + 15 * 60_000) {
      setNotice("结束时间至少要比开始时间晚 15 分钟。");
      return;
    }
    if (endTime > startTime + 7 * 86400_000) {
      setNotice("单次差事的时间跨度不能超过 7 天。");
      return;
    }
    const imageValue = form.get("image");
    const image = imageValue instanceof File && imageValue.size > 0 ? imageValue : null;
    if (image && (image.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(image.type))) {
      setNotice("封面仅支持 5 MB 内的 JPEG、PNG、WebP 或 AVIF。");
      return;
    }
    const draft: ActivityDraft = {
      activityType: formString(form, "activityType") as ActivityType,
      title: formString(form, "title").trim(),
      details: formString(form, "details").trim(),
      startsAt: new Date(startTime).toISOString(),
      endsAt: new Date(endTime).toISOString(),
      meetingName: formString(form, "meetingName").trim(),
      meetingLongitude: draftLocation[0],
      meetingLatitude: draftLocation[1],
      capacity: Number(form.get("capacity")),
      image,
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
    setAccountMenuOpen(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === "mine") {
      await refreshActivities();
      setMyActivitiesOpen(true);
      return;
    }
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
    const url = new URL(window.location.href);
    const category = url.searchParams.get("category");
    if (category && explorerCategories.some((item) => item.id === category)) {
      setActiveCategory(category as ExplorerCategory);
      setCategoryListOpen(true);
    }
    const wechat = url.searchParams.get("wechat");
    if (wechat) {
      const messages: Record<string, string> = {
        success: "微信登录成功。",
        unavailable: "微信登录尚未配置开放平台凭证。",
        invalid: "微信登录校验失败，请重新扫码。",
        failed: "微信登录失败，请稍后重试。",
        suspended: "该微信账号关联的社区身份已被停用。",
      };
      setNotice(messages[wechat] ?? "微信登录未完成。");
      url.searchParams.delete("wechat");
      window.history.replaceState(null, "", url);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialMapView = getStoredMapView();
    const initialCamera = initialMapView === "3d" ? MAP_3D_CAMERA : MAP_2D_CAMERA;
    setMapViewMode(initialMapView);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      bounds: WUHAN_CORE_BOUNDS,
      fitBoundsOptions: {
        ...initialCamera,
        padding: getCoreMapPadding(),
        maxZoom: 12.15,
      },
      ...initialCamera,
      maxBounds: WUHAN_MAX_BOUNDS,
      minZoom: 10.2,
      maxZoom: 18,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
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
      map.addSource("draft-location", {
        type: "geojson",
        data: toDraftLocationFeatureCollection(null),
      });
      map.addLayer({
        id: "draft-location-halo",
        type: "circle",
        source: "draft-location",
        paint: {
          "circle-radius": 23,
          "circle-color": "rgba(216, 255, 62, .34)",
          "circle-stroke-color": "#101816",
          "circle-stroke-width": 3,
        },
      });
      map.addLayer({
        id: "draft-location-icon",
        type: "symbol",
        source: "draft-location",
        layout: {
          "icon-image": "category-event",
          "icon-size": 1.62,
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
    const visibleActivities = selectedActivity && !activities.some((activity) => activity.id === selectedActivity.id)
      ? [...activities, selectedActivity]
      : activities;
    source?.setData(toActivityFeatureCollection(visibleActivities));
    const map = mapRef.current;
    if (map?.getLayer("event-icons")) {
      map.setLayoutProperty("event-icons", "visibility", categoryHasActivities ? "visible" : "none");
    }
  }, [activities, categoryHasActivities, mapReady, selectedActivity]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current?.getSource("draft-location") as GeoJSONSource | undefined;
    source?.setData(toDraftLocationFeatureCollection(createOpen ? draftLocation : null));
  }, [createOpen, draftLocation, mapReady]);

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
          {user ? (
            <div className="account-shell">
              <button
                type="button"
                className="account-trigger"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                <i style={{ background: user.avatarColor }}>{user.displayName.slice(0, 1)}</i>
                <span><small>已登录</small><strong>{user.displayName}</strong></span>
                <b aria-hidden="true">⌄</b>
              </button>
              {accountMenuOpen && (
                <div className="account-menu" role="menu">
                  <button type="button" role="menuitem" onClick={openMyActivities}>
                    <span><strong>我的差事</strong><small>进行中与历史记录</small></span>
                    <em>{myActivities.length}</em>
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setProfileOpen(true); }}>
                    <span><strong>个人资料</strong><small>修改昵称或注销账号</small></span>
                    <em>↗</em>
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setMyActivitiesOpen(false); setNotificationsOpen(true); }}>
                    <span><strong>消息中心</strong><small>活动更新、留言与报名提醒</small></span>
                    <em>↗</em>
                  </button>
                  <button type="button" role="menuitem" className="account-logout" disabled={busy} onClick={() => void logout()}>
                    <span><strong>退出登录</strong><small>下次需要时再登录</small></span>
                    <em>↗</em>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="mission-link account-login"
              onClick={() => {
                setPendingAction(null);
                setAccountMenuOpen(false);
                setAuthOpen(true);
              }}
            >
              登录 / 注册
            </button>
          )}
          <button type="button" className="mission-link create-event-link" onClick={() => openCreatePanel()}>
            创建差事 <span>＋</span>
          </button>
        </div>
      </header>

      <aside className="legend-explorer" aria-label="地图分类图例">
        <nav className="legend-rail" aria-label="地图分类">
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
                  <span><strong>{activity.title}</strong><small>{activityTypeMeta[activity.activityType].label} · {dateRangeLabel(activity.startsAt, activity.endsAt)}</small></span>
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
              <small>{draftLocationDescription}</small>
            </span>
          </div>
          <form onSubmit={submitCreate}>
            <div className="create-form-row">
              <label>活动类型<select name="activityType" defaultValue="ride">{Object.entries(activityTypeMeta).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select></label>
              <label>人数上限<input name="capacity" type="number" min={2} max={50} defaultValue={8} required /></label>
            </div>
            <label>差事标题<input name="title" minLength={4} maxLength={48} placeholder="例如：周六东湖绿道轻松骑" required /></label>
            <div className="create-form-row create-time-row">
              <label>开始时间<input name="startsAt" type="datetime-local" defaultValue={defaultDateTime(24)} required /></label>
              <label>结束时间<input name="endsAt" type="datetime-local" defaultValue={defaultDateTime(26)} required /></label>
            </div>
            <label>集合地点<input name="meetingName" minLength={2} maxLength={80} placeholder="例如：东湖绿道梨园入口" required /></label>
            <label className="create-image-upload">
              差事封面
              <span>上传一张现场或路线图片，让参加者更快认出活动</span>
              <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" />
              <small>支持 JPEG、PNG、WebP、AVIF，最大 5 MB</small>
            </label>
            <label>活动详情<textarea name="details" minLength={10} maxLength={600} placeholder="行程安排、适合人群、需要携带什么、注意事项……" required /></label>
            <button type="submit" className="create-submit" disabled={busy}>{busy ? "正在发布…" : user ? "发布到地图" : "继续发布"}</button>
            <small className="create-identity-note">{user ? `将以「${user.displayName}」发布` : "可以先填完全部内容，真正发布时再确认身份。"}</small>
          </form>
        </section>
      )}

      {myActivitiesOpen && user && (
        <MyActivitiesPanel
          user={user}
          activities={myActivities}
          busy={busy}
          onClose={() => setMyActivitiesOpen(false)}
          onSelect={(activity) => {
            setMyActivitiesOpen(false);
            setActiveCategory("event");
            focusActivity(activity);
          }}
          onComplete={(activity) => void updateActivityStatus(activity, "complete")}
          onCancel={(activity) => void updateActivityStatus(activity, "cancel")}
        />
      )}

      {notificationsOpen && user && <NotificationsPanel
        onClose={() => setNotificationsOpen(false)}
        onSelectActivity={(id) => {
          const activity = activities.find((item) => item.id === id) ?? myActivities.find((item) => item.id === id);
          if (activity) { setNotificationsOpen(false); focusActivity(activity); }
        }}
      />}

      {editingActivity && <EditActivityPanel
        activity={editingActivity}
        onClose={() => setEditingActivity(null)}
        onSaved={async () => { await refreshActivities(); }}
        onNotice={setNotice}
      />}

      {profileOpen && user && <ProfilePanel
        user={user}
        onClose={() => setProfileOpen(false)}
        onUpdated={setUser}
        onDeleted={() => { setUser(null); setMyActivities([]); setProfileOpen(false); clearSelection(); }}
        onNotice={setNotice}
      />}

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
          <div
            className={`mission-visual ${selectedActivity.imageUrl ? "has-image" : ""}`}
            style={selectedActivity.imageUrl ? {
              backgroundImage: `linear-gradient(180deg, rgba(11, 28, 25, .08), rgba(11, 28, 25, .74)), url(${JSON.stringify(selectedActivity.imageUrl)})`,
            } : undefined}
          >
            <span>EVENT · {activityTypeMeta[selectedActivity.activityType].label}</span>
            <b>{activityTypeMeta[selectedActivity.activityType].short}</b>
            <small>{activityStatusLabel(selectedActivity, currentTime)}</small>
          </div>
          <div className="detail-body">
            <div className="detail-tags"><span>差事</span><span>{activityTypeMeta[selectedActivity.activityType].label}</span><span>{dateRangeLabel(selectedActivity.startsAt, selectedActivity.endsAt)}</span></div>
            <h2>{selectedActivity.title}</h2>
            <h3>集合 · {selectedActivity.meetingName}</h3>
            <p>{selectedActivity.details}</p>
            <div className="event-facts">
              <span><small>时间段</small>{dateRangeLabel(selectedActivity.startsAt, selectedActivity.endsAt)}</span>
              <span><small>队伍</small>{selectedActivity.joinedCount} / {selectedActivity.capacity} 人</span>
            </div>
            <div className="event-navigation" aria-label="集合地点导航">
              <a href={baiduNavigationUrl(selectedActivity)} target="_blank" rel="noreferrer">百度导航</a>
              <a href={amapLocationUrl(selectedActivity)} target="_blank" rel="noreferrer">高德地图</a>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    setNotice("差事分享链接已复制。");
                  } catch {
                    setNotice("复制失败，请从浏览器地址栏复制链接。");
                  }
                }}
              >
                复制分享链接
              </button>
            </div>
            <div className="event-owner">
              <i style={{ background: selectedActivity.creator.avatarColor }}>{selectedActivity.creator.displayName.slice(0, 1)}</i>
              <span><small>发起人</small>{selectedActivity.creator.displayName}</span>
            </div>
            {selectedActivity.status === "open" && new Date(selectedActivity.endsAt).getTime() > currentTime && (
              selectedActivity.isOwner ? (
                <div className="event-owner-actions">
                  {new Date(selectedActivity.startsAt).getTime() > currentTime && <button type="button" disabled={busy} onClick={() => setEditingActivity(selectedActivity)}>编辑活动</button>}
                  <button type="button" disabled={busy} onClick={() => void updateActivityStatus(selectedActivity, "complete")}>标记完成</button>
                  <button type="button" className="danger" disabled={busy} onClick={() => void updateActivityStatus(selectedActivity, "cancel")}>取消差事</button>
                </div>
              ) : (
              <button
                type="button"
                className="share-button event-action"
                disabled={busy || (
                  !selectedActivity.isOwner
                  && (
                    new Date(selectedActivity.startsAt).getTime() <= currentTime
                    || (!selectedActivity.joinedByMe && selectedActivity.joinedCount >= selectedActivity.capacity)
                  )
                )}
                onClick={() => void mutateActivity(selectedActivity)}
              >
                {selectedActivity.isOwner
                      ? "取消这个差事"
                    : new Date(selectedActivity.startsAt).getTime() <= currentTime
                      ? "活动进行中"
                    : selectedActivity.joinedByMe
                      ? "退出这次差事"
                      : selectedActivity.joinedCount >= selectedActivity.capacity
                        ? "队伍已满"
                      : "报名参加"}
              </button>
              )
            )}
            <ActivityDiscussion
              activity={selectedActivity}
              user={user}
              onRequireAuth={() => { setPendingAction(null); setAuthOpen(true); }}
              onNotice={setNotice}
              onChanged={refreshActivities}
            />
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
      <div className="map-view-switch" role="group" aria-label="地图视角">
        <span>视角</span>
        <button
          type="button"
          className={mapViewMode === "3d" ? "active" : ""}
          aria-pressed={mapViewMode === "3d"}
          onClick={() => switchMapView("3d")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
            <path d="m4 7.5 8 4.5 8-4.5M4 12l8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
          </svg>
          3D
        </button>
        <button
          type="button"
          className={mapViewMode === "2d" ? "active" : ""}
          aria-pressed={mapViewMode === "2d"}
          onClick={() => switchMapView("2d")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
          2D
        </button>
      </div>
    </main>
  );
}
