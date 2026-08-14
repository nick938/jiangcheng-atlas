"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { CommunityUser } from "@/lib/community-types";

type CommunityAuthModalProps = {
  onClose: () => void;
  onAuthenticated: (user: CommunityUser) => void | Promise<void>;
};

async function authRequest(path: string, payload: Record<string, FormDataEntryValue>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { user?: CommunityUser; error?: string };
  if (!response.ok || !result.user) throw new Error(result.error ?? "身份确认失败");
  return result.user;
}

export function CommunityAuthModal({ onClose, onAuthenticated }: CommunityAuthModalProps) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wechatConfigured, setWechatConfigured] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/wechat/status", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setWechatConfigured(Boolean((payload as { configured?: boolean }).configured)))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      const user = await authRequest(mode === "register" ? "/api/auth/register" : "/api/auth/login", payload);
      await onAuthenticated(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "身份确认失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="community-auth-shade" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="community-auth-card" role="dialog" aria-modal="true" aria-label="活动身份">
        <button type="button" className="community-auth-close" onClick={onClose} aria-label="关闭">×</button>
        <span className="community-auth-kicker">PLAYER IDENTITY</span>
        <h2>参与前，留一个江湖名号。</h2>
        <p>身份只在发布、报名或查看个人记录时需要，不影响浏览地图。</p>
        <div className="community-auth-tabs">
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>第一次来</button>
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>已有账号</button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>显示昵称<input name="displayName" required minLength={2} maxLength={24} placeholder="活动里别人怎么称呼你" /></label>
          )}
          <label>账号<input name="username" required pattern="[a-z0-9_]{3,24}" placeholder="英文小写、数字或下划线" /></label>
          <label>密码<input name="password" required type="password" minLength={10} maxLength={72} placeholder="至少 10 位" /></label>
          {error && <p className="community-auth-error">{error}</p>}
          <button type="submit" className="community-auth-submit" disabled={busy}>
            {busy ? "正在确认…" : mode === "register" ? "创建身份并继续" : "登录并继续"}
          </button>
        </form>
        <div className="community-auth-divider"><span>或</span></div>
        <a className={wechatConfigured ? "wechat-login" : "wechat-login disabled"} href={wechatConfigured ? "/api/auth/wechat/start" : undefined} aria-disabled={!wechatConfigured}>
          <b aria-hidden="true">微</b><span>{wechatConfigured ? "使用微信扫码登录" : "微信登录等待开放平台配置"}</span>
        </a>
        <small className="wechat-login-note">需要已审核的网站应用 AppID、AppSecret 与正式回调域名。</small>
        <p className="community-policy-links">继续即表示同意 <a href="/community-guidelines" target="_blank">社区公约</a> 与 <a href="/privacy" target="_blank">隐私说明</a>。</p>
      </section>
    </div>
  );
}
