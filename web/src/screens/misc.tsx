import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { requestApi } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { EmptyState, Loading, RichContent, Sheet, TopBar } from "../components/ui";
import { formatDate, stripHtml, textLimit, timeAgo } from "../lib/format";
import { astronomicalToInfinite, infiniteToAstronomical } from "../lib/year";
import type { GregorianEra, InfiniteEra } from "../lib/year";
// 仅本页需要的移动端适配（内边距收窄 / 容器复位），不改 main.tsx 与共享样式
import "../styles/misc-page.css";

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

/**
 * 目录树：逐层渲染 Web 的 .guide-tree / .guide-tree-item 结构，
 * folder 用 caret 图标展开收起，doc 点击进入正文（App 用独立详情页，替代 Web 右侧正文列）。
 */
function GuideTree({
  rows,
  depth = 0,
  collapsed,
  onToggle,
  onOpen,
}: {
  rows: TreeNode[];
  depth?: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="guide-tree">
      {rows.map(({ node, children }) => {
        const id = String(node.id);
        const isFolder = node.kind === "folder";
        const open = !collapsed.has(id);
        return (
          <li key={id} className="guide-tree-item">
            {isFolder ? (
              <button
                type="button"
                className="guide-tree-folder"
                style={{ paddingLeft: 10 + depth * 16 }}
                onClick={() => onToggle(id)}
                aria-expanded={open}
              >
                <i className={`fa ${open ? "fa-caret-down" : "fa-caret-right"} guide-tree-caret`} aria-hidden="true" />
                <i className="fa fa-folder-o guide-tree-icon" aria-hidden="true" />
                <span className="guide-tree-text">{node.title || "未命名"}</span>
              </button>
            ) : (
              <button
                type="button"
                className="guide-tree-doc"
                style={{ paddingLeft: 10 + depth * 16 + 18 }}
                onClick={() => onOpen(id)}
              >
                <i className="fa fa-file-text-o guide-tree-icon" aria-hidden="true" />
                <span className="guide-tree-text">{node.title || "未命名"}</span>
              </button>
            )}
            {children.length > 0 && (isFolder ? open : true) ? (
              <GuideTree rows={children} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} onOpen={onOpen} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function GuideScreen() {
  const { push } = useNav();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useQuery({ queryKey: ["guides"], queryFn: () => api.guides(), staleTime: 5 * 60_000 });
  const nodes: GuideNode[] = useMemo(() => tree.data?.data?.nodes || tree.data?.nodes || [], [tree.data]);
  const rows = useMemo(() => buildTree(nodes), [nodes]);

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
      <div className="forum-container guide-page">
        <div className="forum-header">
          <h1 className="forum-title">论坛指南</h1>
          <p className="forum-subtitle">使用说明与玩法介绍</p>
        </div>

        <aside className="guide-sidebar" aria-label="指南目录">
          {tree.isLoading ? (
            <Loading />
          ) : tree.error ? (
            <EmptyState
              text={tree.error instanceof Error ? tree.error.message : "加载失败"}
              action={<button className="btn ghost" onClick={() => void tree.refetch()}>重试</button>}
            />
          ) : nodes.length === 0 ? (
            <EmptyState text="暂无指南内容" />
          ) : (
            <GuideTree
              rows={rows}
              collapsed={collapsed}
              onToggle={toggle}
              onOpen={(id) => push("guide", { id })}
            />
          )}
        </aside>
      </div>
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
      <div className="forum-container guide-page">
        <main className="guide-content">
          <article className="guide-doc">
            <h2 className="guide-doc-title">{node.title || "指南"}</h2>
            {node.updated_at ? <div className="guide-doc-meta">更新于 {formatDate(node.updated_at)}</div> : null}
            {node.content ? (
              <div className="guide-doc-body">
                <RichContent html={node.content} format={node.content_format || "html"} />
              </div>
            ) : (
              <p className="small muted">这篇指南还没有正文。</p>
            )}
          </article>
        </main>
      </div>
    </div>
  );
}

/* ======================
 * 反馈（Bug 报告）
 * ==================== */

const FEEDBACK_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: "未处理", color: "#e6803d" },
  1: { label: "处理中", color: "#3b82f6" },
  2: { label: "已处理", color: "#22a06b" },
  3: { label: "关闭", color: "#8a97a3" },
};

function feedbackStatus(status: unknown): { label: string; color: string } {
  return FEEDBACK_STATUS[Number(status)] || { label: "未知", color: "#8a97a3" };
}

/** 状态 pill：浅底深字，与 Web 的 .feedback-status-pill 一致（十六进制 + 透明度后缀） */
function FeedbackStatusPill({ status }: { status?: number | null }) {
  const meta = feedbackStatus(status);
  return (
    <span className="feedback-status-pill" style={{ background: `${meta.color}1f`, color: meta.color }}>
      {meta.label}
    </span>
  );
}

interface BugReportItem {
  id: number;
  title?: string;
  detail?: string;
  status?: number;
  created_at?: string | null;
}

interface BugReportLogItem {
  from_status?: number | null;
  to_status?: number;
  note?: string;
  created_at?: string | null;
}

interface BugReport {
  id: number;
  title?: string;
  detail?: string;
  steps?: string;
  status?: number;
  created_at?: string | null;
}

const FEEDBACK_PAGE_SIZE = 12;

/**
 * 反馈列表分页：api.ts 的 bugReports 没暴露 status 参数，而 Web 的四态筛选是服务端过滤，
 * 这里按同一口径直接调 /reports/bug（与 messages.tsx 直调 requestApi 的做法一致）。
 */
async function fetchBugReportPage(status: number | null, page: number, pageSize: number) {
  const res = await requestApi<any>({
    method: "GET",
    path: "/reports/bug",
    query: {
      ...(status === null ? {} : { status: String(status) }),
      page: String(page),
      page_size: String(pageSize),
    },
  });
  const body: any = res.data;
  if (!res.ok || body?.success === false) {
    throw new ApiError(String(body?.message || "反馈加载失败"), body?.code ? String(body.code) : undefined, res.status);
  }
  const data: any = body?.data || body || {};
  return {
    items: (data.items || []) as BugReportItem[],
    total: Number(data.total || 0),
    hasMore: Boolean(data.has_more),
  };
}

/** 四态统计（失败时返回空数组，不影响列表浏览） */
async function fetchBugReportStats(): Promise<Array<{ status: number; count: number }>> {
  try {
    const res = await requestApi<any>({ method: "GET", path: "/reports/bug/stats" });
    const body: any = res.data;
    if (!res.ok || body?.success === false) return [];
    const stats = body?.data?.stats || body?.stats;
    return Array.isArray(stats) ? stats : [];
  } catch {
    return [];
  }
}

export function FeedbackScreen() {
  const { push } = useNav();
  const showToast = useApp((s) => s.showToast);
  const [statusFilter, setStatusFilter] = useState<number | null>(null);
  const [items, setItems] = useState<BugReportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState("");
  // 请求序号：快速切换四态筛选时丢弃过期响应
  const listSeq = useRef(0);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [steps, setSteps] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stats = useQuery({
    queryKey: ["bug-report-stats"],
    queryFn: fetchBugReportStats,
    staleTime: 60_000,
    retry: 0,
  });

  const loadList = useCallback(async (status: number | null, page: number, append: boolean) => {
    const seq = ++listSeq.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    if (!append) setListError("");
    try {
      const result = await fetchBugReportPage(status, page, FEEDBACK_PAGE_SIZE);
      if (seq !== listSeq.current) return;
      setItems((prev) => (append ? [...prev, ...result.items] : result.items));
      setTotal(result.total);
      setHasMore(result.hasMore);
    } catch (err) {
      if (seq !== listSeq.current) return;
      if (!append) {
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setListError(err instanceof Error ? err.message : "加载失败");
      }
    } finally {
      if (seq === listSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadList(statusFilter, 1, false);
  }, [statusFilter, loadList]);

  const countOf = (status: number) => (stats.data || []).find((item) => Number(item.status) === status)?.count ?? 0;
  const statsTotal = (stats.data || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  // 「全部」计数：优先用四态统计，统计未返回时回退列表接口的 total
  const allCount = (stats.data || []).length > 0 ? statsTotal : total;

  const openSubmit = () => {
    setError("");
    setOpen(true);
  };

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
      void loadList(statusFilter, 1, false);
      void stats.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const chips: Array<{ key: number | null; label: string; count: number }> = [
    { key: null, label: "全部", count: allCount },
    ...([0, 1, 2, 3] as const).map((status) => ({
      key: status as number | null,
      label: FEEDBACK_STATUS[status].label,
      count: countOf(status),
    })),
  ];

  return (
    <div className="screen">
      <TopBar title="反馈中心" back />
      <div className="forum-container feedback-page">
        <div className="forum-header">
          <h1 className="forum-title">反馈中心</h1>
          <p className="forum-subtitle">公开查看反馈与处理进度</p>
        </div>

        {/* 四态统计：大数字 + 小字标签，可点击筛选 */}
        <div className="feedback-stats-section">
          <div className="feedback-stats-title">反馈处理情况</div>
          <div className="feedback-stats">
            {([0, 1, 2, 3] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={`feedback-stat ${statusFilter === status ? "active" : ""}`}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              >
                <span className="feedback-stat-num">{countOf(status)}</span>
                <span className="feedback-stat-label">{FEEDBACK_STATUS[status].label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 状态筛选 chips + 提交反馈入口 */}
        <div className="feedback-toolbar">
          <div className="feedback-chips">
            {chips.map((chip) => (
              <button
                key={chip.key === null ? "all" : chip.key}
                type="button"
                className={`feedback-chip ${statusFilter === chip.key ? "active" : ""}`}
                onClick={() => setStatusFilter(chip.key)}
              >
                {chip.label} <span className="feedback-chip-count">{chip.count}</span>
              </button>
            ))}
          </div>
          <button type="button" className="forum-create-btn" onClick={openSubmit}>
            <i className="fa fa-bug" aria-hidden="true" /> 提交反馈
          </button>
        </div>

        {loading ? (
          <Loading />
        ) : listError ? (
          <EmptyState
            text={listError}
            action={<button className="btn ghost" onClick={() => void loadList(statusFilter, 1, false)}>重试</button>}
          />
        ) : items.length === 0 ? (
          <EmptyState text="暂无反馈" />
        ) : (
          <div className="feedback-waterfall">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="feedback-card"
                onClick={() => push("feedback-detail", { id: item.id })}
              >
                <span className="feedback-card-top">
                  <FeedbackStatusPill status={item.status} />
                  <span className="feedback-card-anon">匿名</span>
                </span>
                <span className="feedback-card-title">{item.title || "无标题反馈"}</span>
                {item.detail ? <span className="feedback-card-summary">{item.detail}</span> : null}
                <span className="feedback-card-time">{timeAgo(item.created_at)}</span>
              </button>
            ))}
          </div>
        )}

        {!loading && !listError && hasMore ? (
          <div className="forum-load-more">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadList(statusFilter, Math.ceil(items.length / FEEDBACK_PAGE_SIZE) + 1, true)}
            >
              {loadingMore ? "加载中..." : "加载更多"}
            </button>
          </div>
        ) : null}
      </div>

      <Sheet open={open} title="提交反馈" onClose={() => setOpen(false)}>
        <form
          className="feedback-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="feedback-form-label" htmlFor="feedback-title">
            标题 <span className="feedback-required">*</span>
          </label>
          <input
            id="feedback-title"
            className="feedback-form-input"
            placeholder="一句话描述问题或建议"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label className="feedback-form-label" htmlFor="feedback-detail">
            详细描述 <span className="feedback-required">*</span>
          </label>
          <textarea
            id="feedback-detail"
            className="feedback-form-input feedback-form-textarea"
            placeholder="请尽量描述清楚：你期望的结果与实际发生的情况"
            rows={6}
            maxLength={5000}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />

          <label className="feedback-form-label" htmlFor="feedback-steps">
            复现步骤 <span className="feedback-form-optional">（选填）</span>
          </label>
          <textarea
            id="feedback-steps"
            className="feedback-form-input feedback-form-textarea"
            placeholder="例如：1. 打开首页；2. 点击……；3. 出现……"
            rows={4}
            maxLength={3000}
            value={steps}
            onChange={(event) => setSteps(event.target.value)}
          />

          <label className="feedback-form-label" htmlFor="feedback-contact">
            联系方式 <span className="feedback-form-optional">（选填，仅管理员可见）</span>
          </label>
          <input
            id="feedback-contact"
            className="feedback-form-input"
            placeholder="邮箱 / QQ 等，便于必要时与你联系"
            maxLength={200}
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />

          {error ? <div className="form-error" style={{ marginTop: 12 }}>{error}</div> : null}

          <button className="feedback-submit-btn" type="submit" disabled={busy}>
            {busy ? "提交中..." : "提交反馈"}
          </button>
          <div className="form-hint" style={{ marginTop: 10 }}>反馈内容会公开显示，但不会展示你的用户名与联系方式。</div>
        </form>
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

  const report: BugReport | undefined = detail.data?.data?.report || detail.data?.report;
  const logs: BugReportLogItem[] = detail.data?.data?.logs || detail.data?.logs || [];
  if (!report) {
    return (
      <div className="screen">
        <TopBar title="反馈详情" back />
        <EmptyState text={detail.error instanceof Error ? detail.error.message : "反馈不存在"} />
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title="反馈详情" back />
      <div className="forum-container feedback-page">
        <div className="feedback-detail">
          <h3 className="feedback-detail-title">{report.title || "无标题反馈"}</h3>
          <div className="feedback-detail-meta">
            <FeedbackStatusPill status={report.status} />
            <span className="feedback-detail-time">{formatDate(report.created_at)}</span>
          </div>

          <div className="feedback-detail-body">{report.detail || "—"}</div>

          {report.steps ? (
            <>
              <div className="feedback-detail-subtitle">复现步骤</div>
              <div className="feedback-detail-body feedback-detail-steps">{report.steps}</div>
            </>
          ) : null}

          <div className="feedback-detail-subtitle">处理流程</div>
          <div className="feedback-timeline">
            {/* 首节点：提交反馈（未处理） */}
            <div className="feedback-timeline-item">
              <span className="feedback-timeline-dot" style={{ background: FEEDBACK_STATUS[0].color }} />
              <div className="feedback-timeline-content">
                <div className="feedback-timeline-head">
                  <span className="feedback-timeline-status">提交反馈</span>
                  <span className="feedback-timeline-time">{formatDate(report.created_at)}</span>
                </div>
                <div className="feedback-timeline-note">反馈已提交，等待处理（未处理）</div>
              </div>
            </div>
            {logs.map((log, index) => {
              const meta = feedbackStatus(log.to_status);
              return (
                <div className="feedback-timeline-item" key={`${log.to_status}-${index}`}>
                  <span className="feedback-timeline-dot" style={{ background: meta.color }} />
                  <div className="feedback-timeline-content">
                    <div className="feedback-timeline-head">
                      <span className="feedback-timeline-status" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="feedback-timeline-time">{formatDate(log.created_at)}</span>
                    </div>
                    {log.note ? <div className="feedback-timeline-note">{log.note}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ======================
 * 更新日志
 * ==================== */

interface ChangelogItem {
  id?: number;
  version?: string;
  title?: string;
  content_html?: string;
  published_at?: string | null;
}

/** v 前缀归一（避免后端 version 已带 v 时出现 vv） */
function versionLabel(version?: string | null): string {
  const value = String(version || "").trim();
  if (!value) return "—";
  return /^v/i.test(value) ? value : `v${value}`;
}

/** 版本号徽标：分隔点单独放大（Web .changelog-version / .changelog-version-dot） */
function VersionBadge({ version }: { version?: string | null }) {
  const parts = versionLabel(version).split(".");
  return (
    <span className="changelog-version">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? <span className="changelog-version-dot">.</span> : null}
          {part}
        </span>
      ))}
    </span>
  );
}

/** RFC3339 → YYYY-MM-DD（无效值原样展示，口径同 Web changelog 页） */
function formatDay(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ChangelogScreen() {
  const list = useQuery({ queryKey: ["changelogs"], queryFn: () => api.changelogs(1, 30) });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const items: ChangelogItem[] = list.data?.items || list.data?.data?.items || [];

  return (
    <div className="screen">
      <TopBar title="更新日志" back />
      <div className="changelog-page">
        <div className="changelog-header">
          <h1 className="changelog-heading">
            <i className="fa fa-history" aria-hidden="true" /> 更新日志
          </h1>
          <p className="changelog-subtitle">记录妖精论坛的每一次更新：功能上新、体验优化与问题修复。</p>
        </div>

        {list.isLoading ? (
          <div className="changelog-status" role="status">
            <i className="fa fa-spinner fa-spin" aria-hidden="true" /> 加载中...
          </div>
        ) : list.error ? (
          <div className="changelog-status changelog-error" role="alert">
            <p>
              <i className="fa fa-exclamation-triangle" aria-hidden="true" />{" "}
              {list.error instanceof Error ? list.error.message : "更新日志加载失败，请稍后再试"}
            </p>
            <button type="button" className="changelog-retry-btn" onClick={() => void list.refetch()}>重试</button>
          </div>
        ) : items.length === 0 ? (
          <div className="changelog-status changelog-empty">
            <i className="fa fa-file-text-o" aria-hidden="true" /> 暂无更新日志
          </div>
        ) : (
          <div className="changelog-list">
            {items.map((item, index) => {
              const key = String(item.id ?? item.version ?? index);
              // 最新一条默认展开，其余收起（点标题展开全文）
              const open = expanded[key] ?? index === 0;
              return (
                <article className="changelog-item" key={key}>
                  <button
                    type="button"
                    className="changelog-item-head"
                    aria-expanded={open}
                    onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))}
                  >
                    <VersionBadge version={item.version} />
                    <span className="changelog-title">{item.title || "更新"}</span>
                    <time className="changelog-date" dateTime={item.published_at || undefined}>
                      <i className="fa fa-clock-o" aria-hidden="true" /> {formatDay(item.published_at)}
                    </time>
                    <span className="changelog-toggle">
                      {open ? "收起" : "展开"} <i className={`fa ${open ? "fa-angle-up" : "fa-angle-down"}`} aria-hidden="true" />
                    </span>
                  </button>
                  {open ? (
                    item.content_html ? (
                      <div className="changelog-content">
                        <RichContent html={item.content_html} format="html" />
                      </div>
                    ) : (
                      <p className="changelog-content-empty">暂无详细内容</p>
                    )
                  ) : item.content_html ? (
                    <p className="changelog-preview">{textLimit(stripHtml(item.content_html), 120)}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================
 * 年制换算（纯前端）
 * ==================== */

type YearDirection = "infinite-to-gregorian" | "gregorian-to-infinite";
type YearEra = InfiniteEra | GregorianEra;
type YearResultType = "success" | "warning" | "error";

interface YearForm {
  era: YearEra;
  year: string;
  month: string;
  day: string;
}

interface YearConversionResult {
  type: YearResultType;
  message: string;
}

interface TodayParts {
  year: number;
  month: number;
  day: number;
}

/** 换算方向元信息（口径同 Web lib/year-conversion 的 DIRECTION_META） */
const YEAR_DIRECTIONS: Record<
  YearDirection,
  { label: string; icon: string; source: "infinite" | "gregorian"; desc: string }
> = {
  "infinite-to-gregorian": {
    label: "无限历 → 公元历",
    icon: "fa-long-arrow-right",
    source: "infinite",
    desc: "公元 1604 年之前为「无限前」，请切换纪年并填写正数年份。",
  },
  "gregorian-to-infinite": {
    label: "公元历 → 无限历",
    icon: "fa-long-arrow-left",
    source: "gregorian",
    desc: "公元前请选择「公元前」并填写正数年份；公元纪年没有 0 年。",
  },
};

/** 全角数字转半角（中文输入法下也能正常解析） */
function normalizeDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 解析非负整数年份：支持半角/全角数字与「元年」；空串、负数、小数、溢出返回 null */
function parseYearInput(raw: string): number | null {
  const text = normalizeDigits(raw).trim();
  if (text === "元年" || text === "元") return 1;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function parsePositiveInt(raw: string): number | null {
  const text = normalizeDigits(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** 公历闰年（天文纪年；天文年 0 = 公元前 1 年，按 400 年周期为闰年） */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** 公元年展示：1 年可显示为「公元元年」 */
function formatGregorianLabel(astronomicalYear: number, useYuanNian: boolean): string {
  if (astronomicalYear >= 1) {
    return astronomicalYear === 1 && useYuanNian ? "公元元年" : `公元 ${astronomicalYear} 年`;
  }
  return `公元前 ${1 - astronomicalYear} 年`;
}

/** 无限年展示：无限元年 / 无限 N 年 / 无限前 N 年 */
function formatInfiniteLabel(year: number, before: boolean, useYuanNian: boolean): string {
  if (before) return `无限前 ${year} 年`;
  return year === 1 && useYuanNian ? "无限元年" : `无限 ${year} 年`;
}

/** 上海时区「今天」（与论坛签到 / 时间展示口径一致） */
function shanghaiToday(): TodayParts {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: pick("year"), month: pick("month"), day: pick("day") };
  } catch {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }
}

/**
 * 统一换算入口（移植 Web lib/year-conversion 的 convertYear）：
 * 年月日不改变月日，只换算年份；目标年日期非法时返回 warning / error。
 */
function convertYear(
  input: { calendar: "infinite" | "gregorian"; era: YearEra; year: string; month: string; day: string },
  useYuanNian: boolean,
): YearConversionResult {
  const year = parseYearInput(input.year);
  if (year === null) {
    return {
      type: "error",
      message: input.calendar === "infinite" ? "请输入有效的无限年年份（可填「元年」）" : "请输入有效的公元年份（可填「元年」）",
    };
  }
  if (year === 0) {
    return {
      type: "error",
      message:
        input.calendar === "infinite"
          ? "无限历没有 0 年（元年即公元 1604 年）"
          : "公元纪年没有 0 年（公元前 1 年之后即公元 1 年）",
    };
  }

  const month = parsePositiveInt(input.month);
  if (month === null || month < 1 || month > 12) return { type: "error", message: "请输入 1-12 的月份" };
  const day = parsePositiveInt(input.day);
  if (day === null || day < 1 || day > 31) return { type: "error", message: "请输入 1-31 的日期" };

  const astronomical =
    input.calendar === "infinite"
      ? infiniteToAstronomical(year, input.era as InfiniteEra)
      : input.era === "bce"
        ? 1 - year
        : year;

  const max = daysInMonth(astronomical, month);
  if (day > max) {
    const label = formatGregorianLabel(astronomical, useYuanNian);
    if (month === 2 && day === 29 && !isLeapYear(astronomical)) {
      return { type: "warning", message: `目标${label}不是闰年，2 月 29 日不存在` };
    }
    return { type: "error", message: `${label}的 ${month} 月只有 ${max} 天` };
  }

  const infinite = astronomicalToInfinite(astronomical);
  const sourceLabel =
    input.calendar === "infinite"
      ? formatInfiniteLabel(year, input.era === "before", useYuanNian)
      : formatGregorianLabel(astronomical, useYuanNian);
  const targetLabel =
    input.calendar === "infinite"
      ? formatGregorianLabel(astronomical, useYuanNian)
      : formatInfiniteLabel(infinite.year, infinite.before, useYuanNian);

  return {
    type: "success",
    message: `${sourceLabel} ${month} 月 ${day} 日 = ${targetLabel} ${month} 月 ${day} 日`,
  };
}

/** 结果面板（Web .yc-result / .yc-result-*） */
function YearResultPanel({ result }: { result: YearConversionResult | null }) {
  if (!result) {
    return (
      <div className="yc-result yc-result-idle">
        <i className="fa fa-info-circle" aria-hidden="true" />
        <p>填写年、月、日后点击「换算」查看结果</p>
      </div>
    );
  }
  const icon = result.type === "success" ? "fa-check-circle" : result.type === "warning" ? "fa-exclamation-triangle" : "fa-times-circle";
  return (
    <div className={`yc-result yc-result-${result.type}`} role={result.type === "error" ? "alert" : "status"}>
      <i className={`fa ${icon}`} aria-hidden="true" />
      <p>{result.message}</p>
    </div>
  );
}

export function YearConverterScreen() {
  const [today, setToday] = useState<TodayParts | null>(null);
  const [direction, setDirection] = useState<YearDirection>("infinite-to-gregorian");
  const [form, setForm] = useState<YearForm>({ era: "after", year: "", month: "", day: "" });
  const [useYuanNian, setUseYuanNian] = useState(true);
  const [result, setResult] = useState<YearConversionResult | null>(null);

  useEffect(() => {
    // 时钟属于外部系统：挂载后再读，避开首帧时区差异
    setToday(shanghaiToday());
  }, []);

  const meta = YEAR_DIRECTIONS[direction];
  const isInfiniteSource = meta.source === "infinite";
  const todayInfinite = today ? astronomicalToInfinite(today.year) : null;

  const switchDirection = (next: YearDirection) => {
    if (next === direction) return;
    setDirection(next);
    setForm({ era: next === "infinite-to-gregorian" ? "after" : "ce", year: "", month: "", day: "" });
    setResult(null);
  };

  const update = (patch: Partial<YearForm>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="screen">
      <TopBar title="年制换算" back />
      <div className="year-converter-page">
        <div className="yc-header">
          <h1 className="yc-heading">
            <i className="fa fa-calendar" aria-hidden="true" /> 无限年换算
          </h1>
          <p className="yc-subtitle">
            统一入口：选择方向后一次完成「无限历 ⇄ 公元历」换算。基准：无限元年 = 公元 1604 年。
          </p>
          {today && todayInfinite ? (
            <div className="yc-today">
              <i className="fa fa-clock-o" aria-hidden="true" />
              <span>
                今天是 {formatGregorianLabel(today.year, useYuanNian)} {today.month} 月 {today.day} 日
              </span>
              <span className="yc-today-sep" aria-hidden="true">·</span>
              <span>
                {formatInfiniteLabel(todayInfinite.year, todayInfinite.before, useYuanNian)} {today.month} 月 {today.day} 日
              </span>
            </div>
          ) : null}
        </div>

        <div className="yc-direction" role="tablist" aria-label="换算方向">
          {(Object.keys(YEAR_DIRECTIONS) as YearDirection[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={direction === key}
              className={`yc-direction-btn${direction === key ? " active" : ""}`}
              onClick={() => switchDirection(key)}
            >
              <i className={`fa ${YEAR_DIRECTIONS[key].icon}`} aria-hidden="true" />
              {YEAR_DIRECTIONS[key].label}
            </button>
          ))}
        </div>

        <section className="yc-card" aria-labelledby="yc-convert-title">
          <h2 className="yc-card-title" id="yc-convert-title">
            <i className="fa fa-exchange" aria-hidden="true" /> {meta.label}
          </h2>
          <p className="yc-card-desc">{meta.desc}</p>
          <form
            className="yc-form"
            onSubmit={(event) => {
              event.preventDefault();
              setResult(
                convertYear(
                  { calendar: meta.source, era: form.era, year: form.year, month: form.month, day: form.day },
                  useYuanNian,
                ),
              );
            }}
          >
            <div className="yc-field-row">
              <label className="yc-field">
                <span>纪年</span>
                <select value={form.era} onChange={(event) => update({ era: event.target.value as YearEra })}>
                  {isInfiniteSource ? (
                    <>
                      <option value="after">无限</option>
                      <option value="before">无限前</option>
                    </>
                  ) : (
                    <>
                      <option value="ce">公元</option>
                      <option value="bce">公元前</option>
                    </>
                  )}
                </select>
              </label>
              <label className="yc-field yc-field-grow">
                <span>年</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.year}
                  onChange={(event) => update({ year: event.target.value })}
                  placeholder={isInfiniteSource ? "如 423 或 元年" : "如 2026 或 元年"}
                />
              </label>
            </div>
            <div className="yc-field-row">
              <label className="yc-field">
                <span>月</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.month}
                  onChange={(event) => update({ month: event.target.value })}
                  placeholder="1-12"
                />
              </label>
              <label className="yc-field">
                <span>日</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.day}
                  onChange={(event) => update({ day: event.target.value })}
                  placeholder="1-31"
                />
              </label>
            </div>
            <label className="yc-yuan-toggle">
              <input type="checkbox" checked={useYuanNian} onChange={(event) => setUseYuanNian(event.target.checked)} />
              <span>第 1 年显示为「元年」（如无限元年 / 公元元年）</span>
            </label>
            <button type="submit" className="yc-submit-btn">
              <i className="fa fa-exchange" aria-hidden="true" /> 换算
            </button>
          </form>
          <YearResultPanel result={result} />
          <p className="yc-formula">无限 N 年 = 公元 (1603 + N) 年；公元 1603 年及以前 = 无限前 (1604 - 公元年) 年。</p>
        </section>

        <section className="yc-rules" aria-labelledby="yc-rules-title">
          <h2 className="yc-rules-title" id="yc-rules-title">
            <i className="fa fa-book" aria-hidden="true" /> 换算规则
          </h2>
          <ul className="yc-rules-list">
            <li>无限元年 = 公元 1604 年；无限 N 年 = 公元 (1603 + N) 年。</li>
            <li>公元 1603 年及以前记为「无限前」：无限前 1 年 = 公元 1603 年。</li>
            <li>两套纪年都不存在 0 年：无限前 1 年之后直接是无限元年；公元前 1 年之后直接是公元 1 年。</li>
            <li>第 1 年可显示为「元年」，也可直接在上方年份框输入「元年」。</li>
            <li>2 月 29 日只在闰年存在；目标年份不是闰年时会给出提示，不输出无效日期。</li>
            <li>年、月、日之外不改变月日，仅在换算年份时同步提示该日期在目标年是否有效。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
