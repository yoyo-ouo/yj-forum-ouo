"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { postApi, ApiException } from "@/lib/api";
import { marked } from "marked";

const CATEGORIES = [
  { key: "general", label: "综合" },
  { key: "talk", label: "闲聊" },
  { key: "question", label: "求助" },
  { key: "share", label: "分享" },
  { key: "creative", label: "创作" },
];

export default function PostCreatePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const switchTab = (t: "edit" | "preview") => {
    setTab(t);
    if (t === "preview" && previewRef.current) {
      previewRef.current.innerHTML = marked.parse(content || "", { async: false }) as string;
    }
  };

  const submit = async () => {
    if (!title.trim()) return setErr("请输入标题");
    if (!content.trim()) return setErr("请输入内容");
    setBusy(true);
    try {
      const r = await postApi.create(title.trim(), content, category);
      router.push(`/post/${r.id}`);
    } catch (e) {
      setErr(e instanceof ApiException ? e.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header />
      <div className="forum-container" style={{ maxWidth: 800 }}>
        <div className="forum-header">
          <h1 className="forum-title">发布帖子</h1>
          <p className="forum-subtitle">请遵守社区规范，文明发言</p>
        </div>

        <div id="form-category-select" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={`category-chip ${category === c.key ? "active" : ""}`}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <input
          className="form-editor"
          style={{ fontSize: 16, padding: "12px 14px", marginBottom: 12 }}
          placeholder="标题（100字以内）"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button className={`forum-tab ${tab === "edit" ? "active" : ""}`} onClick={() => switchTab("edit")}>编辑</button>
          <button className={`forum-tab ${tab === "preview" ? "active" : ""}`} onClick={() => switchTab("preview")}>预览</button>
        </div>

        {tab === "edit" ? (
          <textarea
            className="form-editor"
            rows={14}
            placeholder="支持 Markdown 语法..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        ) : (
          <div ref={previewRef} className="markdown-body" style={{ minHeight: 200, border: "1px solid var(--color-border, #ddd)", borderRadius: 8, padding: 12 }} />
        )}

        {err && <p style={{ color: "#ef4444", marginTop: 12 }}>{err}</p>}

        <button className="submit-button" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
          {busy ? "发布中..." : "发布"}
        </button>
      </div>
    </>
  );
}
