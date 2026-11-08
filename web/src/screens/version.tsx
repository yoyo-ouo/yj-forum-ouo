import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { checkUpdate, downloadUpdate, installUpdate, openInstallSettings } from "../lib/native";
import { bus } from "../lib/bus";
import { Loading, TopBar } from "../components/ui";
import type { UpdateManifest } from "../lib/types";

export function VersionScreen() {
  const appInfo = useApp((s) => s.appInfo);
  const showToast = useApp((s) => s.showToast);
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [path, setPath] = useState("");
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    void api.downloadsReleases().then((res) => setHistory(res.items || [])).catch(() => undefined);
  }, []);

  const check = async (silent = false) => {
    if (!appInfo) return;
    setChecking(true);
    try {
      const res = await checkUpdate(appInfo.versionName);
      setManifest(res);
      if (!silent && !res.available) showToast("已是最新版本");
    } catch (error) {
      if (!silent) showToast(error instanceof Error ? error.message : "检查失败", "error");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (appInfo) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appInfo?.versionName]);

  const download = async () => {
    const release = manifest?.release;
    if (!release) return;
    setDownloading(true);
    setPercent(0);
    const off = bus.on("updateProgress", (progress) => setPercent(progress.percent >= 0 ? progress.percent : 0));
    try {
      const res = await downloadUpdate({
        url: release.url,
        filename: release.filename,
        size: release.size,
        sha256: release.sha256,
        mirrors: [],
      });
      setPath(res.path);
      setPercent(100);
      showToast("下载完成，可安装");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "下载失败", "error");
    } finally {
      off();
      setDownloading(false);
    }
  };

  const install = async () => {
    if (!path) return;
    try {
      const res = await installUpdate(path);
      if (res.needsPermission) {
        showToast("请允许安装未知应用后重试", "error");
        await openInstallSettings();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "安装失败", "error");
    }
  };

  const release = manifest?.release;

  return (
    <div className="screen">
      <TopBar title="版本更新" back />
      <div className="version-card">
        <div className="version-row">
          <div>
            <div className="version-label">当前版本</div>
            <div className="version-num">{appInfo?.versionName || "2.0.0"} <span>({appInfo?.versionCode || 20000})</span></div>
          </div>
          <span className="version-badge">{manifest?.available ? "有新版本" : "稳定版"}</span>
        </div>
        <button className="btn primary block" style={{ marginTop: 12 }} disabled={checking} onClick={() => void check()}>{checking ? "检查中…" : "检查更新"}</button>
        {manifest && !manifest.available ? <div className="form-hint center" style={{ marginTop: 8 }}>已是最新版本</div> : null}
      </div>

      {release ? (
        <div className="update-card">
          <div className="update-head">
            <div><b>发现新版本 {release.version}</b><small>{release.size ? `${(release.size / 1024 / 1024).toFixed(1)} MB` : "安装包"} · {manifest?.source === "github" ? "GitHub" : "站内"}</small></div>
            <span className="version-badge">{manifest?.mandatory ? "重要更新" : "可选更新"}</span>
          </div>
          <div className="update-notes">
            {(release.notes || ["修复问题与体验优化"]).slice(0, 20).map((line, index) => <p key={index}>{line}</p>)}
          </div>
          <div className="progress"><i style={{ width: `${percent}%` }} /></div>
          <div className="update-foot">
            <span>{percent >= 100 && path ? "已下载并校验" : downloading ? `下载中 ${percent}%` : "等待下载"}</span>
            {path ? (
              <button className="btn primary sm" onClick={() => void install()}>立即安装</button>
            ) : (
              <button className="btn primary sm" disabled={downloading} onClick={() => void download()}>{downloading ? "下载中…" : "下载更新"}</button>
            )}
          </div>
        </div>
      ) : null}

      <div className="section-title">历史版本</div>
      {history.length === 0 ? <Loading text="加载历史版本…" /> : (
        <div className="history">
          {history.slice(0, 12).map((item: any) => (
            <div key={item.id || item.version} className="history-row">
              <b>{item.version}</b>
              <span>{item.date || item.created_at || ""}</span>
              <span>查看说明 ›</span>
            </div>
          ))}
        </div>
      )}
      <div className="me-footer">更新包会校验大小与 SHA-256；下载失败会自动切换镜像。</div>
    </div>
  );
}
