"use client";

import Link from "next/link";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommunitySnapshot, CyclingRoute, RideActivity } from "@/lib/community-types";
import styles from "./east-lake-hub.module.css";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const difficulty = { easy: "轻松", medium: "适中", hard: "进阶" } as const;
const paceNames = { relaxed: "休闲观景", steady: "稳定巡航", sport: "运动拉练" } as const;

function routeGeoJson(routes: CyclingRoute[]) {
  return {
    type: "FeatureCollection" as const,
    features: routes.map((route) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: route.geometry },
      properties: { id: route.id, color: route.color },
    })),
  };
}

function routePointGeoJson(routes: CyclingRoute[]) {
  return {
    type: "FeatureCollection" as const,
    features: routes.map((route) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [route.startLongitude, route.startLatitude] },
      properties: { id: route.id, color: route.color, name: route.name },
    })),
  };
}

function activityGeoJson(activities: RideActivity[]) {
  return {
    type: "FeatureCollection" as const,
    features: activities.filter((activity) => activity.status === "open").map((activity, index) => {
      const angle = (index % 8) * Math.PI / 4;
      const offset = Math.floor(index / 8) + 1;
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [
            activity.meetingLongitude + Math.cos(angle) * .0011 * offset,
            activity.meetingLatitude + Math.sin(angle) * .0008 * offset,
          ],
        },
        properties: { id: activity.id, routeId: activity.routeId, color: activity.routeColor, title: activity.title },
      };
    }),
  };
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "请求失败，请稍后重试");
  return body;
}

export function EastLakeHub() {
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [snapshot, setSnapshot] = useState<CommunitySnapshot>({ routes: [], activities: [], user: null });
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [tab, setTab] = useState<"routes" | "activities">("routes");
  const [panelOpen, setPanelOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const selectedRoute = useMemo(() => snapshot.routes.find((item) => item.id === selectedRouteId) ?? snapshot.routes[0] ?? null, [selectedRouteId, snapshot.routes]);
  const selectedActivity = useMemo(() => snapshot.activities.find((item) => item.id === selectedActivityId) ?? null, [selectedActivityId, snapshot.activities]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/east-lake", { cache: "no-store" });
    if (!response.ok) throw new Error("专题数据加载失败");
    const data = await response.json() as CommunitySnapshot;
    setSnapshot(data);
    setSelectedRouteId((current) => current ?? data.routes[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/east-lake", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("专题数据加载失败");
        return response.json() as Promise<CommunitySnapshot>;
      })
      .then((data) => {
        setSnapshot(data);
        setSelectedRouteId(data.routes[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNotice(error instanceof Error ? error.message : "加载失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!mapNode.current || map.current) return;
    const instance = new maplibregl.Map({ container: mapNode.current, style: MAP_STYLE, center: [114.423, 30.578], zoom: 11.7, minZoom: 10, maxZoom: 17, attributionControl: false });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    return () => { instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || snapshot.routes.length === 0) return;
    const update = () => {
      const lineData = routeGeoJson(snapshot.routes);
      const routePoints = routePointGeoJson(snapshot.routes);
      const activityPoints = activityGeoJson(snapshot.activities);
      const existing = instance.getSource("east-lake-routes") as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(lineData);
        (instance.getSource("route-points") as GeoJSONSource | undefined)?.setData(routePoints);
        (instance.getSource("activity-points") as GeoJSONSource | undefined)?.setData(activityPoints);
      }
      else {
        instance.addSource("east-lake-routes", { type: "geojson", data: lineData });
        instance.addLayer({ id: "routes-shadow", type: "line", source: "east-lake-routes", paint: { "line-color": "#07100f", "line-width": 9, "line-opacity": .65 } });
        instance.addLayer({ id: "routes-main", type: "line", source: "east-lake-routes", paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": ["case", ["==", ["get", "id"], selectedRouteId ?? ""], 1, .35] } });
        instance.addSource("route-points", { type: "geojson", data: routePoints });
        instance.addLayer({ id: "route-point-halo", type: "circle", source: "route-points", paint: { "circle-radius": 17, "circle-color": "#07100f", "circle-opacity": .78 } });
        instance.addLayer({ id: "route-point-main", type: "circle", source: "route-points", paint: { "circle-radius": 11, "circle-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-color": "#f7f4ea" } });
        instance.addLayer({ id: "route-point-label", type: "symbol", source: "route-points", layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.8], "text-anchor": "top" }, paint: { "text-color": "#10211e", "text-halo-color": "rgba(255,255,255,.95)", "text-halo-width": 2 } });
        instance.addSource("activity-points", { type: "geojson", data: activityPoints });
        instance.addLayer({ id: "activity-point-halo", type: "circle", source: "activity-points", paint: { "circle-radius": 20, "circle-color": "#07100f", "circle-opacity": .82 } });
        instance.addLayer({ id: "activity-point-main", type: "circle", source: "activity-points", paint: { "circle-radius": 14, "circle-color": "#d8ff3e", "circle-stroke-width": 3, "circle-stroke-color": ["get", "color"] } });
        instance.addLayer({ id: "activity-point-glyph", type: "symbol", source: "activity-points", layout: { "text-field": "骑", "text-size": 12, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#07100f" } });
        instance.addLayer({ id: "activity-point-label", type: "symbol", source: "activity-points", minzoom: 12, layout: { "text-field": ["get", "title"], "text-size": 11, "text-offset": [0, 2.25], "text-anchor": "top" }, paint: { "text-color": "#10211e", "text-halo-color": "rgba(255,255,255,.95)", "text-halo-width": 2 } });
        instance.on("click", "route-point-main", (event) => {
          const feature = event.features?.[0];
          const id = feature?.properties?.id as string | undefined;
          if (!id || feature?.geometry.type !== "Point") return;
          setSelectedActivityId(null); setSelectedRouteId(id); setTab("routes");
          instance.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 13.5, duration: 800 });
        });
        instance.on("click", "activity-point-main", (event) => {
          const feature = event.features?.[0];
          const id = feature?.properties?.id as string | undefined;
          const routeId = feature?.properties?.routeId as string | undefined;
          if (!id || feature?.geometry.type !== "Point") return;
          setSelectedActivityId(id); if (routeId) setSelectedRouteId(routeId); setTab("activities");
          instance.flyTo({ center: feature.geometry.coordinates as [number, number], zoom: 14.2, duration: 800 });
        });
        for (const layer of ["route-point-main", "activity-point-main"]) {
          instance.on("mouseenter", layer, () => { instance.getCanvas().style.cursor = "pointer"; });
          instance.on("mouseleave", layer, () => { instance.getCanvas().style.cursor = ""; });
        }
      }
      if (instance.getLayer("routes-main")) instance.setPaintProperty("routes-main", "line-opacity", ["case", ["==", ["get", "id"], selectedRouteId ?? snapshot.routes[0].id], 1, .3]);
      if (instance.getLayer("route-point-main")) instance.setPaintProperty("route-point-main", "circle-radius", ["case", ["==", ["get", "id"], selectedRouteId ?? snapshot.routes[0].id], 14, 10]);
      if (instance.getLayer("activity-point-main")) instance.setPaintProperty("activity-point-main", "circle-radius", ["case", ["==", ["get", "id"], selectedActivityId ?? ""], 18, 14]);
    };
    if (instance.isStyleLoaded()) update(); else instance.once("load", update);
  }, [selectedActivityId, selectedRouteId, snapshot.activities, snapshot.routes]);

  const selectRoute = (route: CyclingRoute) => {
    setSelectedActivityId(null);
    setSelectedRouteId(route.id);
    if (route.geometry.length) {
      const bounds = route.geometry.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(route.geometry[0], route.geometry[0]));
      map.current?.fitBounds(bounds, { padding: { top: 110, right: 390, bottom: 80, left: 430 }, duration: 900 });
    }
  };

  const selectActivity = (activity: RideActivity) => {
    setSelectedActivityId(activity.id);
    setSelectedRouteId(activity.routeId);
    setTab("activities");
    map.current?.flyTo({ center: [activity.meetingLongitude, activity.meetingLatitude], zoom: 14.2, duration: 850 });
  };

  const mutateActivity = async (activity: RideActivity, action: "join" | "leave" | "cancel") => {
    if (!snapshot.user) { setAuthOpen(true); return; }
    setNotice("");
    try {
      const url = action === "cancel" ? `/api/activities/${activity.id}` : `/api/activities/${activity.id}/join`;
      await api(url, { method: action === "join" ? "POST" : "DELETE" });
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "操作失败"); }
  };

  return <main className={styles.shell}>
    <div ref={mapNode} className={styles.map} aria-label="东湖骑行示意地图" />
    <div className={styles.mapTint} />
    <header className={styles.header}>
      <Link href="/" className={styles.back}>← 江城图志</Link>
      <div className={styles.brand}><b>东湖骑行行动处</b><span>EAST LAKE RIDERS</span></div>
      <button className={styles.account} onClick={() => setAuthOpen(true)}>{snapshot.user ? snapshot.user.displayName : "登录 / 注册"}</button>
    </header>

    <button className={`${styles.panelToggle} ${panelOpen ? styles.panelToggleOpen : ""}`} type="button" aria-expanded={panelOpen} onClick={() => setPanelOpen((open) => !open)}>{panelOpen ? "‹ 收起" : "› 展开路线"}</button>
    <aside className={`${styles.leftPanel} ${panelOpen ? "" : styles.panelCollapsed}`} aria-hidden={!panelOpen}>
      <div className={styles.missionHead}><span>江城差事 · 001</span><h1>今天，骑进东湖。</h1><p>选一条线，看攻略，或者召集一群同路的人。这里不是导航，是武汉骑行故事的起点。</p></div>
      <div className={styles.tabs}>
        <button className={tab === "routes" ? styles.activeTab : ""} onClick={() => setTab("routes")}>路线攻略</button>
        <button className={tab === "activities" ? styles.activeTab : ""} onClick={() => setTab("activities")}>附近差事 <i>{snapshot.activities.filter((a) => a.status === "open").length}</i></button>
      </div>
      <div className={styles.scroll}>
        {loading && <div className={styles.empty}>正在接入东湖信号…</div>}
        {tab === "routes" && snapshot.routes.map((route, index) => <button key={route.id} className={`${styles.routeCard} ${selectedRoute?.id === route.id ? styles.selected : ""}`} onClick={() => selectRoute(route)}>
          <span className={styles.routeNumber}>0{index + 1}</span><span className={styles.routeStripe} style={{ background: route.color }} />
          <span><b>{route.name}</b><small>{route.subtitle}</small><em>{route.distanceKm} KM · {Math.round(route.durationMinutes / 5) * 5} 分钟 · {difficulty[route.difficulty]}</em></span>
        </button>)}
        {tab === "activities" && (snapshot.activities.length ? snapshot.activities.map((activity) => <ActivityCard key={activity.id} activity={activity} selected={activity.id === selectedActivityId} onSelect={() => selectActivity(activity)} onAction={mutateActivity} />) : <div className={styles.empty}>还没有人发起差事。<br />做今天的第一个召集人。</div>)}
      </div>
    </aside>

    {selectedActivity ? <section className={styles.routeDetail}>
      <div className={styles.activityHero} style={{ "--route": selectedActivity.routeColor } as React.CSSProperties}><span>RIDE MISSION</span><b>骑</b><small>{selectedActivity.status === "open" ? "正在招募" : "已取消"}</small></div>
      <div className={styles.detailBody}><p className={styles.kicker}>{selectedActivity.routeName} · {paceNames[selectedActivity.pace]}</p><h2>{selectedActivity.title}</h2><p>{selectedActivity.details}</p>
        <div className={styles.activityFacts}><span><small>出发时间</small>{dateLabel(selectedActivity.startsAt)}</span><span><small>集合点</small>{selectedActivity.meetingName}</span><span><small>当前队伍</small>{selectedActivity.joinedCount} / {selectedActivity.capacity} 人</span></div>
        <div className={styles.detailOwner}><span className={styles.avatar} style={{ background: selectedActivity.creator.avatarColor }}>{selectedActivity.creator.displayName.slice(0, 1)}</span><b>{selectedActivity.creator.displayName}</b><small>发起人</small></div>
        {selectedActivity.status === "open" && <button className={styles.primary} disabled={selectedActivity.joinedCount >= selectedActivity.capacity && !selectedActivity.joinedByMe} onClick={() => mutateActivity(selectedActivity, selectedActivity.isOwner ? "cancel" : selectedActivity.joinedByMe ? "leave" : "join")}>{selectedActivity.isOwner ? "取消差事" : selectedActivity.joinedByMe ? "退出差事" : selectedActivity.joinedCount >= selectedActivity.capacity ? "队伍已满" : "加入这次骑行"}</button>}
      </div>
    </section> : selectedRoute && <section className={styles.routeDetail}>
      <div className={styles.routeHero} style={{ "--route": selectedRoute.color } as React.CSSProperties}><span>ROUTE FILE</span><b>{selectedRoute.distanceKm}</b><small>公里 · 示意线</small></div>
      <div className={styles.detailBody}><p className={styles.kicker}>{difficulty[selectedRoute.difficulty]} · 约 {selectedRoute.durationMinutes} 分钟</p><h2>{selectedRoute.name}</h2><p>{selectedRoute.description}</p>
        <div className={styles.highlights}>{selectedRoute.highlights.map((item) => <span key={item}>◆ {item}</span>)}</div>
        <details><summary>出发提示</summary>{selectedRoute.tips.map((tip) => <p key={tip}>— {tip}</p>)}</details>
        <button className={styles.primary} onClick={() => snapshot.user ? setCreateOpen(true) : setAuthOpen(true)}>在这条线发起差事</button>
      </div>
    </section>}

    <div className={styles.legend} aria-label="地图图例"><b>地图图例</b><span><i className={styles.legendLine} />路线示意</span><span><i className={styles.legendStart} />路线起点</span><span><i className={styles.legendRide}>骑</i>骑行差事</span></div>
    <div className={styles.disclaimer}>路线为探索示意，非专业导航 · 请遵守现场标识与骑行规定</div>
    {notice && <button className={styles.notice} onClick={() => setNotice("")}>{notice} ×</button>}
    {authOpen && <AuthModal user={snapshot.user} onClose={() => setAuthOpen(false)} onDone={async () => { await refresh(); setAuthOpen(false); }} />}
    {createOpen && selectedRoute && <CreateModal route={selectedRoute} onClose={() => setCreateOpen(false)} onDone={async () => { await refresh(); setCreateOpen(false); setTab("activities"); }} />}
  </main>;
}

function ActivityCard({ activity, selected, onSelect, onAction }: { activity: RideActivity; selected: boolean; onSelect: () => void; onAction: (activity: RideActivity, action: "join" | "leave" | "cancel") => void }) {
  const full = activity.joinedCount >= activity.capacity;
  return <article className={`${styles.activityCard} ${selected ? styles.activitySelected : ""}`} role="button" tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }}>
    <div className={styles.activityTop}><span style={{ background: activity.routeColor }} /> <b>{activity.title}</b><em>{activity.status === "open" ? "招募中" : "已取消"}</em></div>
    <p>{activity.details}</p><dl><div><dt>时间</dt><dd>{dateLabel(activity.startsAt)}</dd></div><div><dt>集合</dt><dd>{activity.meetingName}</dd></div><div><dt>队伍</dt><dd>{activity.joinedCount}/{activity.capacity} · {paceNames[activity.pace]}</dd></div></dl>
    <footer><span className={styles.avatar} style={{ background: activity.creator.avatarColor }}>{activity.creator.displayName.slice(0, 1)}</span><span>{activity.creator.displayName} 发起</span>
      {activity.status === "open" && <button disabled={full && !activity.joinedByMe} onClick={(event) => { event.stopPropagation(); onAction(activity, activity.isOwner ? "cancel" : activity.joinedByMe ? "leave" : "join"); }}>{activity.isOwner ? "取消差事" : activity.joinedByMe ? "退出" : full ? "已满" : "加入"}</button>}
    </footer>
  </article>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className={styles.modalShade} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}><button className={styles.modalClose} onClick={onClose}>×</button><h2>{title}</h2>{children}</section></div>;
}

function AuthModal({ user, onClose, onDone }: { user: CommunitySnapshot["user"]; onClose: () => void; onDone: () => Promise<void> }) {
  const [register, setRegister] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); setError(""); const data = new FormData(event.currentTarget); try { await api(register ? "/api/auth/register" : "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) }); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : "失败"); } finally { setBusy(false); } };
  if (user) return <Modal title="骑手档案" onClose={onClose}><div className={styles.profile}><span style={{ background: user.avatarColor }}>{user.displayName.slice(0, 1)}</span><b>{user.displayName}</b><small>@{user.username}</small></div><button className={styles.secondary} onClick={async () => { await api("/api/auth/session", { method: "DELETE" }); await onDone(); }}>退出登录</button></Modal>;
  return <Modal title={register ? "建立骑手档案" : "骑手登录"} onClose={onClose}><form className={styles.form} onSubmit={submit}>{register && <label>昵称<input name="displayName" required minLength={2} maxLength={24} placeholder="别人怎么称呼你" /></label>}<label>账号<input name="username" required pattern="[a-z0-9_]{3,24}" placeholder="英文小写 / 数字 / 下划线" /></label><label>密码<input name="password" required type="password" minLength={10} maxLength={72} placeholder="至少 10 位" /></label>{error && <p className={styles.formError}>{error}</p>}<button className={styles.primary} disabled={busy}>{busy ? "正在连接…" : register ? "注册并登录" : "登录"}</button></form><button className={styles.textButton} onClick={() => { setRegister(!register); setError(""); }}>{register ? "已有账号？直接登录" : "第一次来？注册骑手档案"}</button></Modal>;
}

function CreateModal({ route, onClose, onDone }: { route: CyclingRoute; onClose: () => void; onDone: () => Promise<void> }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); setError(""); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api("/api/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, routeId: route.id, capacity: Number(data.capacity), startsAt: new Date(String(data.startsAt)).toISOString() }) }); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : "创建失败"); } finally { setBusy(false); } };
  return <Modal title={`发起 · ${route.name}`} onClose={onClose}><form className={styles.form} onSubmit={submit}><label>差事标题<input name="title" required minLength={4} maxLength={48} placeholder="周六晨骑，梨园集合" /></label><label>出发时间<input name="startsAt" required type="datetime-local" /></label><label>集合点<input name="meetingName" required minLength={2} maxLength={80} defaultValue={route.startName} /></label><div className={styles.formRow}><label>队伍人数<input name="capacity" required type="number" min={2} max={30} defaultValue={6} /></label><label>骑行节奏<select name="pace" defaultValue="relaxed"><option value="relaxed">休闲观景</option><option value="steady">稳定巡航</option><option value="sport">运动拉练</option></select></label></div><label>说明<textarea name="details" required minLength={10} maxLength={400} placeholder="路线安排、适合人群、要带什么…" /></label>{error && <p className={styles.formError}>{error}</p>}<button className={styles.primary} disabled={busy}>{busy ? "正在发布…" : "发布差事"}</button></form></Modal>;
}
