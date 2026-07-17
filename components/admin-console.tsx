"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState, type FormEvent } from "react";
import styles from "./admin-console.module.css";
import { categoryMeta, type AdminPlace, type CategoryId } from "@/lib/places";
import type { PlaceInput } from "@/lib/place-validation";

const emptyForm: PlaceInput = {
  slug: "",
  name: "",
  subtitle: "",
  description: "",
  longitude: 114.3055,
  latitude: 30.5928,
  district: "武昌区",
  address: "",
  categoryId: "landmark",
  featured: false,
  status: "draft",
};

type AdminConsoleProps = { initialAuthenticated: boolean; initialPlaces: AdminPlace[] };
type PlacesResponse = { places?: AdminPlace[]; error?: string };

export function AdminConsole({ initialAuthenticated, initialPlaces }: AdminConsoleProps) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [password, setPassword] = useState("");
  const [places, setPlaces] = useState<AdminPlace[]>(initialPlaces);
  const [form, setForm] = useState<PlaceInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const editingPlace = useMemo(
    () => places.find((place) => place.id === editingId) ?? null,
    [editingId, places],
  );

  async function loadPlaces() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/places", { cache: "no-store" });
      const payload = await response.json() as PlacesResponse;
      if (response.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!response.ok || !payload.places) throw new Error(payload.error ?? "地点加载失败");
      setPlaces(payload.places);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "地点加载失败");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setMessage("");
  }

  function editPlace(place: AdminPlace) {
    setEditingId(place.id);
    setForm({
      slug: place.slug,
      name: place.name,
      subtitle: place.subtitle,
      description: place.description,
      longitude: place.longitude,
      latitude: place.latitude,
      district: place.district,
      address: place.address,
      categoryId: place.categoryId,
      featured: place.featured,
      status: place.status === "published" ? "published" : "draft",
    });
    setMessage("");
    setError("");
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "登录失败");
      setPassword("");
      setAuthenticated(true);
      await loadPlaces();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false);
    setPlaces([]);
    setBusy(false);
  }

  async function savePlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        editingId ? `/api/admin/places/${encodeURIComponent(editingId)}` : "/api/admin/places",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "保存失败");
      const id = payload.id ?? editingId;
      await loadPlaces();
      setEditingId(id);
      setMessage(editingId ? "地点已更新" : "地点已创建，可以继续上传封面图片");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function archivePlace(place: AdminPlace) {
    if (!window.confirm(`归档“${place.name}”？它会从公共地图隐藏，但数据和图片仍然保留。`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/places/${encodeURIComponent(place.id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "归档失败");
      if (editingId === place.id) resetForm();
      await loadPlaces();
      setMessage("地点已归档");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "归档失败");
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    const formElement = event.currentTarget;
    const fileInput = formElement.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setBusy(true);
    setError("");
    setMessage("");
    const body = new FormData();
    body.set("placeId", editingId);
    body.set("file", file);

    try {
      const response = await fetch("/api/admin/media", { method: "POST", body });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "图片上传失败");
      formElement.reset();
      await loadPlaces();
      setMessage("图片已上传到 R2，并已设为地点封面");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片上传失败");
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <main className={styles.loginPage}>
        <Link href="/" className={styles.backLink}>← 返回江城图志</Link>
        <section className={styles.loginCard}>
          <div className={styles.loginMark}>江</div>
          <p className={styles.eyebrow}>JIANGCHENG ATLAS · ADMIN</p>
          <h1>图志管理台</h1>
          <p>登录后可以维护地点资料、发布状态与 R2 图片。</p>
          <form onSubmit={login}>
            <label>
              <span>管理员密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                minLength={12}
                maxLength={256}
                required
                autoFocus
              />
            </label>
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" disabled={busy}>{busy ? "正在验证…" : "安全登录"}</button>
          </form>
          <small>登录受 Cloudflare 限流保护，会话仅保存在 HttpOnly Cookie 中。</small>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.adminPage}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>JIANGCHENG ATLAS</p><h1>图志管理台</h1></div>
        <nav><Link href="/" target="_blank">查看地图 ↗</Link><button type="button" onClick={logout} disabled={busy}>退出</button></nav>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.placeSidebar}>
          <div className={styles.sidebarHeading}>
            <div><strong>地点资料</strong><span>{places.length} 条有效记录</span></div>
            <button type="button" onClick={resetForm}>＋ 新地点</button>
          </div>
          <div className={styles.placeList}>
            {loading && <div className={styles.loading}>正在读取 D1…</div>}
            {places.map((place) => (
              <button key={place.id} type="button" className={`${styles.placeItem} ${editingId === place.id ? styles.active : ""}`} onClick={() => editPlace(place)}>
                {place.imageUrl ? <Image src={place.imageUrl} alt="" width={52} height={52} unoptimized /> : <span style={{ background: categoryMeta[place.categoryId].color }}>{categoryMeta[place.categoryId].icon}</span>}
                <span><strong>{place.name}</strong><small>{place.district} · {place.status === "published" ? "已发布" : "草稿"}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.editor}>
          <div className={styles.editorHeading}>
            <div><p className={styles.eyebrow}>{editingId ? "EDIT PLACE" : "NEW PLACE"}</p><h2>{editingId ? `编辑 ${editingPlace?.name ?? "地点"}` : "新增城市坐标"}</h2></div>
            {editingPlace && <button type="button" className={styles.archiveButton} onClick={() => archivePlace(editingPlace)} disabled={busy}>归档地点</button>}
          </div>

          {(message || error) && <div className={error ? styles.error : styles.success}>{error || message}</div>}

          <form className={styles.placeForm} onSubmit={savePlace}>
            <div className={styles.fieldGrid}>
              <label><span>地点名称</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} required /></label>
              <label><span>Slug</span><input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={80} placeholder="yellow-crane-tower" required /></label>
              <label className={styles.wide}><span>一句话简介</span><input value={form.subtitle} onChange={(event) => setForm({ ...form, subtitle: event.target.value })} maxLength={120} required /></label>
              <label className={styles.wide}><span>地点描述</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={1200} rows={4} required /></label>
              <label><span>行政区</span><input value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} maxLength={40} required /></label>
              <label><span>详细地址</span><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={160} required /></label>
              <label><span>经度</span><input type="number" step="0.000001" min="113" max="116" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: Number(event.target.value) })} required /></label>
              <label><span>纬度</span><input type="number" step="0.000001" min="29" max="32" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: Number(event.target.value) })} required /></label>
              <label><span>分类</span><select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value as CategoryId })}>{(Object.keys(categoryMeta) as Array<keyof typeof categoryMeta>).filter((id) => id !== "all").map((id) => <option key={id} value={id}>{categoryMeta[id].label}</option>)}</select></label>
              <label><span>发布状态</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "draft" | "published" })}><option value="draft">草稿</option><option value="published">立即发布</option></select></label>
            </div>
            <label className={styles.checkRow}><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} /><span>设为本期推荐地点</span></label>
            <button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? "正在保存…" : editingId ? "保存地点更新" : "创建地点"}</button>
          </form>

          <section className={styles.uploadSection}>
            <div><h3>地点封面</h3><p>图片会写入 Cloudflare R2，仅支持 JPEG、PNG、WebP、AVIF，最大 5 MB。</p></div>
            {editingPlace?.imageUrl && <Image src={editingPlace.imageUrl} alt={`${editingPlace.name}封面`} width={720} height={405} unoptimized />}
            <form onSubmit={uploadImage}>
              <input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={!editingId || busy} required />
              <button type="submit" disabled={!editingId || busy}>{editingId ? "上传到 R2" : "请先创建地点"}</button>
            </form>
          </section>
        </section>
      </div>
    </main>
  );
}
