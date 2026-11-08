import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { EmptyState, Loading, RichContent, Sheet, TopBar } from "../components/ui";
import { formatDate, stripHtml, textLimit } from "../lib/format";
import {
  INFINITE_EPOCH,
  astronomicalToInfinite,
  formatGregorianYear,
  formatInfiniteYear,
  infiniteToAstronomical,
  parseSignedYear,
  signedToAstronomical,
} from "../lib/year";

/* ======================
 * 指南
 * ==================== */

interface GuideNode {
  id: string;
  parent_id?: string | null;
  title?: string;
  kind?: string;
  sort?: number;
  updated_at?: string;
  content?: string;
  content_format?: string;
}

interface TreeNode {
  node: GuideNode;
  children: TreeNode[];
}

interface FlatNode {
  node: GuideNode;
  depth: number;
  expandable: boolean;
  open: boolean;
}

/** 把接口返回的扁平节点组装为多叉树（parent 缺失时当作根节点） */
function buildTree(nodes: GuideNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  nodes.forEach((node) => map.set(String(node.id), { node, children: [] }));
  const roots: TreeNode[] = [];
  nodes.forEach((node) => {
    const item = map.get(String(node.id));
    if (!item) return;
    const parent = node.parent_id ? map.get(String(node.parent_id)) : undefined;
    if (parent && parent !== item) parent.children.push(item);
    else roots.push(item);
  });
  return roots;
}

/** 按展开状态展平树，便于单列渲染 */
function flattenTree(rows: TreeNode[], collapsed: Set<string>, depth = 0, out: FlatNode[] = []): FlatNode[] {
  rows.forEach(({ node, children }) => {
    const key = String(node.id);
    const expandable = node.kind === "folder" || children.length > 0;
    const open = expandable && !collapsed.has(key);
    out.push({ node, depth, expandable, open });
    if (open && children.length > 0) flattenTree(children, collapsed, depth + 1, out);
  });
  return out;
}

export function GuideScreen() {
  const { push } = useNav();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useQuery({ queryKey: ["guides"], queryFn: () => api.guides(), staleTime: 5 * 60_000 });
  const nodes: GuideNode[] = useMemo(() => tree.data?.data?.nodes || tree.data?.nodes || [], [tree.data]);
  const rows = useMemo(() => flattenTree(buildTree(nodes), collapsed), [nodes, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="screen">
      <TopBar title="论坛指南" back />
      {tree.isLoading ? (
        <Loading />
      ) : tree.error ? (
        <EmptyState
          text={tree.error instanceof Error ? tree.error.message : "加载失败"}
          action={<button className="btn ghost" onClick={() => void tree.refetch()}>重试</button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState text="暂无指南内容" />
      ) : (
        <div className="me-group" style={{ marginTop: 10 }}>
          {rows.map(({ node, depth, expandable, open }) => (
            <div
              key={node.id}
              className="guide-node"
              style={{ paddingLeft: 14 + depth * 16 }}
              onClick={() => (node.kind === "folder" ? toggle(String(node.id)) : push("guide", { id: node.id }))}
            >
              <span className="muted" style={{ width: 14, flex: "0 0 auto", textAlign: "center" }}>
                {expandable ? (open ? "▾" : "▸") : "·"}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{node.title || "未命名"}</span>
              {node.kind === "folder" ? <span className="small muted">目录</span> : <span className="muted">›</span>}
            </div>
          ))}
        </div>
      )}
      <div className="me-footer">指南由站务维护，按目录分类。</div>
    </div>
  );
}

export function GuideDetailScreen({ id }: { id?: string | number }) {
  const guideId = id === undefined || id === null ? "" : String(id);
  const detail = useQuery({
    queryKey: ["guide", guideId],
    queryFn: () => api.guide(guideId),
    enabled: Boolean(guideId),
  });

  if (detail.isLoading) return <div className="screen"><TopBar title="指南" back /><Loading /></div>;

  const node: GuideNode | undefined = detail.data?.data?.node || detail.data?.node;
  if (!node) {
    return (
      <div className="screen">
        <TopBar title="指南" back />
        <EmptyState text={detail.error instanceof Error ? detail.error.message : "指南不存在"} />
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title={node.title || "指南"} back />
      <div className="screen-pad" style={{ paddingTop: 12 }}>
        <h1 className="detail-title">{node.title || "指南"}</h1>
        {node.updated_at ? <div className="detail-meta"><span>更新于 {formatDate(node.updated_at)}</span></div> : null}
      </div>
      <div className="info-card">
        {node.content ? (
          <RichContent html={node.content} format={node.content_format || "html"} />
        ) : (
          <p className="small muted">这篇指南还没有正文。</p>
        )}
      </div>
    </div>
  );
}

/* ======================
 * 反馈（Bug 报告）
 * ==================== */

const BUG_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: "未处理", color: "#e6803d" },
  1: { label: "处理中", color: "#3b82f6" },
  2: { label: "已处理", color: "#22a06b" },
  3: { label: "已关闭", color: "#8a8f8e" },
};

function bugStatus(status: any): { label: string; color: string } {
  return BUG_STATUS[Number(status)] || { label: "未知", color: "var(--color-text-tertiary)" };
}

export function FeedbackScreen() {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const list = useQuery({ queryKey: ["bug-reports"], queryFn: () => api.bugReports(1, 20) });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [steps, setSteps] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const items: any[] = list.data?.data?.items || list.data?.items || [];

  const submit = async () => {
    setError("");
    if (!title.trim()) return setError("请填写反馈标题");
    if (!detail.trim()) return setError("请描述你遇到的问题");
    setBusy(true);
    try {
      await api.createBugReport({
        title: title.trim(),
        detail: detail.trim(),
        steps: steps.trim(),
        contact: contact.trim(),
        page_url: typeof window === "undefined" ? "" : window.location.href,
      });
      setOpen(false);
      setTitle("");
      setDetail("");
      setSteps("");
      setContact("");
      showToast("反馈已提交，感谢！");
      void list.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <TopBar
        title="反馈"
        back
        actions={<button className="btn primary sm" onClick={() => { setError(""); setOpen(true); }}>提交反馈</button>}
      />

      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <EmptyState
          text={list.error instanceof Error ? list.error.message : "加载失败"}
          action={<button className="btn ghost" onClick={() => void list.refetch()}>重试</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState text="还没有公开反馈" />
      ) : (
        <>
          {items.map((item: any) => {
            const status = bugStatus(item.status);
            return (
              <div key={item.id} className="info-card" onClick={() => push("feedback-detail", { id: item.id })}>
                <div className="row between">
                  <h4 style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title || "无标题反馈"}
                  </h4>
                  <span className="pill" style={{ flex: "0 0 auto", color: status.color }}>{status.label}</span>
                </div>
                {item.detail ? <p>{textLimit(String(item.detail), 120)}</p> : null}
                <div className="meta">#{item.id} · {formatDate(item.created_at)}</div>
              </div>
            );
          })}
          <div className="me-footer">反馈公开可见（不含提交人信息），请勿在描述中填写隐私内容。</div>
        </>
      )}

      <Sheet
        open={open}
        title="提交反馈"
        onClose={() => setOpen(false)}
        footer={
          <div className="row">
            <button className="btn ghost" style={{ flex: 1 }} disabled={busy} onClick={() => setOpen(false)}>取消</button>
            <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => void submit()}>{busy ? "提交中…" : "提交"}</button>
          </div>
        }
      >
        <div className="field">
          <label>标题</label>
          <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="一句话说明问题" />
        </div>
        <div className="field">
          <label>详细描述</label>
          <textarea className="textarea" value={detail} maxLength={5000} onChange={(e) => setDetail(e.target.value)} placeholder="发生了什么？在哪个页面？" />
        </div>
        <div className="field">
          <label>复现步骤（可选）</label>
          <textarea className="textarea" value={steps} maxLength={3000} style={{ minHeight: 72 }} onChange={(e) => setSteps(e.target.value)} placeholder="1. 打开… 2. 点击…" />
        </div>
        <div className="field">
          <label>联系方式（可选）</label>
          <input className="input" value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} placeholder="邮箱 / QQ，仅站务可见" />
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="form-hint">反馈内容会公开显示，但不会展示你的用户名与联系方式。</div>
      </Sheet>
    </div>
  );
}

export function FeedbackDetailScreen({ id }: { id?: string | number }) {
  const reportId = id === undefined || id === null ? "" : String(id);
  const detail = useQuery({
    queryKey: ["bug-report", reportId],
    queryFn: () => api.bugReport(reportId),
    enabled: Boolean(reportId),
  });

  if (detail.isLoading) return <div className="screen"><TopBar title="反馈详情" back /><Loading /></div>;

  const report = detail.data?.data?.report || detail.data?.report;
  const logs: any[] = detail.data?.data?.logs || detail.data?.logs || [];
  if (!report) {
    return (
      <div className="screen">
        <TopBar title="反馈详情" back />
        <EmptyState text={detail.error instanceof Error ? detail.error.message : "反馈不存在"} />
      </div>
    );
  }

  const status = bugStatus(report.status);

  return (
    <div className="screen">
      <TopBar title="反馈详情" back />
      <div className="screen-pad" style={{ paddingTop: 12 }}>
        <h1 className="detail-title">{report.title || "无标题反馈"}</h1>
        <div className="detail-meta">
          <span className="pill" style={{ color: status.color }}>{status.label}</span>
          <span>#{report.id}</span>
          <span>{formatDate(report.created_at)}</span>
        </div>
      </div>

      <div className="info-card">
        <h4>问题描述</h4>
        <p style={{ whiteSpace: "pre-wrap" }}>{report.detail || "—"}</p>
      </div>

      {report.steps ? (
        <div className="info-card">
          <h4>复现步骤</h4>
          <p style={{ whiteSpace: "pre-wrap" }}>{report.steps}</p>
        </div>
      ) : null}

      {logs.length > 0 ? (
        <div className="info-card">
          <h4>处理进度</h4>
          {logs.map((log: any, index: number) => (
            <div key={index} className="row between small" style={{ padding: "4px 0" }}>
              <span>{log?.note || bugStatus(log?.to_status).label}</span>
              <span className="muted">{formatDate(log?.created_at)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="me-footer">反馈状态：未处理 → 处理中 → 已处理 / 已关闭。</div>
    </div>
  );
}

/* ======================
 * 更新日志
 * ==================== */

export function ChangelogScreen() {
  const list = useQuery({ queryKey: ["changelogs"], queryFn: () => api.changelogs(1, 30) });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const items: any[] = list.data?.items || list.data?.data?.items || [];

  return (
    <div className="screen">
      <TopBar title="更新日志" back />
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <EmptyState
          text={list.error instanceof Error ? list.error.message : "加载失败"}
          action={<button className="btn ghost" onClick={() => void list.refetch()}>重试</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState text="暂无更新日志" />
      ) : (
        items.map((item: any, index: number) => {
          const key = String(item.id ?? item.version ?? index);
          const open = Boolean(expanded[key]);
          return (
            <div key={key} className="info-card">
              <div className="row between" onClick={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="pill">{item.version || "更新"}</span>
                    <strong style={{ fontSize: 14 }}>{item.title || "更新日志"}</strong>
                  </div>
                  <div className="meta">{formatDate(item.published_at)}</div>
                </div>
                <span className="small muted">{open ? "收起" : "展开"}</span>
              </div>
              {open ? (
                item.content_html ? (
                  <div style={{ marginTop: 10 }}><RichContent html={item.content_html} format="html" /></div>
                ) : (
                  <p className="small muted">暂无详细内容</p>
                )
              ) : item.content_html ? (
                <p style={{ marginTop: 8 }}>{textLimit(stripHtml(item.content_html), 120)}</p>
              ) : null}
            </div>
          );
        })
      )}
      <div className="me-footer">更新日志只展示已发布的版本。</div>
    </div>
  );
}

/* ======================
 * 年制换算（纯前端）
 * ==================== */

type Direction = "toGregorian" | "toInfinite";

interface ConversionView {
  error?: string;
  label?: string;
  note?: string;
}

export function YearConverterScreen() {
  const [direction, setDirection] = useState<Direction>("toGregorian");
  const [infiniteInput, setInfiniteInput] = useState("");
  const [gregorianInput, setGregorianInput] = useState("");

  const result = useMemo<ConversionView>(() => {
    if (direction === "toGregorian") {
      const raw = infiniteInput.trim();
      if (!raw) return { note: "输入无限年后自动换算。" };
      const signed = parseSignedYear(raw);
      if (signed === null) return { error: "请输入有效的无限年年份（可填「元年」）。" };
      if (signed === 0) return { error: "无限历没有 0 年：无限元年即公元 1604 年。" };
      const year = Math.abs(signed);
      const before = signed < 0;
      const astronomical = infiniteToAstronomical(year, before ? "before" : "after");
      if (before) {
        return {
          label: formatGregorianYear(astronomical),
          note: `${formatInfiniteYear(year, true)} = ${INFINITE_EPOCH} − ${year} = 天文纪年 ${astronomical}。`,
        };
      }
      return {
        label: formatGregorianYear(astronomical),
        note:
          year === 1
            ? `无限元年 = 公元 ${INFINITE_EPOCH} 年（天文纪年 ${astronomical}）。`
            : `无限元年 = 公元 ${INFINITE_EPOCH} 年；无限 ${year} 年 = ${INFINITE_EPOCH} + ${year} − 1 = 天文纪年 ${astronomical}。`,
      };
    }

    const raw = gregorianInput.trim();
    if (!raw) return { note: "输入公元年后自动换算。" };
    const signed = parseSignedYear(raw);
    if (signed === null) return { error: "请输入有效的公元年份（-1 = 公元前 1 年，可填「元年」）。" };
    const astronomical = signedToAstronomical(signed);
    if (astronomical === null) return { error: "公元纪年没有 0 年：公元前 1 年之后就是公元 1 年。" };
    const infinite = astronomicalToInfinite(astronomical);
    return {
      label: formatInfiniteYear(infinite.year, infinite.before),
      note:
        astronomical >= INFINITE_EPOCH
          ? `公元 ${signed} 年 = 天文纪年 ${astronomical}；${astronomical} − ${INFINITE_EPOCH} + 1 = ${formatInfiniteYear(infinite.year, false)}。`
          : `公元前 ${-signed} 年 = 天文纪年 ${astronomical}；比公元 ${INFINITE_EPOCH} 年早 ${INFINITE_EPOCH - astronomical} 年，即${formatInfiniteYear(infinite.year, true)}。`,
    };
  }, [direction, infiniteInput, gregorianInput]);

  const today = new Date();
  const todayInfinite = astronomicalToInfinite(today.getFullYear());

  return (
    <div className="screen">
      <TopBar title="年制换算" back />
      <div className="tabs">
        <button className={`tab-item ${direction === "toGregorian" ? "on" : ""}`} onClick={() => setDirection("toGregorian")}>无限年 → 公元年</button>
        <button className={`tab-item ${direction === "toInfinite" ? "on" : ""}`} onClick={() => setDirection("toInfinite")}>公元年 → 无限年</button>
      </div>

      <div className="screen-pad">
        <div className="field">
          <label>{direction === "toGregorian" ? "无限年" : "公元年"}</label>
          <input
            className="input"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            value={direction === "toGregorian" ? infiniteInput : gregorianInput}
            onChange={(e) => (direction === "toGregorian" ? setInfiniteInput(e.target.value) : setGregorianInput(e.target.value))}
            placeholder={direction === "toGregorian" ? "例如 423，或 -12 表示无限前 12 年" : "例如 2026，或 -1 表示公元前 1 年"}
          />
          <div className="form-hint">在数字前加「-」表示「前」；两套纪年都没有 0 年。</div>
        </div>
      </div>

      <div className="version-card">
        <div className="version-label">{direction === "toGregorian" ? "换算为公元纪年" : "换算为无限纪年"}</div>
        <div className="version-num">{result.error ? "无法换算" : result.label || "—"}</div>
        {result.error ? <div className="form-error">{result.error}</div> : null}
        {result.note ? <div className="form-hint">{result.note}</div> : null}
      </div>

      <div className="section-title">换算规则</div>
      <div className="info-card">
        <h4>无限元年 = 公元 1604 年</h4>
        <p>无限 N 年 = 公元 (1604 + N − 1) 年；公元 1604 年之前记为「无限前 N 年」，无限前 1 年 = 公元 1603 年 = 公元前 1 年。</p>
        <p>两套纪年都从 1 起算，没有 0 年；公元前用负数输入：-1 = 公元前 1 年（天文纪年 0）。</p>
        <div className="meta">示例：无限元年 ⇄ 公元 1604 年 · 无限前 1604 年 ⇄ 公元前 1 年</div>
      </div>
      <div className="me-footer">今天是公元 {today.getFullYear()} 年，即{formatInfiniteYear(todayInfinite.year, todayInfinite.before)}。</div>
    </div>
  );
}
