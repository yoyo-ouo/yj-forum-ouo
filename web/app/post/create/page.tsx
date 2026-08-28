"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import Markdown from "@/components/Markdown";
import { postApi, ApiException } from "@/lib/api";

const CATEGORIES = [
  { key: "general", label: "综合" },
  { key: "talk", label: "闲聊" },
  { key: "question", label: "求助" },
  { key: "share", label: "分享" },
  { key: "creative", label: "创作" },
];

const COMPLIANCE = [
  "遵守中华人民共和国相关法律法规，不得发布违法违规内容",
  "禁止涉及政治敏感、涉黄涉暴、血腥恐怖、毒品赌博等内容",
  "禁止人身攻击、谩骂侮辱、恶意引战、网络暴力等行为",
  "禁止发布广告、 spam、外链刷量、引流等垃圾信息",
  "禁止泄露他人或自己的隐私信息（真实姓名、电话、地址等）",
  "禁止侵犯他人知识产权，转载请注明出处或获得授权",
  "内容应与论坛主题（罗小黑战记及二次元文化）相关，鼓励友善交流",
  "违反以上规定的帖子将被删除，情节严重者将封禁账号",
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
      <div className="post-create-container">
        <div className="post-create-header">
          <a href="javascript:history.back()" className="post-create-back">
            <i className="fa fa-arrow-left"></i> 返回
          </a>
          <h1 className="post-create-title">发布新帖子</h1>
          <div style={{ width: 60 }}></div>
        </div>

        <div className="post-create-form">
          <div className="post-compliance-notice">
            <div className="post-compliance-header">
              <i className="fa fa-shield"></i>
              <span>发帖须知</span>
            </div>
            <ul className="post-compliance-list">
              {COMPLIANCE.map((li, i) => <li key={i}>{li}</li>)}
            </ul>
          </div>

          <div className="form-group">
            <label className="form-label">帖子分类</label>
            <div className="form-category-select" id="form-category-select">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  className={`category-chip ${category === c.key ? "active" : ""}`}
                  data-value={c.key}
                  onClick={() => setCategory(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">帖子标题</label>
            <input
              type="text"
              className="form-input"
              id="post-title-input"
              placeholder="请输入标题..."
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">帖子内容</label>
            <div className="form-html-warning">
              <i className="fa fa-markdown"></i> 支持 Markdown 语法，HTML 标签会被自动转义
            </div>
            <div className="form-editor-tabs">
              <button className={`editor-tab ${tab === "edit" ? "active" : ""}`} id="tab-edit" onClick={() => setTab("edit")}>编辑</button>
              <button className={`editor-tab ${tab === "preview" ? "active" : ""}`} id="tab-preview" onClick={() => setTab("preview")}>预览</button>
            </div>
            <div className="form-editor-container">
              <textarea
                className="form-editor"
                id="post-content-editor"
                placeholder="在此输入 Markdown 内容..."
                rows={14}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              {tab === "preview" && (
                <div className="form-preview" id="post-content-preview" ref={previewRef}>
                  <Markdown content={content} className="markdown-body" />
                </div>
              )}
            </div>
          </div>

          {err && <p style={{ color: "#ef4444", margin: "12px 0 0" }}>{err}</p>}

          <div className="form-actions">
            <button className="btn-cancel" onClick={() => router.back()}>取消</button>
            <button className="btn-submit" id="post-submit-btn" disabled={busy} onClick={submit}>
              <i className="fa fa-paper-plane"></i> {busy ? "发布中..." : "发布"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
