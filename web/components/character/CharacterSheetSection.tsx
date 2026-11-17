"use client";

// ===== 个人中心的「设定信息」区块 =====
// 位置：个人资料卡内、账号设置（更换邮箱/注销）之前；全宽。
// 多角色：头像胶囊切换；默认选中最近更新的已公开角色。
// 展开：移动端卡片内联；桌面端开悬浮窗（与世界频道同技术）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { useStore } from "@/lib/store";
import { useIsMobile } from "@/lib/use-mobile";
import { ApiException } from "@/lib/api";
import { characterApi, type CharacterSheet } from "@/lib/api/character";
import CharacterOnboardingModal from "./CharacterOnboardingModal";
import CharacterSheetCard from "./CharacterSheetCard";
import CharacterSheetSwitcher from "./CharacterSheetSwitcher";
import { useCharacterSheet } from "./CharacterSheetProvider";

export interface CharacterSheetSectionProps {
  userId: string;
  isSelf: boolean;
  /** 页面已注销时隐藏 */
  hidden?: boolean;
}

/** 个人中心设定区块。 */
export default function CharacterSheetSection({ userId, isSelf, hidden = false }: CharacterSheetSectionProps) {
  const { toast } = useToast();
  const { user } = useStore();
  const isMobile = useIsMobile();
  const { openEditor, openViewer, createAndEdit, creating, revision } = useCharacterSheet();

  const [sheets, setSheets] = useState<CharacterSheet[] | null>(null);
  const [promptSeen, setPromptSeen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [onboardDismissed, setOnboardDismissed] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await characterApi.byUser(userId);
      setSheets(r.items || []);
      setPromptSeen(r.prompt_seen ?? true);
      setLoadError("");
    } catch (e) {
      setSheets([]);
      setLoadError(e instanceof ApiException ? e.message : "设定加载失败");
    }
  }, [userId]);

  useEffect(() => {
    if (hidden) return;
    void load();
  }, [load, revision, hidden]);

  const published = useMemo(() => (sheets || []).filter((s) => s.status === 1), [sheets]);

  const active = useMemo(() => {
    if (!sheets || sheets.length === 0) return null;
    const found = activeId ? sheets.find((s) => s.id === activeId) : null;
    if (found) return found;
    return published[0] || sheets[0] || null;
  }, [sheets, activeId, published]);

  // 已有设定时无需再问，把引导标记落库（避免下次又弹）
  useEffect(() => {
    if (!isSelf || hidden || !sheets || promptSeen) return;
    if (sheets.length > 0) void characterApi.promptSeen().catch(() => {});
  }, [isSelf, hidden, sheets, promptSeen]);

  // 引导只在本人、无任何设定、服务端未标记、且本次未手动关闭时展示
  const showOnboard =
    isSelf && !hidden && sheets !== null && sheets.length === 0 && !promptSeen && !onboardDismissed;

  const dismissOnboard = useCallback(() => {
    setOnboardDismissed(true);
    setPromptSeen(true);
    void characterApi.promptSeen().catch(() => {});
  }, []);

  const handleCreate = useCallback(async () => {
    dismissOnboard();
    await createAndEdit();
  }, [dismissOnboard, createAndEdit]);

  const handleLike = async () => {
    if (!active) return;
    if (!user) {
      toast("登录后才能点赞", "info");
      return;
    }
    try {
      const r = await characterApi.like(active.id);
      setSheets((prev) =>
        prev
          ? prev.map((s) => (s.id === active.id ? { ...s, liked: r.liked, like_count: r.likes } : s))
          : prev
      );
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "操作失败", "error");
    }
  };

  const handleToggleExpand = () => {
    if (!active) return;
    if (isMobile) {
      setExpanded((v) => !v);
      return;
    }
    openViewer(active.id);
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    setExpanded(false);
  };

  if (hidden) return null;

  // 他人的主页：没有已公开设定就不展示这个区块
  if (!isSelf && sheets !== null && published.length === 0) return null;

  return (
    <section className="cs-section" id="user-character">
      <div className="cs-section-head">
        <h3>
          <i className="fa fa-id-card-o" aria-hidden="true"></i> 设定信息
        </h3>
        {sheets && sheets.length > 0 ? (
          <span className="cs-section-count">
            {published.length > 0 ? `${published.length} 个角色` : "草稿"}
            {isSelf && sheets.some((s) => s.status !== 1) ? " · 含草稿" : ""}
          </span>
        ) : null}
      </div>

      {loadError ? (
        <p className="cs-section-hint is-error">{loadError}</p>
      ) : sheets === null ? (
        <p className="cs-section-hint">设定加载中…</p>
      ) : sheets.length === 0 ? (
        <div className="cs-section-empty">
          <p>还没有设定记录。写下第一个角色的名字，他就在这里有了落脚的地方。</p>
          {isSelf ? (
            <button type="button" className="cs-btn cs-btn-primary" onClick={() => void createAndEdit()} disabled={creating}>
              <i className="fa fa-plus" aria-hidden="true"></i> 创建设定
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <CharacterSheetSwitcher
            sheets={sheets}
            activeId={active?.id ?? null}
            onSelect={handleSelect}
            onCreate={isSelf ? () => void createAndEdit() : undefined}
            creating={creating}
          />
          {active ? (
            <CharacterSheetCard
              sheet={active}
              expanded={isMobile && expanded}
              onToggleExpand={handleToggleExpand}
              onLike={active.mine ? undefined : handleLike}
              onEdit={isSelf ? () => openEditor(active.id) : undefined}
            />
          ) : null}
          {isSelf && active?.status !== 1 ? (
            <p className="cs-section-hint">
              草稿只有你自己能看到；点「完成并公开」后才会出现在主页上。
            </p>
          ) : null}
          {!isMobile && active?.status === 1 ? (
            <p className="cs-section-hint cs-section-hint-desktop">点「显示更多」会用悬浮窗展示完整设定，可拖拽、可调整大小。</p>
          ) : null}
        </>
      )}

      <CharacterOnboardingModal
        open={showOnboard}
        onClose={dismissOnboard}
        onCreate={() => void handleCreate()}
      />
    </section>
  );
}
