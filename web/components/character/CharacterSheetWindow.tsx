"use client";

// 设定详情悬浮窗（桌面「显示更多」；移动端走卡片内联展开，不打开本窗）。

import { useEffect, useState } from "react";
import Link from "next/link";
import FloatingWindow from "@/components/ui/FloatingWindow";
import { useToast } from "@/components/Toast";
import { ApiException } from "@/lib/api";
import { characterApi, type CharacterSheet } from "@/lib/api/character";
import CharacterSheetCard from "./CharacterSheetCard";

export interface CharacterSheetWindowProps {
  sheetId: string;
  onClose: () => void;
  onLikeChange?: (liked: boolean, likes: number) => void;
}

/** 只读设定浮窗。 */
export default function CharacterSheetWindow({ sheetId, onClose, onLikeChange }: CharacterSheetWindowProps) {
  const { toast } = useToast();
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    characterApi
      .detail(sheetId)
      .then((r) => {
        if (alive) setSheet(r.item);
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiException ? e.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [sheetId]);

  const handleLike = async () => {
    if (!sheet) return;
    try {
      const r = await characterApi.like(sheet.id);
      setSheet({ ...sheet, liked: r.liked, like_count: r.likes });
      onLikeChange?.(r.liked, r.likes);
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "操作失败", "error");
    }
  };

  return (
    <FloatingWindow
      open
      onClose={onClose}
      title={<>{sheet?.name || "角色设定"}</>}
      headerExtra={
        sheet ? (
          <span className="cs-window-head-extra">
            {sheet.status === 1 ? <span className="cs-status cs-status-1">已公开</span> : null}
            <Link href={`/character/${sheet.id}`} className="cs-window-action" title="在新页面打开完整设定">
              <i className="fa fa-external-link" aria-hidden="true"></i>
              <span>单独打开</span>
            </Link>
          </span>
        ) : null
      }
      storageKeyPrefix="ouo:character-viewer-v2"
      defaultWidth={720}
      defaultHeight={560}
      minWidth={400}
      minHeight={420}
      placement="right"
      titleId="cs-viewer-title"
      closeAriaLabel="关闭设定"
      classes={{
        root: "cs-window",
        header: "cs-window-header",
        titleWrap: "cs-window-title-wrap",
        title: "cs-window-title",
        close: "cs-window-close",
        body: "cs-window-body",
        overlay: "cs-overlay",
        resizeHandle: "cs-resize",
      }}
      className="cs-viewer"
    >
      {error ? (
        <div className="cs-editor-state is-error">{error}</div>
      ) : !sheet ? (
        <div className="cs-editor-state">加载中…</div>
      ) : (
        <div className="cs-viewer-inner">
          <CharacterSheetCard sheet={sheet} expanded hideExpand onLike={sheet.mine ? undefined : handleLike} showOwner />
          {sheet.owner_name ? (
            <div className="cs-viewer-foot">
              <Link href={`/users/${sheet.user_id}`} className="cs-viewer-owner">
                来自 {sheet.owner_name} 的个人主页
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </FloatingWindow>
  );
}
