"use client";

// 角色切换胶囊：头像 + 名字（可横向滚动）；草稿/下架角色带角标。

import { characterMediaUrl, type CharacterSheet } from "@/lib/api/character";

export interface CharacterSheetSwitcherProps {
  sheets: CharacterSheet[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  creating?: boolean;
}

/** 角色胶囊条。 */
export default function CharacterSheetSwitcher({
  sheets,
  activeId,
  onSelect,
  onCreate,
  creating = false,
}: CharacterSheetSwitcherProps) {
  if (sheets.length === 0) return null;
  return (
    <div className="cs-switcher" role="tablist" aria-label="角色列表">
      {sheets.map((sheet) => {
        const initial = (sheet.name || "?").trim().slice(0, 1) || "?";
        const avatar = sheet.avatar || characterMediaUrl(sheet.avatar_media_id);
        return (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={sheet.id === activeId}
            className={`cs-chip${sheet.id === activeId ? " active" : ""}`}
            onClick={() => onSelect(sheet.id)}
            title={sheet.name || "未命名角色"}
          >
            <span className="cs-chip-avatar">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" />
              ) : (
                initial
              )}
            </span>
            <span className="cs-chip-name">{sheet.name || "未命名角色"}</span>
            {sheet.status === 0 ? <span className="cs-chip-draft">草稿</span> : null}
            {sheet.status === 2 ? <span className="cs-chip-draft cs-chip-hidden">已下架</span> : null}
          </button>
        );
      })}
      {onCreate ? (
        <button type="button" className="cs-chip cs-chip-add" onClick={onCreate} disabled={creating}>
          <span className="cs-chip-avatar" aria-hidden="true">
            {creating ? <i className="fa fa-spinner fa-spin"></i> : "+"}
          </span>
          <span className="cs-chip-name">新建角色</span>
        </button>
      ) : null}
    </div>
  );
}
