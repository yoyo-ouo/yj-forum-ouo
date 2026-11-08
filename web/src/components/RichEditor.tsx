import React, { useCallback, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { pickImage, uploadImage } from "../lib/native";
import { useApp } from "../lib/store";
import { Icon, type IconName } from "./icons";

export function RichEditor({
  value,
  onChange,
  placeholder = "写点什么…",
  scene = "post_image",
  minHeight = 180,
  toolbar = "full",
  autoFocus = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  scene?: string;
  minHeight?: number;
  /** compact：常用工具一行（评论）；full：完整工具两行（发帖） */
  toolbar?: "compact" | "full";
  autoFocus?: boolean;
}) {
  const showToast = useApp((s) => s.showToast);
  const [moreOpen, setMoreOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } },
      } as any),
      Underline,
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    autofocus: autoFocus,
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  });

  const insertImage = useCallback(async () => {
    if (!editor) return;
    try {
      const picked = await pickImage("gallery");
      const res = await uploadImage(picked.path, scene);
      const data = res.data;
      if (!res.ok || !data?.success) throw new Error(data?.message || "上传失败");
      const src = data.url || (data.id ? `/ov2/api/media/${data.id}` : "");
      if (src) editor.chain().focus().setImage({ src }).run();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "图片上传失败", "error");
    }
  }, [editor, scene, showToast]);

  if (!editor) return <div className="m-editor-loading">编辑器加载中…</div>;

  const tool = (icon: IconName, active: boolean, onClick: () => void, label: string) => (
    <button type="button" key={label} aria-label={label} aria-pressed={active} title={label} className={`m-editor-tool ${active ? "on" : ""}`} onClick={onClick}>
      <Icon name={icon} size={19} />
    </button>
  );

  const openLink = () => {
    const previous = editor.getAttributes("link").href || "";
    setLinkValue(previous);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const raw = linkValue.trim();
    if (!raw) return;
    const href = /^(https?:\/\/|mailto:|\/)/i.test(raw) ? raw : `https://${raw}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  };

  const emojis = ["😀", "😂", "🥹", "😭", "😍", "🥳", "🌙", "✨", "🌿", "🍂", "❤️", "👍", "🎉", "🐾", "📖", "✉️"];

  return (
    <div className="m-editor">
      <div className="m-editor-tools">
        {tool("image", false, () => void insertImage(), "插入图片")}
        {tool("bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "加粗")}
        {tool("italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "斜体")}
        {tool("underline", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "下划线")}
        {tool("list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "列表")}
        {toolbar === "full" ? tool("quote", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "引用") : null}
        {toolbar === "full" ? tool("link", editor.isActive("link"), openLink, "链接") : null}
        <button
          type="button"
          className={`m-editor-tool m-editor-more ${moreOpen ? "on" : ""}`.trim()}
          aria-label="更多格式"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <Icon name="more" size={19} />
        </button>
      </div>
      {moreOpen ? (
        <div className="m-editor-tools m-editor-tools--more">
          {tool("bold", editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "大标题")}
          {tool("ordered", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "有序列表")}
          {tool("code", editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), "代码块")}
          {tool("link", editor.isActive("link"), openLink, "链接")}
          {tool("smile", emojiOpen, () => setEmojiOpen((open) => !open), "表情")}
          <button type="button" className="m-editor-tool m-editor-text" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
            清除格式
          </button>
        </div>
      ) : null}
      {linkOpen ? (
        <div className="m-editor-pop">
          <input
            value={linkValue}
            autoFocus
            placeholder="https://"
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") applyLink(); }}
          />
          <button type="button" onClick={applyLink}>插入</button>
          <button type="button" onClick={() => setLinkOpen(false)}>取消</button>
        </div>
      ) : null}
      {emojiOpen ? (
        <div className="m-editor-picker">
          {emojis.map((emoji) => (
            <button
              type="button"
              key={emoji}
              onClick={() => {
                editor.chain().focus().insertContent(emoji).run();
                setEmojiOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <div className="m-editor-body" style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
