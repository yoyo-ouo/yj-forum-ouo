import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { checkUpdate, downloadUpdate, installUpdate, openInstallSettings } from "../lib/native";
import { bus } from "../lib/bus";
import { AppBar, Cell, Empty, Screen, Sheet, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import type { UpdateManifest } from "../lib/types";

interface ReleaseItem {
  version: string;
  channel?: string;
  date?: string;
  size?: number;
  notes?: string[];
  mandatory?: boolean;
}

const CHANNEL_LABEL: Record<string, string> = { stable: "稳定版", beta: "测试版" };

function formatSize(size?: number): string {
  return size && size > 0 ? `${(size / 1024 / 1024).toFixed(1)} MB` : "安装包";
}

function releaseNotes(item?: { notes?: string[] } | null): string[] {
  const notes = (item?.notes || []).filter((line) => Boolean(line && line.trim()));
  return notes.length > 0 ? notes : ["修复问题与体验优化"];
}

export function VersionScreen() {
  const appInfo = useApp((s) => s.appInfo);
  const showToast = useApp((s) => s.showToast);
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [path, setPath] = useState("");
  const [history, setHistory] = useState<ReleaseItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [noteOpen, setNoteOpen] = useState<ReleaseItem | null>(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await api.downloadsReleases(1, 20);
      setHistory(((res?.items || []) as ReleaseItem[]).slice(0, 10));
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "加载失败");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const check = async (silent = false) => {
    if (!appInfo) return;
    setChecking(true);
    setCheckError("");
    try {
      const res = await checkUpdate(appInfo.versionName);
      setManifest(res);
      if (!silent && !res.available) showToast("已是最新版本");
    } catch (error) {
      const message = error instanceof Error ? error.message : "检查失败";
      setCheckError(message);
      if (!silent) showToast(message, "error");
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
    const off = bus.on("updateProgress", (progress) => {
      const value = Number(progress?.percent);
      setPercent(Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);
    });
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

  const release = manifest?.release || null;
  const channel = CHANNEL_LABEL[release?.channel || ""] || "稳定版";
  const available = Boolean(manifest?.available && release);

  return (
    <>
      <Screen appbar={<AppBar back title="版本更新" />}>
        {/* 版本卡 */}
        <div className="m-card ver-hero">
          <div className="ver-hero-logo" aria-hidden="true">妖</div>
          <div className="ver-hero-main">
            <div className="ver-hero-name">妖精论坛</div>
            <div className="ver-hero-version">v{appInfo?.versionName || "2.0.0"}</div>
            <div className="ver-hero-build">Build {appInfo?.versionCode ?? 20000} · {channel}</div>
          </div>
          <button
            type="button"
            className="m-btn m-btn--soft ver-check"
            disabled={checking}
            onClick={() => void check()}
          >
            <Icon name="refresh" size={15} />
            {checking ? "检查中" : "检查更新"}
          </button>
        </div>

        {/* 有更新 */}
        {available && release ? (
          <div className="m-card ver-update">
            <div className="ver-update-head">
              <span className="ver-update-ver">v{release.version}</span>
              {manifest?.mandatory ? <span className="ver-badge">重要更新</span> : <span className="ver-badge">可选更新</span>}
            </div>
            <div className="ver-update-meta">
              <span>{formatSize(release.size)}</span>
              {release.date ? <><span aria-hidden="true">·</span><span>{release.date}</span></> : null}
              <span aria-hidden="true">·</span>
              <span>{manifest?.source === "github" ? "GitHub" : "站内"}</span>
            </div>
            <ul className="ver-notes">
              {releaseNotes(release).slice(0, 12).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            <div
              className="ver-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="下载进度"
            >
              <i style={{ width: `${percent}%` }} />
            </div>
            <div className="ver-update-foot">
              <span className="ver-status">
                {path ? "已下载并校验" : downloading ? `下载中 ${percent}%` : "等待下载"}
              </span>
              {path ? (
                <button type="button" className="m-btn m-btn--primary ver-action" onClick={() => void install()}>
                  立即安装
                </button>
              ) : (
                <button
                  type="button"
                  className="m-btn m-btn--primary ver-action"
                  disabled={downloading}
                  onClick={() => void download()}
                >
                  {downloading ? "下载中…" : "下载更新"}
                </button>
              )}
            </div>
            <p className="ver-perm">首次安装需在系统设置中允许「妖精论坛」安装未知来源应用。</p>
          </div>
        ) : null}

        {/* 无更新 / 检查结果 */}
        {!available && manifest && !checkError ? (
          <div className="ver-latest">已是最新版本</div>
        ) : null}
        {!available && checkError ? (
          <div className="ver-latest">检查失败：{checkError}，可点上方「检查更新」重试</div>
        ) : null}
        {!available && !manifest && !checkError && checking ? (
          <div className="ver-latest">正在检查更新…</div>
        ) : null}

        {/* 历史版本 */}
        <div className="m-section-title">历史版本</div>
        {historyLoading ? (
          <Skeletons count={3} />
        ) : historyError ? (
          <div className="ver-error">
            <span>{historyError}</span>
            <button type="button" className="m-btn m-btn--ghost m-btn--sm" onClick={() => void loadHistory()}>
              重试
            </button>
          </div>
        ) : history.length === 0 ? (
          <Empty icon="download" title="暂无发布记录" hint="有新版本发布后会显示在这里" />
        ) : (
          <div className="m-list">
            {history.map((item) => (
              <Cell
                key={item.version}
                label={item.version}
                sub={item.channel === "beta" ? "测试版" : undefined}
                value={item.date || ""}
                onClick={() => setNoteOpen(item)}
              />
            ))}
          </div>
        )}

        <div className="ver-foot">更新包会校验大小与 SHA-256；下载失败会自动切换镜像。</div>
      </Screen>

      <Sheet
        open={Boolean(noteOpen)}
        title={noteOpen ? `版本 ${noteOpen.version}` : "更新说明"}
        onClose={() => setNoteOpen(null)}
      >
        {noteOpen ? (
          <div className="ver-sheet">
            <div className="ver-sheet-meta">
              <span>{noteOpen.date || "未标注日期"}</span>
              <span aria-hidden="true">·</span>
              <span>{formatSize(noteOpen.size)}</span>
              {noteOpen.channel === "beta" ? <><span aria-hidden="true">·</span><span>测试版</span></> : null}
            </div>
            <ul className="ver-notes">
              {releaseNotes(noteOpen).slice(0, 20).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
