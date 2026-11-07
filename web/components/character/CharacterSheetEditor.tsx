"use client";

// ===== 角色设定编辑器 =====
// 桌面：可拖拽悬浮窗（通用 FloatingWindow）；移动：底部近全屏抽屉（同一组件 + CSS）。
// 单页长表单 + 左侧锚点；任意改动 3 秒防抖自动保存草稿；「完成并公开 / 发布新版本」才对外可见。

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import FloatingWindow from "@/components/ui/FloatingWindow";
import RichTextEditor from "@/components/editor/RichTextEditor";
import { useToast } from "@/components/Toast";
import { ApiException, guildApi, mediaApi, type GuildListItem } from "@/lib/api";
import {
  CHARACTER_BUILD_PRESETS,
  CHARACTER_CATEGORIES,
  CHARACTER_GENDERS,
  CHARACTER_LIMITS,
} from "@/lib/character-constants";
import {
  characterApi,
  characterMediaUrl,
  emptyCharacterPayload,
  payloadFromSheet,
  type CharacterPayload,
  type CharacterSheet,
} from "@/lib/api/character";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY = 3000;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 << 20;

const SECTIONS = [
  { key: "basic", label: "基本档案" },
  { key: "attrs", label: "基础属性" },
  { key: "abilities", label: "能力" },
  { key: "desc", label: "角色描述" },
  { key: "media", label: "头像图片" },
  { key: "guild", label: "归属语录" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export interface CharacterSheetEditorProps {
  sheetId: string;
  onClose: () => void;
  /** 发布成功后通知列表刷新 */
  onSaved: () => void;
}

/** 发布前的本地校验（与服务端 strict 校验对齐） */
function validateLocal(form: CharacterPayload): string {
  if (!form.name.trim()) return "请填写名字";
  if (!form.age.trim()) return "请填写年龄";
  if (!form.build.trim()) return "请填写体态";
  if (form.abilities.length === 0) return "请至少添加一项能力";
  const plain = form.description_html.replace(/<[^>]*>/g, "").trim();
  if (!plain) return "请填写角色描述";
  return "";
}

/** 设定编辑器。 */
export default function CharacterSheetEditor({ sheetId, onClose, onSaved }: CharacterSheetEditorProps) {
  const { toast } = useToast();
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [form, setForm] = useState<CharacterPayload>(emptyCharacterPayload());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState<"avatar" | "image" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("basic");
  const [guilds, setGuilds] = useState<GuildListItem[] | null>(null);

  const formRef = useRef(form);
  const dirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const suppressedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const confirmingTimerRef = useRef<number | null>(null);
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLElement | null>>>({});
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 表单值同步到 ref（供自动保存定时器读取最新值）
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  // 加载
  useEffect(() => {
    let alive = true;
    characterApi
      .detail(sheetId)
      .then((r) => {
        if (!alive) return;
        setSheet(r.item);
        setForm(payloadFromSheet(r.item));
        setLoadError("");
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof ApiException ? e.message : "加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sheetId]);

  const flush = useCallback(async () => {
    if (suppressedRef.current) return;
    if (!dirtyRef.current) return;
    // 已有保存在途：登记 pending，由 finally 里续跑，避免丢掉保存期间的改动
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    const version = changeVersionRef.current;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const r = await characterApi.saveDraft(sheetId, formRef.current);
      if (suppressedRef.current) return;
      setSavedAt(r.saved_at || new Date().toISOString());
      if (changeVersionRef.current === version) {
        dirtyRef.current = false;
        setSaveState("saved");
      } else {
        setSaveState("dirty");
        pendingRef.current = true;
      }
      setSaveError("");
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof ApiException ? e.message : "自动保存失败");
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !suppressedRef.current) {
        pendingRef.current = false;
        window.setTimeout(() => {
          void flushRef.current();
        }, 200);
      }
    }
  }, [sheetId]);

  /** 等待在途保存结束（最多 3s），供关闭/发布/放弃/删除前调用 */
  const waitForIdle = useCallback(async () => {
    for (let i = 0; i < 30 && savingRef.current; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    changeVersionRef.current += 1;
    setSaveState("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, AUTOSAVE_DELAY);
  }, []);

  // 保存完成后再补一轮（避免保存期间的改动丢失）
  useEffect(() => {
    if (saveState === "saved" || saveState === "error") return;
    if (dirtyRef.current && !savingRef.current && timerRef.current === null) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flushRef.current();
      }, AUTOSAVE_DELAY);
    }
  }, [saveState]);

  // 页面隐藏 / 卸载时立即落盘
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (confirmingTimerRef.current) window.clearTimeout(confirmingTimerRef.current);
      void flushRef.current();
    };
  }, []);

  const update = useCallback(
    (patch: Partial<CharacterPayload>) => {
      setForm((prev) => ({ ...prev, ...patch }));
      scheduleSave();
    },
    [scheduleSave]
  );

  const handleClose = useCallback(async () => {
    for (let i = 0; i < 30; i += 1) {
      await flushRef.current();
      if (!savingRef.current && !dirtyRef.current) break;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    onClose();
  }, [onClose]);

  const handlePublish = async () => {
    if (publishing) return;
    const msg = validateLocal(formRef.current);
    if (msg) {
      toast(msg, "error");
      return;
    }
    setPublishing(true);
    try {
      // 排在途保存落地后再发布，并在发布后抑制自动保存，避免旧草稿被写回
      await waitForIdle();
      const r = await characterApi.publish(sheetId, formRef.current);
      suppressedRef.current = true;
      dirtyRef.current = false;
      setSaveState("idle");
      toast(r.item.status === 2 ? "已保存（当前被管理员下架，不会公开展示）" : "已发布", "success");
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "发布失败", "error");
    } finally {
      setPublishing(false);
    }
  };

  const handleDiscard = async () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      if (confirmingTimerRef.current) window.clearTimeout(confirmingTimerRef.current);
      confirmingTimerRef.current = window.setTimeout(() => setConfirmDiscard(false), 4000);
      return;
    }
    if (confirmingTimerRef.current) window.clearTimeout(confirmingTimerRef.current);
    try {
      await waitForIdle();
      suppressedRef.current = true;
      dirtyRef.current = false;
      await characterApi.discardDraft(sheetId);
      toast("已放弃草稿", "success");
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "操作失败", "error");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      if (confirmingTimerRef.current) window.clearTimeout(confirmingTimerRef.current);
      confirmingTimerRef.current = window.setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    if (confirmingTimerRef.current) window.clearTimeout(confirmingTimerRef.current);
    try {
      await waitForIdle();
      suppressedRef.current = true;
      dirtyRef.current = false;
      await characterApi.remove(sheetId);
      toast("角色已删除", "success");
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "删除失败", "error");
    }
  };

  const pickImage = async (file: File | undefined, kind: "avatar" | "image") => {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast("仅支持 PNG/JPG/WebP/GIF", "error");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast("图片大小不能超过 5MB", "error");
      return;
    }
    setUploading(kind);
    try {
      const r = await mediaApi.upload(file, kind === "avatar" ? "character_avatar" : "character_image");
      if (kind === "avatar") {
        update({ avatar_media_id: r.id });
      } else {
        const next = [...formRef.current.image_media_ids, r.id].slice(0, CHARACTER_LIMITS.images);
        update({ image_media_ids: next });
      }
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "上传失败", "error");
    } finally {
      setUploading(null);
    }
  };

  const ensureGuilds = useCallback(async () => {
    if (guilds !== null) return;
    try {
      const r = await guildApi.list();
      setGuilds(r.guilds || []);
    } catch {
      setGuilds([]);
    }
  }, [guilds]);

  const gotoSection = (key: SectionKey) => {
    setActiveSection(key);
    sectionRefs.current[key]?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const statusLabel = sheet?.status === 1 ? "已公开" : sheet?.status === 2 ? "已下架" : "草稿";
  const saveLabel =
    saveState === "saving"
      ? "保存中…"
      : saveState === "error"
        ? saveError || "保存失败"
        : saveState === "saved"
          ? `已保存 · ${savedAt ? new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "刚刚"}`
          : saveState === "dirty"
            ? "未保存…"
            : "无改动";

  const sectionTitle = (key: SectionKey, title: string, extra?: ReactNode) => (
    <div className="cs-sec-head" ref={(el) => { sectionRefs.current[key] = el; }}>
      <h4>{title}</h4>
      {extra ? <span className="cs-sec-extra">{extra}</span> : null}
    </div>
  );

  const abilities = form.abilities;
  const canAddAbility = abilities.length < CHARACTER_LIMITS.abilities;

  return (
    <FloatingWindow
      open
      onClose={() => void handleClose()}
      title={<>编辑设定{form.name ? ` · ${form.name}` : ""}</>}
      headerExtra={<span className={`cs-status cs-status-${sheet?.status ?? 0}`}>{statusLabel}</span>}
      storageKeyPrefix="ouo:character-editor"
      defaultWidth={760}
      defaultHeight={700}
      minWidth={560}
      minHeight={480}
      placement="center"
      titleId="cs-editor-title"
      closeAriaLabel="关闭编辑器"
      escapeGuardSelector=".follow-list-overlay, .donate-overlay"
      classes={{
        root: "cs-window",
        header: "cs-window-header",
        titleWrap: "cs-window-title-wrap",
        title: "cs-window-title",
        close: "cs-window-close",
        body: "cs-window-body",
        footer: "cs-window-footer",
        overlay: "cs-overlay",
        resizeHandle: "cs-resize",
      }}
      className="cs-editor"
      footer={
        <>
          <span className={`cs-save-label is-${saveState}`} title={saveError || undefined} role="status" aria-live="polite">
            <i aria-hidden="true"></i>
            {saveLabel}
          </span>
          <span className="cs-spacer" />
          <button type="button" className="cs-btn cs-btn-ghost" onClick={() => void handleDiscard()}>
            {confirmDiscard ? "确定放弃？" : "放弃草稿"}
          </button>
          {sheet && sheet.status !== 0 ? (
            <button type="button" className="cs-btn cs-btn-danger" onClick={() => void handleDelete()}>
              {confirmDelete ? "确定删除角色？" : "删除角色"}
            </button>
          ) : null}
          <button
            type="button"
            className="cs-btn cs-btn-primary"
            onClick={() => void handlePublish()}
            disabled={publishing || loading || !!loadError}
          >
            {publishing ? "发布中…" : sheet && sheet.version > 0 ? "发布新版本" : "完成并公开"}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="cs-editor-state">加载中…</div>
      ) : loadError ? (
        <div className="cs-editor-state is-error">{loadError}</div>
      ) : (
        <div className="cs-editor-inner">
          <nav className="cs-editor-nav" aria-label="表单分区">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={activeSection === s.key ? "active" : ""}
                onClick={() => gotoSection(s.key)}
              >
                {s.label}
                {s.key === "abilities" ? (
                  <span className="cs-nav-count">
                    {abilities.length}/{CHARACTER_LIMITS.abilities}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="cs-editor-form">
            {/* 基本档案 */}
            <section className="cs-sec">
              {sectionTitle("basic", "基本档案")}
              <label className="cs-field">
                <span>名字<em>*</em></span>
                <input
                  className="cs-input"
                  value={form.name}
                  maxLength={CHARACTER_LIMITS.name}
                  placeholder="角色的名字"
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <div className="cs-grid-2">
                <label className="cs-field">
                  <span>别称</span>
                  <input
                    className="cs-input"
                    value={form.alias}
                    maxLength={CHARACTER_LIMITS.name}
                    placeholder="可选"
                    onChange={(e) => update({ alias: e.target.value })}
                  />
                </label>
                <label className="cs-field">
                  <span>称号</span>
                  <input
                    className="cs-input"
                    value={form.title}
                    maxLength={CHARACTER_LIMITS.name}
                    placeholder="可选"
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </label>
              </div>
            </section>

            {/* 基础属性 */}
            <section className="cs-sec">
              {sectionTitle("attrs", "基础属性")}
              <div className="cs-field">
                <span>性别<em>*</em></span>
                <div className="cs-seg">
                  {CHARACTER_GENDERS.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      className={form.gender === g.value ? "on" : ""}
                      onClick={() => update({ gender: g.value })}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cs-grid-2">
                <label className="cs-field">
                  <span>年龄<em>*</em></span>
                  <input
                    className="cs-input"
                    value={form.age}
                    maxLength={CHARACTER_LIMITS.short}
                    placeholder="如：三百余岁 / 不详"
                    onChange={(e) => update({ age: e.target.value })}
                  />
                </label>
                <label className="cs-field">
                  <span>体态<em>*</em></span>
                  <input
                    className="cs-input"
                    value={form.build}
                    maxLength={CHARACTER_LIMITS.short}
                    placeholder="如：修长 / 娇小"
                    onChange={(e) => update({ build: e.target.value })}
                  />
                </label>
              </div>
              <div className="cs-chips">
                {CHARACTER_BUILD_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={form.build === preset ? "on" : ""}
                    onClick={() => update({ build: preset })}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div className="cs-grid-2">
                <label className="cs-field">
                  <span>物种</span>
                  <input
                    className="cs-input"
                    value={form.species}
                    maxLength={CHARACTER_LIMITS.short}
                    placeholder="可选"
                    onChange={(e) => update({ species: e.target.value })}
                  />
                </label>
                <label className="cs-field">
                  <span>身份</span>
                  <input
                    className="cs-input"
                    value={form.identity}
                    maxLength={CHARACTER_LIMITS.short}
                    placeholder="可选"
                    onChange={(e) => update({ identity: e.target.value })}
                  />
                </label>
              </div>
            </section>

            {/* 能力 */}
            <section className="cs-sec">
              {sectionTitle("abilities", "能力", `${abilities.length} / ${CHARACTER_LIMITS.abilities}`)}
              {abilities.map((a, index) => (
                <div className="cs-ability-row" key={index}>
                  <select
                    className="cs-select"
                    value={a.category}
                    aria-label={`能力 ${index + 1} 类型`}
                    onChange={(e) => {
                      const next = abilities.map((item, i) =>
                        i === index ? { ...item, category: e.target.value } : item
                      );
                      update({ abilities: next });
                    }}
                  >
                    {CHARACTER_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    className="cs-input"
                    value={a.detail}
                    maxLength={CHARACTER_LIMITS.abilityDetail}
                    placeholder="具体能力（任意内容）"
                    onChange={(e) => {
                      const next = abilities.map((item, i) =>
                        i === index ? { ...item, detail: e.target.value } : item
                      );
                      update({ abilities: next });
                    }}
                  />
                  <button
                    type="button"
                    className="cs-icon-btn"
                    aria-label="删除这项能力"
                    onClick={() => update({ abilities: abilities.filter((_, i) => i !== index) })}
                  >
                    <i className="fa fa-times" aria-hidden="true"></i>
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="cs-add-row"
                disabled={!canAddAbility}
                onClick={() =>
                  update({
                    abilities: [...abilities, { category: CHARACTER_CATEGORIES[0], detail: "" }],
                  })
                }
              >
                <i className="fa fa-plus" aria-hidden="true"></i> 添加能力
                {!canAddAbility ? "（已达上限）" : ""}
              </button>
            </section>

            {/* 角色描述 */}
            <section className="cs-sec">
              {sectionTitle("desc", "角色描述")}
              <RichTextEditor
                value={form.description_html}
                onChange={(html) => update({ description_html: html })}
                placeholder="详细描写这个角色：来历、性格、与谁有关…"
              />
            </section>

            {/* 头像与图片 */}
            <section className="cs-sec">
              {sectionTitle("media", "头像与图片", `${form.image_media_ids.length} / ${CHARACTER_LIMITS.images}`)}
              <div className="cs-media-row">
                <div className="cs-media-avatar">
                  {form.avatar_media_id ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={characterMediaUrl(form.avatar_media_id)} alt="角色头像" />
                  ) : (
                    <span>{uploading === "avatar" ? "…" : "头像"}</span>
                  )}
                  <button type="button" onClick={() => avatarInputRef.current?.click()}>
                    {form.avatar_media_id ? "更换" : "上传"}
                  </button>
                </div>
                <div className="cs-media-grid">
                  {form.image_media_ids.map((id) => (
                    <div className="cs-media-slot filled" key={id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={characterMediaUrl(id)} alt="角色图片" />
                      <button
                        type="button"
                        className="cs-media-remove"
                        aria-label="移除图片"
                        onClick={() =>
                          update({ image_media_ids: form.image_media_ids.filter((x) => x !== id) })
                        }
                      >
                        <i className="fa fa-times" aria-hidden="true"></i>
                      </button>
                    </div>
                  ))}
                  {form.image_media_ids.length < CHARACTER_LIMITS.images ? (
                    <button
                      type="button"
                      className="cs-media-slot"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploading === "image"}
                    >
                      {uploading === "image" ? "…" : <i className="fa fa-plus" aria-hidden="true"></i>}
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  void pickImage(e.target.files?.[0], "avatar");
                  e.target.value = "";
                }}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  void pickImage(e.target.files?.[0], "image");
                  e.target.value = "";
                }}
              />
            </section>

            {/* 归属与语录 */}
            <section className="cs-sec">
              {sectionTitle("guild", "归属与语录")}
              <div className="cs-field">
                <span>所属会馆</span>
                <div className="cs-seg">
                  <button
                    type="button"
                    className={form.guild.mode === "none" ? "on" : ""}
                    onClick={() => update({ guild: { mode: "none", guild_id: 0, custom_name: "" } })}
                  >
                    不填写
                  </button>
                  <button
                    type="button"
                    className={form.guild.mode === "existing" ? "on" : ""}
                    onClick={() => {
                      void ensureGuilds();
                      update({ guild: { ...form.guild, mode: "existing" } });
                    }}
                  >
                    选择会馆
                  </button>
                  <button
                    type="button"
                    className={form.guild.mode === "custom" ? "on" : ""}
                    onClick={() => update({ guild: { ...form.guild, mode: "custom" } })}
                  >
                    自填名称
                  </button>
                </div>
              </div>
              {form.guild.mode === "existing" ? (
                <label className="cs-field">
                  <span>会馆</span>
                  <select
                    className="cs-select cs-select-wide"
                    value={form.guild.guild_id || 0}
                    onChange={(e) =>
                      update({ guild: { ...form.guild, guild_id: Number(e.target.value) || 0 } })
                    }
                  >
                    <option value={0}>请选择会馆…</option>
                    {(guilds || []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <small className="cs-hint">绑定后，这个角色会以「设定角色」的身份出现在该会馆的成员列表与人数统计里。</small>
                </label>
              ) : null}
              {form.guild.mode === "custom" ? (
                <label className="cs-field">
                  <span>会馆名称</span>
                  <input
                    className="cs-input"
                    value={form.guild.custom_name}
                    maxLength={CHARACTER_LIMITS.guild}
                    placeholder="自填一个会馆名称（不绑定现有会馆）"
                    onChange={(e) =>
                      update({ guild: { ...form.guild, custom_name: e.target.value } })
                    }
                  />
                </label>
              ) : null}

              <div className="cs-quotes-editor">
                <div className="cs-sec-sub">语录<span>{form.quotes.length} / {CHARACTER_LIMITS.quotes}</span></div>
                {form.quotes.map((q, index) => (
                  <div className="cs-quote-row" key={index}>
                    <input
                      className="cs-input"
                      value={q.content}
                      maxLength={CHARACTER_LIMITS.quote}
                      placeholder="一句能代表角色的话"
                      onChange={(e) =>
                        update({
                          quotes: form.quotes.map((item, i) =>
                            i === index ? { content: e.target.value } : item
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="cs-icon-btn"
                      aria-label="删除这条语录"
                      onClick={() => update({ quotes: form.quotes.filter((_, i) => i !== index) })}
                    >
                      <i className="fa fa-times" aria-hidden="true"></i>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="cs-add-row"
                  disabled={form.quotes.length >= CHARACTER_LIMITS.quotes}
                  onClick={() => update({ quotes: [...form.quotes, { content: "" }] })}
                >
                  <i className="fa fa-plus" aria-hidden="true"></i> 添加语录
                </button>
              </div>

              <button
                type="button"
                className={`cs-switch${form.quotes_visible ? " on" : ""}`}
                role="switch"
                aria-checked={form.quotes_visible}
                onClick={() => update({ quotes_visible: !form.quotes_visible })}
              >
                <span className="cs-switch-track" aria-hidden="true"></span>
                <span className="cs-switch-text">
                  参与彩蛋展示
                  <em>开启后，语录有机会出现在站点的「彩蛋」里，所有访客可见；随时可关闭。</em>
                </span>
              </button>
            </section>
          </div>
        </div>
      )}
    </FloatingWindow>
  );
}
