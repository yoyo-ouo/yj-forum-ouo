import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { Avatar, EmptyState, Loading, RichContent, TopBar } from "../components/ui";
import { timeAgo } from "../lib/format";

/** 性别：0 无 / 1 男 / 2 女（与后端一致，0 不展示） */
function genderLabel(value: any): string {
  if (Number(value) === 1) return "男";
  if (Number(value) === 2) return "女";
  return "";
}

export function CharacterScreen() {
  const user = useApp((s) => s.user);
  const { push } = useNav();
  const mine = useQuery({
    queryKey: ["character-sheets-mine", user?.id],
    queryFn: () => api.characterSheetsMine(),
    enabled: Boolean(user?.id),
  });

  if (!user) {
    return (
      <div className="screen">
        <TopBar title="角色设定" back />
        <div className="empty" style={{ paddingTop: 72 }}>
          <div className="empty-mark">◇</div>
          <p>登录后查看你的角色设定</p>
          <button className="btn primary" onClick={() => push("auth")}>登录 / 注册</button>
        </div>
      </div>
    );
  }

  const items: any[] = mine.data?.items || [];

  return (
    <div className="screen">
      <TopBar title="角色设定" back />
      {mine.isLoading ? (
        <Loading />
      ) : mine.error ? (
        <EmptyState
          text={mine.error instanceof Error ? mine.error.message : "加载失败"}
          action={<button className="btn ghost" onClick={() => void mine.refetch()}>重试</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState text="还没有角色设定，可以在网页端创建后在这里查看" />
      ) : (
        <>
          <div className="section-head"><strong>我的角色设定</strong><span className="small muted">{items.length} 个</span></div>
          {items.map((item: any) => (
            <div key={item.id} className="character-card" onClick={() => push("character-detail", { id: item.id })}>
              <div className="row">
                <Avatar src={item.avatar} name={item.name} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row between">
                    <strong style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name || "未命名角色"}
                    </strong>
                    <span className="pill" style={{ color: item.status === 1 ? "var(--color-secondary)" : "var(--color-text-tertiary)" }}>
                      {item.status === 1 ? "已公开" : "草稿"}
                    </span>
                  </div>
                  <div className="small muted" style={{ marginTop: 3 }}>{item.title || item.alias || "角色设定卡"}</div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {[item.guild_name, item.like_count ? `♡ ${item.like_count}` : "", timeAgo(item.updated_at || item.created_at)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
      <div className="me-footer">角色设定卡在网页端创建与编辑，APP 内可随时查看。</div>
    </div>
  );
}

export function CharacterDetailScreen({ id }: { id?: string | number }) {
  const sheetId = id === undefined || id === null ? "" : String(id);
  const detail = useQuery({
    queryKey: ["character-sheet", sheetId],
    queryFn: () => api.characterSheet(sheetId),
    enabled: Boolean(sheetId),
  });

  if (detail.isLoading) {
    return <div className="screen"><TopBar title="角色设定" back /><Loading /></div>;
  }

  const item = detail.data?.item;
  if (!item) {
    return (
      <div className="screen">
        <TopBar title="角色设定" back />
        <EmptyState text={detail.error instanceof Error ? detail.error.message : "角色设定不存在或未公开"} />
      </div>
    );
  }

  const body = item.description_html || item.content_html || item.content || "";
  const format = item.content_format || "html";
  const meta = [
    genderLabel(item.gender),
    item.age ? `年龄 ${item.age}` : "",
    item.build ? `体态 ${item.build}` : "",
    item.species ? `物种 ${item.species}` : "",
  ].filter(Boolean) as string[];
  const abilities: any[] = Array.isArray(item.abilities) ? item.abilities : [];
  const guild = item.guild_name || item.guild_custom_name || "";

  return (
    <div className="screen">
      <TopBar title={item.name || "角色设定"} back />
      <div className="profile-hero">
        <div className="profile-top">
          <Avatar src={item.avatar} name={item.name} size={64} />
          <div style={{ flex: 1 }}>
            <div className="profile-name">{item.name || "未命名角色"}</div>
            <div className="profile-sub">{[item.title, item.alias].filter(Boolean).join(" · ") || "角色设定"}</div>
            {item.owner_name ? <div className="profile-sub">设定者：{item.owner_name}</div> : null}
          </div>
        </div>
        {meta.length > 0 ? (
          <div className="chip-row" style={{ marginTop: 12 }}>
            {meta.map((text) => <span key={text} className="pill">{text}</span>)}
          </div>
        ) : null}
        {item.identity ? <div className="profile-intro">身份：{item.identity}</div> : null}
        {guild ? <div className="profile-intro">所属：{guild}</div> : null}
      </div>

      <div className="section-title">设定正文</div>
      <div className="info-card">
        {body ? <RichContent html={body} format={format} /> : <p className="small muted">这个角色还没有填写设定正文。</p>}
      </div>

      {abilities.length > 0 ? (
        <>
          <div className="section-title">能力</div>
          <div className="info-card">
            {abilities.map((ability: any, index: number) => (
              <div key={`${ability?.category || "ability"}-${index}`} className="row" style={{ alignItems: "flex-start", marginBottom: 6 }}>
                <span className="pill" style={{ flex: "0 0 auto" }}>{ability?.category || "未知"}</span>
                <span className="small" style={{ flex: 1 }}>{ability?.detail || "—"}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="me-footer">
        {item.status === 1 ? "已公开" : "草稿（仅自己可见）"}
        {item.published_at ? ` · 发布于 ${timeAgo(item.published_at)}` : ""}
      </div>
    </div>
  );
}
