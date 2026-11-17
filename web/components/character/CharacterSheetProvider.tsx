"use client";

// ===== 设定全局状态 =====
// 编辑器与详情浮窗都挂在根布局，任何页面都可通过 openEditor / openViewer 唤起；
// revision 用于通知个人中心重新拉取列表。

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/Toast";
import { useStore } from "@/lib/store";
import { ApiException } from "@/lib/api";
import { characterApi } from "@/lib/api/character";
import dynamic from "next/dynamic";

// 编辑器与详情窗按需加载：避免把 TipTap/ProseMirror 打进全站共享 chunk
const CharacterSheetEditor = dynamic(() => import("./CharacterSheetEditor"), { ssr: false });
const CharacterSheetWindow = dynamic(() => import("./CharacterSheetWindow"), { ssr: false });

export interface CharacterSheetContextValue {
  openEditor: (sheetId: string) => void;
  openViewer: (sheetId: string) => void;
  /** 新建一个空角色并直接进入编辑 */
  createAndEdit: () => Promise<void>;
  closeAll: () => void;
  creating: boolean;
  revision: number;
  editorSheetId: string | null;
  viewerSheetId: string | null;
}

const CharacterSheetContext = createContext<CharacterSheetContextValue>({
  openEditor: () => {},
  openViewer: () => {},
  createAndEdit: async () => {},
  closeAll: () => {},
  creating: false,
  revision: 0,
  editorSheetId: null,
  viewerSheetId: null,
});

export function CharacterSheetProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const { user } = useStore();
  const [editorSheetId, setEditorSheetId] = useState<string | null>(null);
  const [viewerSheetId, setViewerSheetId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const creatingRef = useRef(false);

  const bump = useCallback(() => setRevision((v) => v + 1), []);

  const openEditor = useCallback((sheetId: string) => {
    if (!sheetId) return;
    setViewerSheetId(null);
    setEditorSheetId(sheetId);
  }, []);

  const openViewer = useCallback((sheetId: string) => {
    if (!sheetId) return;
    setViewerSheetId(sheetId);
  }, []);

  const closeAll = useCallback(() => {
    setEditorSheetId(null);
    setViewerSheetId(null);
  }, []);

  const createAndEdit = useCallback(async () => {
    if (creatingRef.current) return;
    if (!user) {
      toast("登录后才能创建设定", "info");
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    try {
      const r = await characterApi.create();
      openEditor(r.item.id);
      bump();
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "创建失败", "error");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [user, toast, openEditor, bump]);

  return (
    <CharacterSheetContext.Provider
      value={{
        openEditor,
        openViewer,
        createAndEdit,
        closeAll,
        creating,
        revision,
        editorSheetId,
        viewerSheetId,
      }}
    >
      {children}
      {editorSheetId ? (
        <CharacterSheetEditor
          key={editorSheetId}
          sheetId={editorSheetId}
          onClose={() => {
            setEditorSheetId(null);
            bump();
          }}
          onSaved={bump}
        />
      ) : null}
      {viewerSheetId ? (
        <CharacterSheetWindow
          key={viewerSheetId}
          sheetId={viewerSheetId}
          onClose={() => setViewerSheetId(null)}
          onLikeChange={bump}
        />
      ) : null}
    </CharacterSheetContext.Provider>
  );
}

export function useCharacterSheet(): CharacterSheetContextValue {
  return useContext(CharacterSheetContext);
}
