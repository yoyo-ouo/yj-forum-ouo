import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { registerBackHandler } from "../lib/back";
import { avatarUrl, formatDate, timeAgo } from "../lib/format";
import { pickImage, uploadImageData } from "../lib/native";
import { AppBar, Cell, Confirm, Empty, IconButton, Loader, Screen, Segmented, Sheet } from "../components/mobile";
import { Icon } from "../components/icons";
import { ImageCrop } from "../components/ImageCrop";
import { RichContent } from "../components/ui";
import type { CharacterPayload, CharacterSheet } from "../lib/types";

/** TipTap/ProseMirror 体量大，只在进入编辑页时加载 */
const RichEditor = React.lazy(() =>
  import("../components/RichEditor").then((mod) => ({ default: mod.RichEditor })),
);

/* ======================= 常量（口径对齐服务端 character_sheets.go） ======================= */

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type SectionKey = "basic" | "attrs" | "abilities" | "desc" | "media" | "guild";
type MediaKind = "avatar" | "image";

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: "basic", label: "基本档案" },
  { key: "attrs", label: "基础属性" },
  { key: "abilities", label: "能力" },
  { key: "desc", label: "描述" },
  { key: "media", label: "头像图片" },
  { key: "guild", label: "归属语录" },
];

/** 六大能力系（服务端白名单） */
const CATEGORIES: string[] = ["御灵系", "生灵系", "锁御系", "造物系", "心灵系", "空间系"];
/** 体态常用标签（与网页端一致） */
const BUILD_PRESETS: string[] = ["幼小", "纤细", "修长", "匀称", "健硕", "高挑", "魁梧", "轻盈"];
const GENDERS: Array<{ key: string; label: string }> = [
  { key: "1", label: "男" },
  { key: "2", label: "女" },
  { key: "0", label: "无" },
];
const GUILD_MODES: Array<{ key: CharacterPayload["guild"]["mode"]; label: string }> = [
  { key: "none", label: "不填写" },
  { key: "existing", label: "选择会馆" },
  { key: "custom", label: "自填" },
];

/** 服务端限制 */
const LIMITS = {
  name: 24,
  short: 32,
  guild: 64,
  abilities: 10,
  abilityDetail: 60,
  images: 3,
  quotes: 20,
  quote: 120,
} as const;

/** 自动保存：停手 3 秒落盘 */
const AUTOSAVE_DELAY = 3000;

/* ======================= 工具 ======================= */

function emptyPayload(): CharacterPayload {
  return {
    name: "",
    alias: "",
    title: "",
    gender: 0,
    age: "",
    build: "",
    species: "",
    identity: "",
    description_html: "",
    avatar_media_id: "",
    image_media_ids: [],
    guild: { mode: "none", guild_id: 0, custom_name: "" },
    abilities: [],
    quotes: [],
    quotes_visible: false,
  };
}

/** 媒体 ID → 站内地址（交给 avatarUrl/mediaUrl 归一） */
function mediaSrc(id?: string | null): string {
  return id ? `/ov2/api/media/${id}` : "";
}

/** 富文本纯文本（判断描述是否为空） */
function plainText(html: string): string {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function genderLabel(value: unknown): string {
  if (Number(value) === 1) return "男";
  if (Number(value) === 2) return "女";
  return "无";
}

function statusLabel(status: unknown): string {
  if (Number(status) === 0) return "草稿";
  if (Number(status) === 2) return "已下架";
  return "已公开";
}

/** 时钟文案（hh:mm） */
function clockText(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 草稿/详情 → 编辑表单（草稿优先；缺失字段回落到空值） */
function normalizeForm(raw?: Partial<CharacterPayload> | null): CharacterPayload {
  const base = emptyPayload();
  if (!raw) return base;
  const abilities = Array.isArray(raw.abilities) ? raw.abilities : [];
  const quotes = Array.isArray(raw.quotes) ? raw.quotes : [];
  return {
    ...base,
    ...raw,
    gender: Number(raw.gender) === 1 ? 1 : Number(raw.gender) === 2 ? 2 : 0,
    guild: { ...base.guild, ...(raw.guild || {}) },
    avatar_media_id: String(raw.avatar_media_id || ""),
    description_html: String(raw.description_html || ""),
    image_media_ids: Array.isArray(raw.image_media_ids)
      ? raw.image_media_ids.map((item) => String(item || "")).filter(Boolean).slice(0, LIMITS.images)
      : [],
    abilities: abilities.slice(0, LIMITS.abilities).map((ability) => ({
      category: CATEGORIES.includes(String(ability?.category)) ? String(ability.category) : CATEGORIES[0],
      detail: String(ability?.detail || ""),
    })),
    quotes: quotes.slice(0, LIMITS.quotes).map((quote) => ({ content: String(quote?.content || "") })),
    quotes_visible: Boolean(raw.quotes_visible),
  };
}

function payloadFromSheet(item: CharacterSheet): CharacterPayload {
  if (item.draft) return normalizeForm(item.draft);
  return normalizeForm({
    name: item.name,
    alias: item.alias,
    title: item.title,
    gender: item.gender,
    age: item.age,
    build: item.build,
    species: item.species,
    identity: item.identity,
    description_html: item.description_html,
    avatar_media_id: item.avatar_media_id,
    image_media_ids: Array.isArray(item.images) ? item.images : [],
    guild: item.guild_id
      ? { mode: "existing", guild_id: Number(item.guild_id) || 0, custom_name: "" }
      : item.guild_custom_name
        ? { mode: "custom", guild_id: 0, custom_name: String(item.guild_custom_name) }
        : { mode: "none", guild_id: 0, custom_name: "" },
    abilities: Array.isArray(item.abilities) ? item.abilities : [],
    quotes: Array.isArray(item.quotes) ? item.quotes.filter((quote) => quote.is_active !== false) : [],
    quotes_visible: Boolean(item.quotes_visible),
  });
}

/** 有实际内容才自动建角色/保存，避免「点进来又退出」凭空多一个空草稿 */
function hasAnyContent(form: CharacterPayload): boolean {
  const text = [form.name, form.alias, form.title, form.age, form.build, form.species, form.identity];
  if (text.some((value) => String(value || "").trim())) return true;
  if (plainText(form.description_html)) return true;
  if (form.avatar_media_id || form.image_media_ids.length > 0) return true;
  if (form.abilities.some((ability) => String(ability.detail || "").trim())) return true;
  if (form.quotes.some((quote) => String(quote.content || "").trim())) return true;
  return false;
}

/** 发布前本地校验（与服务端 strict 校验对齐） */
function validateLocal(form: CharacterPayload): string {
  if (!form.name.trim()) return "请填写名字";
  if (!form.age.trim()) return "请填写年龄";
  if (!form.build.trim()) return "请填写体态";
  if (form.abilities.length === 0) return "请至少添加一项能力";
  if (!plainText(form.description_html)) return "请填写角色描述";
  if (form.guild.mode === "existing" && !form.guild.guild_id) return "请选择要绑定的会馆";
  return "";
}

/* ======================= 顶栏保存状态 ======================= */

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <button type="button" className="ce-save is-error" onClick={onRetry} aria-label="保存失败，点按重试">
        <i className="ce-save-dot" aria-hidden="true" />
        失败 · 重试
      </button>
    );
  }
  const label = state === "saving" ? "保存中" : state === "saved" ? "已保存" : "未保存";
  return (
    <span className={`ce-save is-${state}`} role="status" aria-live="polite">
      <i className="ce-save-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/* ======================= 页面 ======================= */

/** 角色设定编辑器（无 id = 新建） */
export function CharacterEditorScreen({ id }: { id?: string }) {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { pop, push } = useNav();
  const queryClient = useQueryClient();

  const initialId = id === undefined || id === null ? "" : String(id);
  const [sheetId, setSheetId] = useState(initialId);
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [form, setForm] = useState<CharacterPayload>(() => emptyPayload());
  const [loading, setLoading] = useState(Boolean(initialId));
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [savingNow, setSavingNow] = useState(false);
  const [uploading, setUploading] = useState<MediaKind | null>(null);
  /** 上传接口返回的绝对 url：优先用它做即时预览（native 下 mediaUrl 可能指向与上传不同的 host） */
  const [uploadedAvatar, setUploadedAvatar] = useState("");
  const [pickerKind, setPickerKind] = useState<MediaKind | null>(null);
  const [crop, setCrop] = useState<{ path: string; kind: MediaKind } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("basic");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const formRef = useRef(form);
  const sheetIdRef = useRef(sheetId);
  const dirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const suppressedRef = useRef(false);
  const publishingRef = useRef(false);
  const closingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const createRef = useRef<Promise<string> | null>(null);
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLElement | null>>>({});
  const mediaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ index: number; pointerId: number; timer: number; active: boolean } | null>(null);

  formRef.current = form;
  if (sheetId) sheetIdRef.current = sheetId;

  /* ---------------- 加载 ---------------- */

  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    setLoading(true);
    api
      .characterSheet(initialId)
      .then((res) => {
        if (!alive) return;
        const item = res?.item as CharacterSheet | undefined;
        if (!item) throw new Error("设定不存在");
        const next = payloadFromSheet(item);
        formRef.current = next;
        setSheet(item);
        setForm(next);
        setLoadError("");
      })
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : "加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [initialId, reloadKey]);

  /* ---------------- 会馆列表（选了「选择会馆」才请求） ---------------- */

  const guildsQuery = useQuery({
    queryKey: ["character-editor-guilds"],
    queryFn: () => api.guilds(),
    enabled: Boolean(user) && form.guild.mode === "existing",
    staleTime: 5 * 60_000,
  });
  const guildOptions: any[] = Array.isArray(guildsQuery.data?.guilds) ? guildsQuery.data!.guilds : [];

  const invalidate = useCallback(
    (target?: string) => {
      void queryClient.invalidateQueries({ queryKey: ["character-sheets-mine"] });
      if (target) void queryClient.invalidateQueries({ queryKey: ["character-sheet", target] });
    },
    [queryClient],
  );

  /** 无 id 时先建一个草稿角色（并发调用共用同一个 Promise） */
  const ensureId = useCallback(async (): Promise<string> => {
    if (sheetIdRef.current) return sheetIdRef.current;
    if (createRef.current) return createRef.current;
    const task = api
      .createCharacter()
      .then((res) => {
        const newId = String(res?.item?.id || "");
        if (!newId) throw new Error("新建角色失败");
        sheetIdRef.current = newId;
        setSheetId(newId);
        setSheet(res.item);
        invalidate(newId);
        return newId;
      })
      .finally(() => {
        createRef.current = null;
      });
    createRef.current = task;
    return task;
  }, [invalidate]);

  const ensureIdRef = useRef(ensureId);
  ensureIdRef.current = ensureId;

  /** 落盘草稿；dirty=false 时直接返回成功 */
  const flush = useCallback(async (): Promise<boolean> => {
    if (suppressedRef.current) return true;
    if (!dirtyRef.current) return true;
    if (!hasAnyContent(formRef.current)) {
      dirtyRef.current = false;
      setSaveState("idle");
      return true;
    }
    if (savingRef.current) {
      pendingRef.current = true;
      return false;
    }
    const version = changeVersionRef.current;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const targetId = await ensureIdRef.current();
      const res = await api.saveCharacterDraft(targetId, formRef.current);
      if (suppressedRef.current) return true;
      setSavedAt(res?.saved_at || new Date().toISOString());
      setSaveState(changeVersionRef.current === version ? "saved" : "dirty");
      if (changeVersionRef.current === version) dirtyRef.current = false;
      else pendingRef.current = true;
      invalidate(targetId);
      return true;
    } catch (error) {
      setSaveState("error");
      if (!dirtyRef.current) dirtyRef.current = true;
      showToast(error instanceof Error ? error.message : "自动保存失败", "error");
      return false;
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !suppressedRef.current) {
        pendingRef.current = false;
        window.setTimeout(() => {
          void flushRef.current();
        }, 200);
      }
    }
  }, [invalidate, showToast]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  /** 任意字段变更：更新本地 + 重置 3 秒自动保存 */
  const update = useCallback((patch: Partial<CharacterPayload>) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    dirtyRef.current = true;
    changeVersionRef.current += 1;
    setSaveState("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, AUTOSAVE_DELAY);
  }, []);

  /** 页面隐藏 / 卸载时立即落盘（关闭前 flush） */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      void flushRef.current();
    };
  }, []);

  /** 退出前把在途/待保存的改动落盘 */
  const requestClose = useCallback(async () => {
    if (closingRef.current || publishingRef.current) return;
    closingRef.current = true;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await flushRef.current();
    for (let index = 0; index < 12 && (savingRef.current || dirtyRef.current); index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      if (!savingRef.current && dirtyRef.current) await flushRef.current();
    }
    pop();
  }, [pop]);

  useEffect(() => {
    return registerBackHandler(() => {
      void requestClose();
      return true;
    });
  }, [requestClose]);

  /* ---------------- 分区定位 / 滚动高亮 ---------------- */


  const gotoSection = useCallback((key: SectionKey) => {
    setActiveSection(key);
    sectionRefs.current[key]?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (loading || loadError) return;
    const nodes = SECTIONS.map((section) => sectionRefs.current[section.key]).filter(Boolean) as HTMLElement[];
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const key = (entry.target as HTMLElement).dataset.section as SectionKey | undefined;
          if (key) setActiveSection(key);
        });
      },
      { rootMargin: "-64px 0px -60% 0px", threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [loading, loadError]);

  /* ---------------- 图片：选图 / 裁剪 / 上传 / 排序 ---------------- */

  const beginPick = useCallback(
    async (source: "gallery" | "camera") => {
      const kind = pickerKind;
      setPickerKind(null);
      if (!kind) return;
      try {
        const picked = await pickImage(source);
        if (picked?.path) setCrop({ path: picked.path, kind });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/取消|cancel|没有选择/i.test(message)) showToast(message || "选择图片失败", "error");
      }
    },
    [pickerKind, showToast],
  );

  const uploadCropped = useCallback(
    async (dataUrl: string, kind: MediaKind) => {
      setUploading(kind);
      try {
        const res = await uploadImageData(dataUrl, kind === "avatar" ? "character_avatar" : "character_image");
        const data: any = res.data;
        if (!res.ok || data?.success === false || !data?.id) {
          throw new Error(String(data?.message || "图片上传失败"));
        }
        const mediaId = String(data.id);
        if (kind === "avatar") {
          setUploadedAvatar(String(data.url || ""));
          update({ avatar_media_id: mediaId });
        } else {
          const next = [...formRef.current.image_media_ids, mediaId].filter(
            (value, index, list) => list.indexOf(value) === index,
          );
          update({ image_media_ids: next.slice(0, LIMITS.images) });
        }
        setCrop(null);
        showToast(kind === "avatar" ? "头像已更新" : "图片已添加");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "图片上传失败", "error");
      } finally {
        setUploading(null);
      }
    },
    [showToast, update],
  );

  const moveImage = useCallback(
    (from: number, to: number) => {
      const list = [...formRef.current.image_media_ids];
      if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      update({ image_media_ids: list });
    },
    [update],
  );

  const finishDrag = useCallback(() => {
    const state = dragRef.current;
    if (state?.timer) window.clearTimeout(state.timer);
    dragRef.current = null;
    setDragIndex(null);
  }, []);

  const finishDragRef = useRef(finishDrag);
  finishDragRef.current = finishDrag;

  /** 拖拽中在窗口层面兼听结束事件（手柄 capture 失败时也不会卡在拖拽态） */
  useEffect(() => {
    if (dragIndex === null) return;
    const stop = () => finishDragRef.current();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragIndex]);

  /** 长按手柄 200ms 进入拖拽（避免误触） */
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (formRef.current.image_media_ids.length < 2) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const timer = window.setTimeout(() => {
      const state = dragRef.current;
      if (!state || state.pointerId !== pointerId) return;
      state.active = true;
      state.timer = 0;
      setDragIndex(state.index);
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        /* 指针已释放：忽略 */
      }
      navigator.vibrate?.(8);
    }, 200);
    dragRef.current = { index, pointerId, timer, active: false };
    // 长按前就松手（或滑出）时取消：避免定时器在指针已释放后才把拖拽激活
    const cancelBeforeDrag = () => {
      if (!dragRef.current?.active) finishDragRef.current();
    };
    window.addEventListener("pointerup", cancelBeforeDrag, { once: true });
    window.addEventListener("pointercancel", cancelBeforeDrag, { once: true });
  };

  const onDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragRef.current;
    if (!state || !state.active || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nodes = mediaRef.current?.querySelectorAll<HTMLElement>("[data-media-index]");
    let target = state.index;
    nodes?.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        const index = Number(node.dataset.mediaIndex);
        if (Number.isFinite(index)) target = index;
      }
    });
    if (target !== state.index) {
      moveImage(state.index, target);
      state.index = target;
      setDragIndex(target);
    }
  };

  /* ---------------- 保存 / 发布 / 放弃 / 删除 ---------------- */

  const saveNow = useCallback(async () => {
    if (savingNow || publishing) return;
    if (!hasAnyContent(formRef.current)) {
      showToast("还没有可保存的内容", "error");
      return;
    }
    setSavingNow(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = true;
    const ok = await flushRef.current();
    if (ok) showToast("草稿已保存");
    else showToast("保存失败，请稍后重试", "error");
    setSavingNow(false);
  }, [publishing, savingNow, showToast]);

  const publish = useCallback(async () => {
    if (publishingRef.current) return;
    const message = validateLocal(formRef.current);
    if (message) {
      showToast(message, "error");
      return;
    }
    publishingRef.current = true;
    setPublishing(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      // 等在途草稿落盘，并抑制后续自动保存：否则旧草稿可能在发布后才写入
      for (let index = 0; index < 20 && savingRef.current; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      suppressedRef.current = true;
      pendingRef.current = false;
      const targetId = await ensureIdRef.current();
      const res = await api.publishCharacter(targetId, formRef.current);
      dirtyRef.current = false;
      setSaveState("idle");
      setSheet(res?.item || null);
      invalidate(targetId);
      showToast(Number(res?.item?.status) === 2 ? "已保存（当前被管理员下架，不会公开展示）" : "已发布");
      pop();
    } catch (error) {
      suppressedRef.current = false;
      showToast(error instanceof Error ? error.message : "发布失败", "error");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }, [invalidate, pop, showToast]);

  const discardDraft = useCallback(async () => {
    setConfirmDiscard(false);
    if (closingRef.current) return;
    closingRef.current = true;
    suppressedRef.current = true;
    dirtyRef.current = false;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const targetId = sheetIdRef.current;
    try {
      if (targetId) await api.deleteCharacterDraft(targetId);
      invalidate(targetId);
      showToast("已放弃草稿");
      pop();
    } catch (error) {
      closingRef.current = false;
      suppressedRef.current = false;
      showToast(error instanceof Error ? error.message : "操作失败", "error");
    }
  }, [invalidate, pop, showToast]);

  const deleteCharacter = useCallback(async () => {
    setConfirmDelete(false);
    if (closingRef.current) return;
    closingRef.current = true;
    suppressedRef.current = true;
    dirtyRef.current = false;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const targetId = sheetIdRef.current;
    if (!targetId) {
      pop();
      return;
    }
    try {
      await api.deleteCharacter(targetId);
      invalidate(targetId);
      queryClient.removeQueries({ queryKey: ["character-sheet", targetId] });
      showToast("角色已删除");
      pop();
    } catch (error) {
      closingRef.current = false;
      suppressedRef.current = false;
      showToast(error instanceof Error ? error.message : "删除失败", "error");
    }
  }, [invalidate, pop, queryClient, showToast]);

  /* ---------------- 派生值 ---------------- */

  const abilities = form.abilities;
  const quotes = form.quotes;
  const canAddAbility = abilities.length < LIMITS.abilities;
  const canAddQuote = quotes.length < LIMITS.quotes;
  const avatarSrc = uploadedAvatar || avatarUrl(mediaSrc(form.avatar_media_id));
  const images = form.image_media_ids.map((mediaId) => avatarUrl(mediaSrc(mediaId)));
  const notMine = Boolean(
    sheet && sheet.mine !== true && String(sheet.user_id || "") !== String(user?.id || ""),
  );
  const guildNameOf = (guildId: number) => {
    const found = guildOptions.find((option) => Number(option?.id) === Number(guildId));
    if (found?.name) return String(found.name);
    if (sheet && Number(sheet.guild_id) === Number(guildId)) return String(sheet.guild_name || "");
    return "";
  };
  const guildLabel =
    form.guild.mode === "existing"
      ? guildNameOf(form.guild.guild_id)
      : form.guild.mode === "custom"
        ? form.guild.custom_name.trim()
        : "";

  const appbar = (
    <AppBar
      back
      title={sheetId ? "编辑角色" : "新建角色"}
      actions={
        <>
          <SaveStatus state={saveState} onRetry={() => void flushRef.current()} />
          <IconButton icon="eye" label="预览角色" onClick={() => setPreviewOpen(true)} />
          <IconButton icon="more" label="更多操作" onClick={() => setMoreOpen(true)} />
        </>
      }
    />
  );

  if (!user) {
    return (
      <Screen appbar={appbar}>
        <Empty
          icon="user"
          title="登录后才能编辑角色"
          hint="登录后可以新建角色、自动保存草稿并发布。"
          action={
            <button type="button" className="m-btn m-btn--primary" onClick={() => push("auth")}>
              去登录
            </button>
          }
        />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen appbar={appbar}>
        <Loader text="加载角色设定" />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen appbar={appbar}>
        <Empty
          icon="info"
          title="角色加载失败"
          hint={loadError}
          action={
            <button type="button" className="m-btn" onClick={() => setReloadKey((value) => value + 1)}>
              重试
            </button>
          }
        />
      </Screen>
    );
  }

  if (notMine) {
    return (
      <Screen appbar={appbar}>
        <Empty
          icon="shield"
          title="无法编辑这份设定"
          hint="它不是你的角色设定，只能查看。"
          action={
            sheetId ? (
              <button type="button" className="m-btn" onClick={() => push("character-detail", { id: sheetId })}>
                查看详情
              </button>
            ) : null
          }
        />
      </Screen>
    );
  }

  return (
    <Screen
      appbar={appbar}
      bodyClassName="ce-body"
      footer={
        <div className="m-actionbar ce-footer">
          <button
            type="button"
            className="m-btn m-btn--soft ce-footer-save"
            disabled={publishing || savingNow || saveState === "saving"}
            onClick={() => void saveNow()}
          >
            {savingNow || saveState === "saving" ? "保存中…" : "保存草稿"}
          </button>
          <button
            type="button"
            className="m-btn m-btn--primary ce-footer-publish"
            disabled={publishing || uploading !== null}
            onClick={() => void publish()}
          >
            {publishing ? "发布中…" : sheet && Number(sheet.version) > 0 ? "发布新版本" : "发布"}
          </button>
        </div>
      }
    >
      <nav className="ce-nav" aria-label="表单分区">
        {SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`ce-chip ${activeSection === section.key ? "on" : ""}`.trim()}
            aria-current={activeSection === section.key ? "true" : undefined}
            onClick={() => gotoSection(section.key)}
          >
            {section.label}
            {section.key === "abilities" ? <span className="ce-chip-count">{abilities.length}</span> : null}
            {section.key === "media" ? <span className="ce-chip-count">{images.length}</span> : null}
            {section.key === "guild" ? <span className="ce-chip-count">{quotes.length}</span> : null}
          </button>
        ))}
      </nav>

      {/* 1. 基本档案 */}
      <section
        className="ce-section"
        data-section="basic"
        ref={(node) => {
          sectionRefs.current.basic = node;
        }}
      >
        <h2 className="ce-section-title">
          <Icon name="user" size={14} />
          基本档案
        </h2>
        <div className="ce-field">
          <span className="ce-field-head">
            <span className="ce-label">
              名字<i className="ce-required">*</i>
            </span>
            <span className="ce-count">
              {form.name.length}/{LIMITS.name}
            </span>
          </span>
          <input
            className="m-input"
            value={form.name}
            maxLength={LIMITS.name}
            placeholder="角色的名字"
            aria-label="名字"
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>
        <div className="ce-grid">
          <label className="ce-field">
            <span className="ce-label">别称</span>
            <input
              className="m-input"
              value={form.alias}
              maxLength={LIMITS.name}
              placeholder="可选"
              onChange={(event) => update({ alias: event.target.value })}
            />
          </label>
          <label className="ce-field">
            <span className="ce-label">称号</span>
            <input
              className="m-input"
              value={form.title}
              maxLength={LIMITS.name}
              placeholder="可选"
              onChange={(event) => update({ title: event.target.value })}
            />
          </label>
        </div>
      </section>

      {/* 2. 基础属性 */}
      <section
        className="ce-section"
        data-section="attrs"
        ref={(node) => {
          sectionRefs.current.attrs = node;
        }}
      >
        <h2 className="ce-section-title">
          <Icon name="sparkle" size={14} />
          基础属性
        </h2>
        <div className="ce-field">
          <span className="ce-label">性别</span>
          <Segmented
            items={GENDERS}
            value={String(form.gender)}
            onChange={(key) => update({ gender: Number(key) || 0 })}
          />
        </div>
        <div className="ce-grid">
          <label className="ce-field">
            <span className="ce-label">
              年龄<i className="ce-required">*</i>
            </span>
            <input
              className="m-input"
              value={form.age}
              maxLength={LIMITS.short}
              placeholder="如：三百余岁 / 不详"
              onChange={(event) => update({ age: event.target.value })}
            />
          </label>
          <label className="ce-field">
            <span className="ce-label">
              体态<i className="ce-required">*</i>
            </span>
            <input
              className="m-input"
              value={form.build}
              maxLength={LIMITS.short}
              placeholder="如：修长 / 娇小"
              onChange={(event) => update({ build: event.target.value })}
            />
          </label>
        </div>
        <div className="ce-chips" role="group" aria-label="体态预设">
          {BUILD_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`ce-chip ${form.build === preset ? "on" : ""}`.trim()}
              onClick={() => update({ build: preset })}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="ce-grid">
          <label className="ce-field">
            <span className="ce-label">物种</span>
            <input
              className="m-input"
              value={form.species}
              maxLength={LIMITS.short}
              placeholder="可选"
              onChange={(event) => update({ species: event.target.value })}
            />
          </label>
          <label className="ce-field">
            <span className="ce-label">身份</span>
            <input
              className="m-input"
              value={form.identity}
              maxLength={LIMITS.short}
              placeholder="可选"
              onChange={(event) => update({ identity: event.target.value })}
            />
          </label>
        </div>
      </section>

      {/* 3. 能力 */}
      <section
        className="ce-section"
        data-section="abilities"
        ref={(node) => {
          sectionRefs.current.abilities = node;
        }}
      >
        <h2 className="ce-section-title">
          <Icon name="sparkle" size={14} />
          能力
          <span className="ce-count ce-count--inline">
            {abilities.length}/{LIMITS.abilities}
          </span>
        </h2>
        {abilities.length === 0 ? <p className="ce-hint ce-hint--left">还没有能力，至少添加一项才能发布。</p> : null}
        {abilities.map((ability, index) => (
          <div className="ce-ability" key={`ability-${index}`}>
            <select
              className="ce-ability-select"
              value={ability.category}
              aria-label={`能力 ${index + 1} 类型`}
              onChange={(event) => {
                const next = formRef.current.abilities.map((item, position) =>
                  position === index ? { ...item, category: event.target.value } : item,
                );
                update({ abilities: next });
              }}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <input
              className="m-input"
              value={ability.detail}
              maxLength={LIMITS.abilityDetail}
              placeholder="具体能力（60 字内）"
              aria-label={`能力 ${index + 1} 说明`}
              onChange={(event) => {
                const next = formRef.current.abilities.map((item, position) =>
                  position === index ? { ...item, detail: event.target.value } : item,
                );
                update({ abilities: next });
              }}
            />
            <button
              type="button"
              className="ce-ability-del"
              aria-label={`删除能力 ${index + 1}`}
              onClick={() => update({ abilities: formRef.current.abilities.filter((_, position) => position !== index) })}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ce-add"
          disabled={!canAddAbility}
          onClick={() =>
            update({ abilities: [...formRef.current.abilities, { category: CATEGORIES[0], detail: "" }] })
          }
        >
          <Icon name="plus" size={15} />
          添加能力{canAddAbility ? "" : "（已达上限）"}
        </button>
      </section>

      {/* 4. 描述 */}
      <section
        className="ce-section"
        data-section="desc"
        ref={(node) => {
          sectionRefs.current.desc = node;
        }}
      >
        <h2 className="ce-section-title">
          <Icon name="grid" size={14} />
          角色描述
        </h2>
        <Suspense
          fallback={
            <div className="ce-editor-loading">
              <span className="m-spinner" />
              <span>编辑器加载中…</span>
            </div>
          }
        >
          <RichEditor
            value={form.description_html}
            onChange={(html) => update({ description_html: html })}
            placeholder="详细描写这个角色：来历、性格、与谁有关…"
            minHeight={220}
            scene="character_image"
            toolbar="full"
          />
        </Suspense>
        <p className="ce-hint ce-hint--left">正文里的插图留在描述中；图集请用下面的「头像与图片」。</p>
      </section>

      {/* 5. 头像与图片 */}
      <section
        className="ce-section"
        data-section="media"
        ref={(node) => {
          sectionRefs.current.media = node;
        }}
      >
        <h2 className="ce-section-title">
          <Icon name="image" size={14} />
          头像与图片
          <span className="ce-count ce-count--inline">
            {images.length}/{LIMITS.images}
          </span>
        </h2>
        <div className="ce-hero">
          <button
            type="button"
            className="ce-avatar"
            aria-label={form.avatar_media_id ? "更换角色头像" : "上传角色头像"}
            onClick={() => setPickerKind("avatar")}
            disabled={uploading === "avatar"}
          >
            {avatarSrc ? (
              <img src={avatarSrc} alt="角色头像" />
            ) : (
              <span className="ce-avatar-empty">
                <Icon name="user" size={26} />
              </span>
            )}
          </button>
          <div className="ce-hero-main">
            <span className="ce-label">角色头像</span>
            <p className="ce-hint ce-hint--left">按 1:1 裁剪，作为列表与详情的主图。</p>
            <div className="ce-hero-actions">
              <button
                type="button"
                className="m-btn m-btn--sm m-btn--soft"
                disabled={uploading === "avatar"}
                onClick={() => setPickerKind("avatar")}
              >
                {uploading === "avatar" ? "上传中…" : form.avatar_media_id ? "更换头像" : "上传头像"}
              </button>
              {form.avatar_media_id ? (
                <button
                  type="button"
                  className="m-btn m-btn--sm m-btn--ghost"
                  disabled={uploading === "avatar"}
                  onClick={() => {
                    setUploadedAvatar("");
                    update({ avatar_media_id: "" });
                  }}
                >
                  移除
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ce-sub">
          <span>角色图片</span>
          <span className="ce-count">
            {images.length}/{LIMITS.images}
          </span>
        </div>
        <div className="ce-media" ref={mediaRef}>
          {form.image_media_ids.map((mediaId, index) => (
            <div
              key={mediaId}
              className={`ce-media-slot ${dragIndex === index ? "is-drag" : ""}`.trim()}
              data-media-index={index}
            >
              <div className="ce-media-thumb">
                <img src={avatarUrl(mediaSrc(mediaId))} alt={`角色图片 ${index + 1}`} loading="lazy" />
                <button
                  type="button"
                  className="ce-media-handle"
                  aria-label={`长按拖动调整第 ${index + 1} 张图片的顺序`}
                  onPointerDown={(event) => startDrag(event, index)}
                  onPointerMove={onDragMove}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  onLostPointerCapture={finishDrag}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <Icon name="grip" size={15} />
                </button>
                <button
                  type="button"
                  className="ce-media-del"
                  aria-label={`移除第 ${index + 1} 张图片`}
                  onClick={() =>
                    update({ image_media_ids: formRef.current.image_media_ids.filter((_, position) => position !== index) })
                  }
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="ce-media-tools">
                <button
                  type="button"
                  aria-label={`第 ${index + 1} 张图片前移`}
                  disabled={index === 0}
                  onClick={() => moveImage(index, index - 1)}
                >
                  <Icon name="up" size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`第 ${index + 1} 张图片后移`}
                  disabled={index === form.image_media_ids.length - 1}
                  onClick={() => moveImage(index, index + 1)}
                >
                  <Icon name="down" size={14} />
                </button>
              </div>
            </div>
          ))}
          {images.length < LIMITS.images ? (
            <button
              type="button"
              className="ce-media-add"
              aria-label="添加角色图片"
              disabled={uploading === "image"}
              onClick={() => setPickerKind("image")}
            >
              <Icon name={uploading === "image" ? "refresh" : "plus"} size={22} />
            </button>
          ) : null}
        </div>
        <p className="ce-hint ce-hint--left">最多 3 张；长按左上角手柄可拖动排序，也可用下方按钮前后移动。</p>
      </section>

      {/* 6. 归属与语录 */}
      <section
        className="ce-section"
        data-section="guild"
        ref={(node) => {
          sectionRefs.current.guild = node;
        }}
      >
        <h2 className="ce-section-title">
          <Icon name="home" size={14} />
          归属与语录
        </h2>
        <div className="ce-field">
          <span className="ce-label">所属会馆</span>
          <Segmented
            items={GUILD_MODES}
            value={form.guild.mode}
            onChange={(mode) => {
              if (mode === "existing") {
                update({ guild: { ...formRef.current.guild, mode } });
                return;
              }
              if (mode === "custom") {
                update({ guild: { ...formRef.current.guild, mode } });
                return;
              }
              update({ guild: { mode: "none", guild_id: 0, custom_name: "" } });
            }}
          />
        </div>
        {form.guild.mode === "existing" ? (
          <div className="ce-field">
            <span className="ce-label">选择会馆</span>
            <select
              className="ce-select"
              value={form.guild.guild_id || 0}
              aria-label="选择会馆"
              onChange={(event) =>
                update({ guild: { ...formRef.current.guild, guild_id: Number(event.target.value) || 0 } })
              }
            >
              <option value={0}>请选择会馆…</option>
              {form.guild.guild_id > 0 && !guildOptions.some((option) => Number(option?.id) === form.guild.guild_id) && sheet?.guild_name ? (
                <option value={form.guild.guild_id}>{String(sheet.guild_name)}</option>
              ) : null}
              {guildOptions.map((option) => (
                <option key={String(option?.id)} value={Number(option?.id) || 0}>
                  {String(option?.name || "未命名会馆")}
                </option>
              ))}
            </select>
            {guildsQuery.isLoading ? (
              <span className="ce-hint ce-hint--left">会馆加载中…</span>
            ) : guildsQuery.isError ? (
              <span className="ce-hint ce-hint--left">会馆加载失败，可稍后重试</span>
            ) : guildOptions.length === 0 ? (
              <span className="ce-hint ce-hint--left">暂无可绑定的会馆</span>
            ) : (
              <span className="ce-hint ce-hint--left">绑定后角色会出现在该会馆的成员列表里。</span>
            )}
            {!form.guild.guild_id ? (
              <span className="ce-hint ce-hint--left ce-hint--warn">选好会馆后才能保存草稿</span>
            ) : null}
          </div>
        ) : null}
        {form.guild.mode === "custom" ? (
          <label className="ce-field">
            <span className="ce-label">会馆名称</span>
            <input
              className="m-input"
              value={form.guild.custom_name}
              maxLength={LIMITS.guild}
              placeholder="自填一个会馆名称（不绑定现有会馆）"
              onChange={(event) =>
                update({ guild: { ...formRef.current.guild, custom_name: event.target.value } })
              }
            />
          </label>
        ) : null}

        <div className="ce-sub">
          <span>语录</span>
          <span className="ce-count">
            {quotes.length}/{LIMITS.quotes}
          </span>
        </div>
        {quotes.length === 0 ? <p className="ce-hint ce-hint--left">可选：写几句能代表角色的话。</p> : null}
        {quotes.map((quote, index) => (
          <div className="ce-quote" key={`quote-${index}`}>
            <input
              className="m-input"
              value={quote.content}
              maxLength={LIMITS.quote}
              placeholder="一句能代表角色的话"
              aria-label={`语录 ${index + 1}`}
              onChange={(event) => {
                const next = formRef.current.quotes.map((item, position) =>
                  position === index ? { content: event.target.value } : item,
                );
                update({ quotes: next });
              }}
            />
            <div className="ce-row-tools">
              <button
                type="button"
                className="ce-mini"
                aria-label={`上移语录 ${index + 1}`}
                disabled={index === 0}
                onClick={() => {
                  const list = [...formRef.current.quotes];
                  const [moved] = list.splice(index, 1);
                  list.splice(index - 1, 0, moved);
                  update({ quotes: list });
                }}
              >
                <Icon name="up" size={14} />
              </button>
              <button
                type="button"
                className="ce-mini"
                aria-label={`下移语录 ${index + 1}`}
                disabled={index === quotes.length - 1}
                onClick={() => {
                  const list = [...formRef.current.quotes];
                  const [moved] = list.splice(index, 1);
                  list.splice(index + 1, 0, moved);
                  update({ quotes: list });
                }}
              >
                <Icon name="down" size={14} />
              </button>
              <button
                type="button"
                className="ce-mini ce-mini--danger"
                aria-label={`删除语录 ${index + 1}`}
                onClick={() => update({ quotes: formRef.current.quotes.filter((_, position) => position !== index) })}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="ce-add"
          disabled={!canAddQuote}
          onClick={() => update({ quotes: [...formRef.current.quotes, { content: "" }] })}
        >
          <Icon name="plus" size={15} />
          添加语录{canAddQuote ? "" : "（已达上限）"}
        </button>

        <button
          type="button"
          className="ce-switch"
          role="switch"
          aria-checked={form.quotes_visible}
          onClick={() => update({ quotes_visible: !formRef.current.quotes_visible })}
        >
          <span className="ce-switch-text">
            <strong>参与彩蛋展示</strong>
            <span>开启后语录有机会出现在站点的「彩蛋」里，所有访客可见；随时可关闭。</span>
          </span>
          <span className={`ce-toggle ${form.quotes_visible ? "on" : ""}`.trim()} aria-hidden="true" />
        </button>
      </section>

      <p className="ce-hint ce-hint--left ce-foot-note">
        草稿每 3 秒自动保存；「发布」前会校验名字、年龄、体态、至少一项能力与描述。
      </p>

      {/* 选图来源 */}
      <Sheet
        open={pickerKind !== null}
        title={pickerKind === "avatar" ? "更换角色头像" : "添加角色图片"}
        onClose={() => setPickerKind(null)}
      >
        <div className="m-list ce-picker">
          <Cell icon="image" label="从相册选择" onClick={() => void beginPick("gallery")} />
          <Cell label="拍照" sub="用相机拍一张" onClick={() => void beginPick("camera")} />
        </div>
        <p className="ce-hint">
          {pickerKind === "avatar"
            ? "头像会按 1:1 裁剪后再上传。"
            : "图片可自由裁剪（也支持 1:1 / 4:3），最多 3 张。"}
        </p>
      </Sheet>

      {/* 更多操作 */}
      <Sheet open={moreOpen} title="更多操作" onClose={() => setMoreOpen(false)}>
        <div className="ce-more-info">
          <span>{sheet ? statusLabel(sheet.status) : "尚未创建"}</span>
          {sheet?.updated_at ? <span>更新于 {timeAgo(sheet.updated_at)}</span> : null}
          {savedAt ? <span>草稿保存于 {clockText(savedAt) || formatDate(savedAt)}</span> : null}
        </div>
        <div className="m-list ce-more">
          <Cell
            icon="close"
            label="放弃草稿"
            sub="清除未发布的修改"
            danger
            onClick={() => {
              setMoreOpen(false);
              setConfirmDiscard(true);
            }}
          />
          {sheet && Number(sheet.status) !== 0 ? (
            <Cell
              icon="trash"
              label="删除角色"
              sub="删除整份设定，不可恢复"
              danger
              onClick={() => {
                setMoreOpen(false);
                setConfirmDelete(true);
              }}
            />
          ) : null}
        </div>
      </Sheet>

      {/* 预览 */}
      <Sheet
        open={previewOpen}
        title="角色预览"
        onClose={() => setPreviewOpen(false)}
        footer={
          <button type="button" className="m-btn m-btn--primary" onClick={() => setPreviewOpen(false)}>
            返回编辑
          </button>
        }
      >
        <div className="ce-preview">
          <div className="ce-preview-hero">
            {avatarSrc ? (
              <img className="ce-preview-avatar" src={avatarSrc} alt="角色头像" />
            ) : (
              <span className="ce-preview-avatar ce-preview-avatar--empty">
                <Icon name="user" size={28} />
              </span>
            )}
            <div className="ce-preview-id">
              <strong className="ce-preview-name">{form.name.trim() || "未命名角色"}</strong>
              {form.title.trim() ? <span className="ce-preview-title">{form.title}</span> : null}
              <div className="ce-preview-tags">
                {form.alias.trim() ? <span className="ce-preview-tag">别称 · {form.alias}</span> : null}
                <span className="ce-preview-tag">{genderLabel(form.gender)}</span>
                {form.age.trim() ? <span className="ce-preview-tag">{form.age}</span> : null}
                {form.build.trim() ? <span className="ce-preview-tag">{form.build}</span> : null}
                {form.species.trim() ? <span className="ce-preview-tag">{form.species}</span> : null}
                {form.identity.trim() ? <span className="ce-preview-tag">{form.identity}</span> : null}
                {guildLabel ? <span className="ce-preview-tag">{guildLabel}</span> : null}
              </div>
            </div>
          </div>

          {abilities.length > 0 ? (
            <div className="ce-preview-block">
              <h4>能力</h4>
              <div className="ce-preview-abilities">
                {abilities.map((ability, index) => (
                  <span className="ce-preview-ability" key={`preview-ability-${index}`}>
                    {ability.detail ? `${ability.category} · ${ability.detail}` : ability.category}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {quotes.some((quote) => quote.content.trim()) ? (
            <div className="ce-preview-block">
              <h4>语录</h4>
              <div className="ce-preview-quotes">
                {quotes
                  .filter((quote) => quote.content.trim())
                  .map((quote, index) => (
                    <blockquote className="ce-preview-quote" key={`preview-quote-${index}`}>
                      {quote.content}
                    </blockquote>
                  ))}
              </div>
            </div>
          ) : null}

          <div className="ce-preview-block">
            <h4>角色描述</h4>
            {plainText(form.description_html) ? (
              <div className="m-rich">
                <RichContent html={form.description_html} format="html" />
              </div>
            ) : (
              <p className="ce-preview-empty">还没有写角色描述。</p>
            )}
          </div>

          {images.length > 0 ? (
            <div className="ce-preview-block">
              <h4>图集</h4>
              <div className="ce-preview-images">
                {images.map((src, index) => (
                  <img key={`preview-image-${index}`} src={src} alt={`角色图片 ${index + 1}`} loading="lazy" />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Sheet>

      {/* 二次确认 */}
      <Confirm
        open={confirmDiscard}
        title="放弃草稿？"
        confirmText="放弃"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => void discardDraft()}
      >
        未发布的修改会被清除{sheet && Number(sheet.status) === 0 ? "，这个角色也会一起删除。" : "，已公开的内容保持不变。"}
      </Confirm>
      <Confirm
        open={confirmDelete}
        title="删除这个角色？"
        confirmText="删除"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteCharacter()}
      >
        角色设定与图片会被删除且无法恢复。
      </Confirm>

      {/* 裁剪浮层 */}
      {crop ? (
        <ImageCrop
          key={`${crop.kind}-${crop.path.slice(-24)}`}
          file={crop.path}
          mode={crop.kind === "avatar" ? "avatar" : "image"}
          onCancel={() => {
            if (!uploading) setCrop(null);
          }}
          onConfirm={(dataUrl) => void uploadCropped(dataUrl, crop.kind)}
        />
      ) : null}
    </Screen>
  );
}
