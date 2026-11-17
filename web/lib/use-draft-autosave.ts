"use client";

// ===== 帖子草稿自动保存 =====
// 约定：任意改动 3 秒防抖后自动保存；首次保存时若还没有草稿记录，先创建再写。
// 设计要点：
//   - 保存失败不会丢弃本地内容（dirty 保持 true），下一次改动或手动「重试」会再试；
//   - 发布/放弃草稿前调用 suppress()，阻止卸载时把刚删除的草稿又写回来；
//   - 页面隐藏 / 卸载时尽力落盘，浏览器真正关闭时由 beforeunload 兜底提示。

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiException, postDraftApi, type PostDraftPayload } from "@/lib/api";

export type DraftSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** 自动保存防抖时长（产品要求：有新的更改则 3 秒后保存） */
export const DRAFT_AUTOSAVE_DELAY = 3000;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export interface UseDraftAutosaveOptions {
  /** 打开已有草稿时传入其 id；新建时传 null */
  initialDraftId: string | null;
  /** 读取当前表单快照（用 ref 保存，定时器触发时总是拿最新值） */
  getPayload: () => PostDraftPayload;
  /** 是否已有可创建草稿的实际内容（标题或正文）；空页面不建草稿 */
  hasContent: () => boolean;
}

export interface DraftAutosave {
  draftId: string | null;
  saveState: DraftSaveState;
  savedAt: string | null;
  saveError: string;
  /** 表单发生改动：标记 dirty 并重置 3 秒防抖 */
  markDirty: () => void;
  /** 立即保存（返回是否成功；无改动时直接返回 true）；keepalive=true 用于页面卸载 */
  flush: (keepalive?: boolean) => Promise<boolean>;
  /** 等待在途保存并确保最新内容落盘（发布/离开前调用）；返回是否已无未保存内容 */
  waitForIdle: () => Promise<boolean>;
  /** 读取当前草稿 id（刚创建、state 尚未刷新时也能拿到） */
  getDraftId: () => string | null;
  /** 暂停自动保存（可恢复；放弃草稿的删除请求期间使用） */
  pause: () => void;
  /** 恢复自动保存（删除失败时回滚 pause） */
  resume: () => void;
  /** 永久停止自动保存（发布/放弃成功后的导航前调用） */
  suppress: () => void;
  /** 手动重试失败的保存 */
  retry: () => void;
}

export function useDraftAutosave({
  initialDraftId,
  getPayload,
  hasContent,
}: UseDraftAutosaveOptions): DraftAutosave {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [saveState, setSaveState] = useState<DraftSaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");

  const draftIdRef = useRef<string | null>(initialDraftId);
  const getPayloadRef = useRef(getPayload);
  const hasContentRef = useRef(hasContent);
  const dirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const suppressedRef = useRef(false);
  // 暂停可回滚（删除草稿请求期间）；suppress 才是永久停止
  const pausedRef = useRef(false);
  // 仅「保存成功后主动离开」才放行 beforeunload；草稿被删等异常仍保留离开提示
  const allowUnloadRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // 每次渲染后刷新快照函数（定时器/卸载回调读的都是最新值）
  useEffect(() => {
    getPayloadRef.current = getPayload;
    hasContentRef.current = hasContent;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(async (keepalive = false): Promise<boolean> => {
    if (suppressedRef.current || pausedRef.current) return true;
    // 在途保存：登记 pending，由 finally 续跑，避免并发 PUT 覆盖新内容
    if (savingRef.current) {
      pendingRef.current = true;
      return false;
    }
    if (!dirtyRef.current) return true;
    clearTimer();

    const version = changeVersionRef.current;
    const payload = getPayloadRef.current();
    let id = draftIdRef.current;
    // 没有草稿且还没有实际内容：什么都不写，避免空草稿堆积
    if (!id && !hasContentRef.current()) {
      dirtyRef.current = false;
      if (mountedRef.current) setSaveState("idle");
      return true;
    }

    savingRef.current = true;
    if (mountedRef.current) {
      setSaveState("saving");
      setSaveError("");
    }
    try {
      if (!id) {
        const created = await postDraftApi.create(keepalive);
        id = created.id;
        draftIdRef.current = id;
        if (mountedRef.current) setDraftId(id);
      }
      const r = await postDraftApi.save(id, payload, keepalive);
      if (suppressedRef.current) return true;
      if (mountedRef.current) {
        setSavedAt(r.saved_at || new Date().toISOString());
        setSaveError("");
        if (changeVersionRef.current === version) {
          dirtyRef.current = false;
          setSaveState("saved");
        } else {
          // 保存期间又有新改动：保持 dirty，稍后再存一轮
          dirtyRef.current = true;
          setSaveState("dirty");
          pendingRef.current = true;
        }
      }
      return true;
    } catch (e) {
      if (mountedRef.current) {
        setSaveState("error");
        if (e instanceof ApiException && e.status === 404) {
          // 草稿已在别处删除：清空 id，下一轮自动保存另存为新草稿（文字内容不丢）
          draftIdRef.current = null;
          setDraftId(null);
          dirtyRef.current = true;
          pendingRef.current = true;
          setSaveError("草稿已在别处删除，正在另存为新的草稿…");
        } else {
          setSaveError(e instanceof ApiException ? e.message : "自动保存失败");
        }
      }
      return false;
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !suppressedRef.current) {
        pendingRef.current = false;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void flushRef.current();
        }, 200);
      }
    }
  }, [clearTimer]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const markDirty = useCallback(() => {
    if (suppressedRef.current || pausedRef.current) return;
    dirtyRef.current = true;
    changeVersionRef.current += 1;
    if (mountedRef.current) setSaveState("dirty");
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, DRAFT_AUTOSAVE_DELAY);
  }, [clearTimer]);

  const waitForIdle = useCallback(async (): Promise<boolean> => {
    clearTimer();
    for (let i = 0; i < 30 && savingRef.current; i += 1) await sleep(100);
    if (dirtyRef.current) {
      const ok = await flushRef.current();
      if (!ok) return false;
    }
    for (let i = 0; i < 30 && savingRef.current; i += 1) await sleep(100);
    return !dirtyRef.current;
  }, [clearTimer]);

  const getDraftId = useCallback(() => draftIdRef.current, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearTimer();
  }, [clearTimer]);

  const resume = useCallback(() => {
    pausedRef.current = false;
    if (suppressedRef.current) return;
    if (hasContentRef.current()) {
      dirtyRef.current = true;
      changeVersionRef.current += 1;
      if (mountedRef.current) setSaveState("dirty");
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flushRef.current();
      }, DRAFT_AUTOSAVE_DELAY);
    }
  }, [clearTimer]);

  const suppress = useCallback(() => {
    suppressedRef.current = true;
    allowUnloadRef.current = true;
    dirtyRef.current = false;
    clearTimer();
  }, [clearTimer]);

  const retry = useCallback(() => {
    if (suppressedRef.current) return;
    dirtyRef.current = true;
    void flushRef.current();
  }, []);

  // 页面隐藏 / 关闭时尽力落盘；卸载时也保存一次（SPA 内部跳转）
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flushRef.current(true);
    };
    const onPageHide = () => {
      void flushRef.current(true);
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  // 组件卸载：清理定时器并最后尝试保存
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      if (dirtyRef.current && !suppressedRef.current) void flushRef.current(true);
    };
  }, [clearTimer]);

  // 还有未保存内容时，真正关闭/刷新页面给出原生提示（自动保存 3 秒空窗兜底）
  useEffect(() => {
    if (saveState !== "dirty" && saveState !== "saving" && saveState !== "error") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowUnloadRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  return { draftId, saveState, savedAt, saveError, markDirty, flush, waitForIdle, getDraftId, pause, resume, suppress, retry };
}
