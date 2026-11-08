import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { TopBar } from "../components/ui";
import { RichEditor } from "../components/RichEditor";
import { CATEGORY_LABELS } from "../lib/format";

export function ComposeScreen() {
  const user = useApp((s) => s.user);
  const showToast = useApp((s) => s.showToast);
  const { push, replace, pop } = useNav();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const [guildUuid, setGuildUuid] = useState("");
  const [content, setContent] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const guilds = useQuery({ queryKey: ["guilds"], queryFn: () => api.guilds(), staleTime: 5 * 60_000 });

  if (!user) {
    return (
      <div className="screen">
        <TopBar title="发帖" back />
        <div className="empty">
          <div className="empty-mark">✎</div>
          <p>登录后才能发帖</p>
          <button className="btn primary" onClick={() => push("auth")}>去登录</button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!title.trim()) return showToast("请填写标题", "error");
    if (!content.replace(/<[^>]+>/g, "").trim()) return showToast("请填写正文", "error");
    setSubmitting(true);
    try {
      const res = await api.createPost({
        title: title.trim(),
        content,
        category,
        guild_uuid: guildUuid || undefined,
        published_at: publishedAt ? new Date(publishedAt).toISOString() : undefined,
      });
      showToast("发布成功");
      replace("post", { id: res.id });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "发布失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen">
      <TopBar
        title="发帖"
        back
        actions={<button className="btn primary sm" disabled={submitting} onClick={() => void submit()}>{submitting ? "发布中…" : "发布"}</button>}
      />
      <div className="screen-pad" style={{ paddingTop: 12 }}>
        <div className="field">
          <label>标题</label>
          <input className="input" value={title} maxLength={100} placeholder="一句话说清楚你的帖子" onChange={(e) => setTitle(e.target.value)} />
          <div className="form-hint">{title.length} / 100</div>
        </div>
        <div className="field">
          <label>分类</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>发到会馆（可选）</label>
          <select className="select" value={guildUuid} onChange={(e) => setGuildUuid(e.target.value)}>
            <option value="">公共空间</option>
            {(guilds.data?.guilds || []).map((guild: any) => (
              <option key={guild.uuid || guild.id} value={guild.uuid || String(guild.id)}>{guild.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>正文</label>
          <RichEditor value={content} onChange={setContent} placeholder="写点值得被看见的东西…" minHeight={220} scene="post_image" />
        </div>
        <div className="field">
          <label>定时发布（可选）</label>
          <input className="input" type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} />
          <div className="form-hint">留空则立即发布；定时帖在到点前仅自己可见。</div>
        </div>
        <button className="btn ghost block" onClick={pop}>取消</button>
      </div>
    </div>
  );
}
