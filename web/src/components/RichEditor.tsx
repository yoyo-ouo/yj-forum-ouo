import React, { useCallback, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { pickImage, uploadImage } from "../lib/native";
import { useApp } from "../lib/store";

export function RichEditor({
  value,
  onChange,
  placeholder = "写点什么…",
  scene = "post_image",
  minHeight = 180,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  scene?: string;
  minHeight?: number;
}) {
  const showToast = useApp((s) => s.showToast);
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

  if (!editor) return <div className="editor-loading">编辑器加载中…</div>;

  const button = (label: string, active: boolean, onClick: () => void, title?: string) => (
    <button type="button" title={title} className={`editor-tool ${active ? "on" : ""}`} onClick={onClick}>
      {label}
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
    <div className="rich-editor">
      <div className="editor-toolbar">
        {button("H2", editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "二级标题")}
        {button("H3", editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "三级标题")}
        {button("B", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "加粗")}
        {button("I", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "斜体")}
        {button("U", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "下划线")}
        {button("≡", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "无序列表")}
        {button("1.", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "有序列表")}
        {button("❝", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "引用")}
        {button("</>", editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), "代码块")}
        {button("`", editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), "行内代码")}
        {button("🔗", editor.isActive("link"), openLink, "插入链接")}
        {button("⛓", false, () => editor.chain().focus().unsetLink().run(), "移除链接")}
        {button("▧", false, () => void insertImage(), "插入图片")}
        {button("—", false, () => editor.chain().focus().setHorizontalRule().run(), "分割线")}
        {button("Tx", false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), "清除格式")}
        {button("☺", emojiOpen, () => setEmojiOpen((open) => !open), "表情")}
      </div>
      {linkOpen ? (
        <div className="link-pop">
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
        <div className="emoji-pop">
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
      <div className="editor-body" style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
