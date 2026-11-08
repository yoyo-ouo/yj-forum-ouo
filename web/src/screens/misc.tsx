import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { requestApi } from "../lib/native";
import { useNav } from "../lib/nav";
import { useApp } from "../lib/store";
import { AppBar, Cell, Empty, IconButton, Screen, Sheet, Skeletons } from "../components/mobile";
import { Icon } from "../components/icons";
import { RichContent } from "../components/ui";
import { formatDate, stripHtml, timeAgo } from "../lib/format";
import { astronomicalToInfinite, infiniteToAstronomical } from "../lib/year";
import type { GregorianEra, InfiniteEra } from "../lib/year";

/* 杂项页：指南 / 反馈 / 更新日志 / 年制换算（msc-*） */

/** RFC3339 → YYYY-MM-DD（无效值原样展示） */
function formatDay(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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

/**
 * 兼容两种返回：后端扁平结构（parent_id）与嵌套 children。
 * 统一摊平成 GuideNode[]，再交给 buildTree。
 */
function normalizeGuideNodes(raw: any[], parentId?: string | null): GuideNode[] {
  const result: GuideNode[] = [];
  (Array.isArray(raw) ? raw : []).forEach((node) => {
    if (!node || node.id === undefined || node.id === null) return;
    const id = String(node.id);
    const children = Array.isArray(node.children) ? node.children : [];
    result.push({
      id,
      parent_id: node.parent_id ?? parentId ?? null,
      title: node.title,
      kind: node.kind || (children.length > 0 ? "folder" : "doc"),
      sort: node.sort,
      updated_at: node.updated_at || node.created_at,
      content: node.content,
      content_format: node.content_format,
    });
    result.push(...normalizeGuideNodes(children, id));
  });
  return result;
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
 * 目录树：folder 可展开收起（保留原有树形导航），doc 点击进入正文。
 * 层级用 data-depth 传给样式表，避免行内 padding。
 */
function GuideRows({
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
    <>
      {rows.map(({ node, children }) => {
        const id = String(node.id);
        const isFolder = node.kind === "folder";
        const open = !collapsed.has(id);
        return (
          <React.Fragment key={id}>
            <div className={`msc-guide-row${isFolder ? " is-folder" : ""}`} data-depth={Math.min(depth, 3)}>
              {isFolder ? (
                <Cell
                  icon="list"
                  label={node.title || "未命名目录"}
                  sub={`目录 · ${children.length} 条`}
                  chevron={false}
                  onClick={() => onToggle(id)}
                  right={<Icon name={open ? "down" : "forward"} size={18} className="msc-guide-caret" />}
                />
              ) : (
                <Cell
                  icon="bookmark"
                  label={node.title || "未命名指南"}
                  sub={node.updated_at ? `更新于 ${formatDay(node.updated_at)}` : "指南文档"}
                  onClick={() => onOpen(id)}
                />
              )}
            </div>
            {children.length > 0 && (isFolder ? open : true) ? (
              <GuideRows
                rows={children}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function GuideScreen() {
  const { push } = useNav();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useQuery({ queryKey: ["guides"], queryFn: () => api.guides(), staleTime: 5 * 60_000 });
  const nodes: GuideNode[] = useMemo(
    () => normalizeGuideNodes(tree.data?.data?.nodes || tree.data?.nodes || []),
    [tree.data],
  );
  const rows = useMemo(() => buildTree(nodes), [nodes]);
  const docCount = nodes.filter((node) => node.kind !== "folder").length;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Screen appbar={<AppBar back title="使用指南" />} onRefresh={async () => { await tree.refetch(); }}>
      {tree.isLoading ? (
        <Skeletons count={5} />
      ) : tree.error ? (
        <Empty
          icon="info"
          title="指南加载失败"
          hint={tree.error instanceof Error ? tree.error.message : "请稍后再试"}
          action={
            <button type="button" className="m-btn" onClick={() => void tree.refetch()}>
              重试
            </button>
          }
        />
      ) : nodes.length === 0 ? (
        <Empty icon="compass" title="暂无指南内容" hint="管理员还没有发布使用指南。" />
      ) : (
        <>
          <div className="msc-guide-head">
            <span className="msc-guide-count">{docCount} 篇指南</span>
          </div>
          <div className="msc-list">
            <GuideRows rows={rows} collapsed={collapsed} onToggle={toggle} onOpen={(id) => push("guide", { id })} />
          </div>
          <div className="m-end">— 到底了 —</div>
        </>
      )}
    </Screen>
  );
}

export function GuideDetailScreen({ id }: { id?: string | number }) {
  const guideId = id === undefined || id === null ? "" : String(id);
  const detail = useQuery({
    queryKey: ["guide", guideId],
    queryFn: () => api.guide(guideId),
    enabled: Boolean(guideId),
  });

  const node: GuideNode | undefined = detail.data?.data?.node || detail.data?.node;

  if (detail.isLoading) {
    return (
      <Screen appbar={<AppBar back title="指南" />}>
        <Skeletons count={2} />
      </Screen>
    );
  }

  if (!node) {
    return (
      <Screen appbar={<AppBar back title="指南" />}>
        <Empty
          icon="info"
          title="指南不存在"
          hint={detail.error instanceof Error ? detail.error.message : "这篇指南可能已被删除。"}
          action={
            <button type="button" className="m-btn" onClick={() => void detail.refetch()}>
              重试
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen appbar={<AppBar back title={node.title || "指南"} />}>
      <article className="msc-doc">
        <h1 className="msc-doc-title">{node.title || "指南"}</h1>
        {node.updated_at ? <div className="msc-doc-meta">更新于 {formatDay(node.updated_at)}</div> : null}
        {node.content ? (
          <div className="m-rich msc-doc-body">
            <RichContent html={node.content} format={node.content_format || "html"} />
          </div>
        ) : (
          <p className="msc-doc-empty">这篇指南还没有正文。</p>
        )}
      </article>
    </Screen>
  );
}

/* ======================
 * 反馈（Bug 报告）
 * ==================== */

const FEEDBACK_STATUS: Record<number, { label: string; tone: string }> = {
  0: { label: "待处理", tone: "open" },
  1: { label: "处理中", tone: "doing" },
  2: { label: "已处理", tone: "done" },
  3: { label: "已关闭", tone: "closed" },
};

function feedbackStatus(status: unknown): { label: string; tone: string } {
  return FEEDBACK_STATUS[Number(status)] || { label: "未知", tone: "closed" };
}

/** 状态徽标：浅底深字，四态各有色调 */
function FeedbackStatusPill({ status }: { status?: number | null }) {
  const meta = feedbackStatus(status);
  return <span className={`msc-fb-status is-${meta.tone}`}>{meta.label}</span>;
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
  const hasStats = (stats.data || []).length > 0;
  const allCount = hasStats ? statsTotal : total;

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
    <Screen
      appbar={
        <AppBar
          back
          title="意见反馈"
          actions={<IconButton icon="plus" label="新建反馈" onClick={openSubmit} />}
        />
      }
      onRefresh={async () => {
        await loadList(statusFilter, 1, false);
      }}
    >
      <div className="m-chips msc-fb-chips">
        {chips.map((chip) => (
          <button
            key={chip.key === null ? "all" : chip.key}
            type="button"
            className={`m-chip ${statusFilter === chip.key ? "on" : ""}`.trim()}
            onClick={() => setStatusFilter(chip.key)}
          >
            {chip.label}
            {chip.key === null || hasStats ? <span className="msc-chip-count">{chip.count}</span> : null}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeletons count={3} />
      ) : listError ? (
        <Empty
          icon="info"
          title="反馈加载失败"
          hint={listError}
          action={
            <button type="button" className="m-btn" onClick={() => void loadList(statusFilter, 1, false)}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <Empty
          icon="comment"
          title="还没有反馈"
          hint="遇到问题或想提建议？写下第一条反馈吧。"
          action={
            <button type="button" className="m-btn m-btn--primary" onClick={openSubmit}>
              提交反馈
            </button>
          }
        />
      ) : (
        <div className="msc-fb-list">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="msc-fb-card"
              aria-label={`查看反馈 ${item.title || "无标题反馈"}`}
              onClick={() => push("feedback-detail", { id: item.id })}
            >
              <span className="msc-fb-top">
                <span className="msc-fb-kind">问题反馈</span>
                <FeedbackStatusPill status={item.status} />
                <span className="msc-fb-time">{timeAgo(item.created_at) || formatDay(item.created_at)}</span>
              </span>
              <span className="msc-fb-title">{item.title || "无标题反馈"}</span>
              {item.detail ? <span className="msc-fb-summary m-clamp2">{item.detail}</span> : null}
            </button>
          ))}
        </div>
      )}

      {!loading && !listError && hasMore ? (
        <button
          type="button"
          className="m-more"
          disabled={loadingMore}
          onClick={() => void loadList(statusFilter, Math.ceil(items.length / FEEDBACK_PAGE_SIZE) + 1, true)}
        >
          {loadingMore ? "加载中…" : "加载更多"}
        </button>
      ) : !loading && !listError && items.length > 0 ? (
        <div className="m-end">— 到底了 —</div>
      ) : null}

      <Sheet
        open={open}
        title="提交反馈"
        onClose={() => setOpen(false)}
        footer={
          <button type="button" className="m-btn m-btn--primary m-btn--block" disabled={busy} onClick={() => void submit()}>
            {busy ? "提交中…" : "提交反馈"}
          </button>
        }
      >
        <form
          className="msc-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="m-field" htmlFor="msc-fb-title">
            <span className="m-label">标题 *</span>
            <input
              id="msc-fb-title"
              className="m-input"
              placeholder="一句话描述问题或建议"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="m-field" htmlFor="msc-fb-detail">
            <span className="m-label">详细描述 *</span>
            <textarea
              id="msc-fb-detail"
              className="m-textarea"
              placeholder="请尽量描述清楚：你期望的结果与实际发生的情况"
              rows={6}
              maxLength={5000}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>

          <label className="m-field" htmlFor="msc-fb-steps">
            <span className="m-label">复现步骤（选填）</span>
            <textarea
              id="msc-fb-steps"
              className="m-textarea"
              placeholder="例如：1. 打开首页；2. 点击……；3. 出现……"
              rows={4}
              maxLength={3000}
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
            />
          </label>

          <label className="m-field" htmlFor="msc-fb-contact">
            <span className="m-label">联系方式（选填，仅管理员可见）</span>
            <input
              id="msc-fb-contact"
              className="m-input"
              placeholder="邮箱 / QQ 等，便于必要时与你联系"
              maxLength={200}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
            />
          </label>

          {error ? <div className="msc-form-error" role="alert">{error}</div> : null}

          <p className="msc-form-hint">反馈内容会公开显示，但不会展示你的用户名与联系方式。</p>
        </form>
      </Sheet>
    </Screen>
  );
}

export function FeedbackDetailScreen({ id }: { id?: string | number }) {
  const reportId = id === undefined || id === null ? "" : String(id);
  const detail = useQuery({
    queryKey: ["bug-report", reportId],
    queryFn: () => api.bugReport(reportId),
    enabled: Boolean(reportId),
  });

  const report: BugReport | undefined = detail.data?.data?.report || detail.data?.report;
  const logs: BugReportLogItem[] = detail.data?.data?.logs || detail.data?.logs || [];

  if (detail.isLoading) {
    return (
      <Screen appbar={<AppBar back title="反馈详情" />}>
        <Skeletons count={2} />
      </Screen>
    );
  }

  if (!report) {
    return (
      <Screen appbar={<AppBar back title="反馈详情" />}>
        <Empty
          icon="info"
          title="反馈不存在"
          hint={detail.error instanceof Error ? detail.error.message : "这条反馈可能已被删除。"}
          action={
            <button type="button" className="m-btn" onClick={() => void detail.refetch()}>
              重试
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen appbar={<AppBar back title="反馈详情" />}>
      <article className="msc-doc">
        <div className="msc-fb-top">
          <span className="msc-fb-kind">问题反馈</span>
          <FeedbackStatusPill status={report.status} />
          <span className="msc-fb-time">{formatDay(report.created_at)}</span>
        </div>
        <h1 className="msc-doc-title">{report.title || "无标题反馈"}</h1>

        <section className="msc-block">
          <h2 className="msc-block-title">详细描述</h2>
          <p className="msc-body-text">{report.detail || "—"}</p>
        </section>

        {report.steps ? (
          <section className="msc-block">
            <h2 className="msc-block-title">复现步骤</h2>
            <p className="msc-body-text msc-body-text--pre">{report.steps}</p>
          </section>
        ) : null}

        <section className="msc-block">
          <h2 className="msc-block-title">处理进度</h2>
          <ol className="msc-timeline">
            <li className="msc-timeline-item">
              <span className="msc-timeline-dot is-open" aria-hidden="true" />
              <div className="msc-timeline-body">
                <div className="msc-timeline-head">
                  <span className="msc-timeline-status">提交反馈</span>
                  <span className="msc-timeline-time">{formatDate(report.created_at)}</span>
                </div>
                <p className="msc-timeline-note">反馈已提交，等待处理</p>
              </div>
            </li>
            {logs.map((log, index) => {
              const meta = feedbackStatus(log.to_status);
              return (
                <li className="msc-timeline-item" key={`${log.to_status}-${index}`}>
                  <span className={`msc-timeline-dot is-${meta.tone}`} aria-hidden="true" />
                  <div className="msc-timeline-body">
                    <div className="msc-timeline-head">
                      <span className={`msc-timeline-status is-${meta.tone}`}>{meta.label}</span>
                      <span className="msc-timeline-time">{formatDate(log.created_at)}</span>
                    </div>
                    {log.note ? <p className="msc-timeline-note">{log.note}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </article>
    </Screen>
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
  /** 兼容部分接口把正文放在 content 的情况 */
  content?: string;
  published_at?: string | null;
  created_at?: string | null;
}

/** v 前缀归一（避免后端 version 已带 v 时出现 vv） */
function versionLabel(version?: string | null): string {
  const value = String(version || "").trim();
  if (!value) return "—";
  return /^v/i.test(value) ? value : `v${value}`;
}

/** 富文本 → 条目文本：优先取 <li>，没有列表时按块级标签切行 */
function htmlToLines(html?: string | null): string[] {
  const raw = String(html || "");
  if (!raw.trim()) return [];
  const items = Array.from(raw.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
    .map((hit) => stripHtml(hit[1]))
    .filter(Boolean);
  if (items.length > 0) return items;
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const CHANGELOG_PREVIEW = 6;

export function ChangelogScreen() {
  const list = useQuery({ queryKey: ["changelogs"], queryFn: () => api.changelogs(1, 30) });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const items: ChangelogItem[] = useMemo(
    () => list.data?.items || list.data?.data?.items || [],
    [list.data],
  );

  /** 当前版本 = 最新一条（按发布时间取最大，缺失时用首条） */
  const currentKey = useMemo(() => {
    let bestKey = "";
    let bestTime = Number.NEGATIVE_INFINITY;
    items.forEach((item, index) => {
      const key = String(item.id ?? item.version ?? index);
      const stamp = item.published_at || item.created_at;
      const time = stamp ? new Date(stamp).getTime() : Number.NaN;
      if (Number.isFinite(time) && time > bestTime) {
        bestTime = time;
        bestKey = key;
      }
    });
    if (bestKey) return bestKey;
    return items.length > 0 ? String(items[0].id ?? items[0].version ?? 0) : "";
  }, [items]);

  return (
    <Screen appbar={<AppBar back title="更新日志" />} onRefresh={async () => { await list.refetch(); }}>
      {list.isLoading ? (
        <Skeletons count={3} />
      ) : list.error ? (
        <Empty
          icon="info"
          title="更新日志加载失败"
          hint={list.error instanceof Error ? list.error.message : "请稍后再试"}
          action={
            <button type="button" className="m-btn" onClick={() => void list.refetch()}>
              重试
            </button>
          }
        />
      ) : items.length === 0 ? (
        <Empty icon="clock" title="暂无更新日志" hint="版本更新后会在这里记录。" />
      ) : (
        <>
          <div className="msc-ver-list">
            {items.map((item, index) => {
              const key = String(item.id ?? item.version ?? index);
              const lines = htmlToLines(item.content_html || item.content);
              const isCurrent = key === currentKey;
              const open = Boolean(expanded[key]);
              const visible = open ? lines : lines.slice(0, CHANGELOG_PREVIEW);
              return (
                <article className={`msc-ver-card${isCurrent ? " is-current" : ""}`.trim()} key={key}>
                  <header className="msc-ver-head">
                    <span className="msc-ver-name">{versionLabel(item.version)}</span>
                    {isCurrent ? <span className="msc-ver-now">当前</span> : null}
                    <time className="msc-ver-date" dateTime={item.published_at || item.created_at || undefined}>
                      {formatDay(item.published_at || item.created_at)}
                    </time>
                  </header>
                  {item.title ? <p className="msc-ver-title">{item.title}</p> : null}
                  {visible.length > 0 ? (
                    <ul className="msc-ver-lines">
                      {visible.map((line, lineIndex) => (
                        <li key={`${line}-${lineIndex}`}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="msc-ver-empty">暂无详细内容</p>
                  )}
                  {lines.length > CHANGELOG_PREVIEW ? (
                    <button
                      type="button"
                      className="msc-ver-toggle"
                      onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))}
                    >
                      {open ? "收起" : `展开全部 ${lines.length} 条`}
                      <Icon name={open ? "up" : "down"} size={14} />
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
          <div className="m-end">— 到底了 —</div>
        </>
      )}
    </Screen>
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

interface YearSide {
  era: string;
  year: number;
  month: number;
  day: number;
}

interface YearConversionResult {
  type: YearResultType;
  message: string;
  source?: YearSide;
  target?: YearSide;
}

interface TodayParts {
  year: number;
  month: number;
  day: number;
}

/** 换算方向元信息（口径同 Web lib/year-conversion 的 DIRECTION_META） */
const YEAR_DIRECTIONS: Record<
  YearDirection,
  { label: string; short: string; source: "infinite" | "gregorian"; desc: string }
> = {
  "infinite-to-gregorian": {
    label: "无限历 → 公元历",
    short: "无限历 → 公元历",
    source: "infinite",
    desc: "公元 1604 年之前为「无限前」，请切换纪年并填写正数年份。",
  },
  "gregorian-to-infinite": {
    label: "公元历 → 无限历",
    short: "公元历 → 无限历",
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

  const source: YearSide =
    input.calendar === "infinite"
      ? { era: input.era === "before" ? "无限前" : "无限", year, month, day }
      : { era: input.era === "bce" ? "公元前" : "公元", year, month, day };
  const target: YearSide =
    input.calendar === "infinite"
      ? {
          era: astronomical >= 1 ? "公元" : "公元前",
          year: astronomical >= 1 ? astronomical : 1 - astronomical,
          month,
          day,
        }
      : { era: infinite.before ? "无限前" : "无限", year: infinite.year, month, day };

  return {
    type: "success",
    message: `${sourceLabel} ${month} 月 ${day} 日 = ${targetLabel} ${month} 月 ${day} 日`,
    source,
    target,
  };
}

/** 结果卡片：成功显示大数字双向对照，失败/提示显示原因 */
function YearResultCard({ result }: { result: YearConversionResult | null }) {
  if (!result) {
    return (
      <div className="msc-yc-result is-idle">
        <Icon name="info" size={17} />
        <p className="msc-yc-msg">填写年、月、日后自动显示换算结果</p>
      </div>
    );
  }
  if (result.type !== "success" || !result.source || !result.target) {
    return (
      <div className={`msc-yc-result is-${result.type}`} role={result.type === "error" ? "alert" : "status"}>
        <p className="msc-yc-msg">{result.message}</p>
      </div>
    );
  }
  return (
    <div className="msc-yc-result is-success" role="status">
      <div className="msc-yc-pair">
        <div className="msc-yc-side">
          <span className="msc-yc-era">{result.source.era}</span>
          <b className="msc-yc-num">{result.source.year}</b>
          <span className="msc-yc-unit">年</span>
        </div>
        <Icon name="forward" size={20} className="msc-yc-arrow" />
        <div className="msc-yc-side">
          <span className="msc-yc-era">{result.target.era}</span>
          <b className="msc-yc-num">{result.target.year}</b>
          <span className="msc-yc-unit">年</span>
        </div>
      </div>
      <p className="msc-yc-msg">
        {result.source.month} 月 {result.source.day} 日 · 年号换算不改月日
      </p>
    </div>
  );
}

export function YearConverterScreen() {
  const [today, setToday] = useState<TodayParts | null>(null);
  const [direction, setDirection] = useState<YearDirection>("infinite-to-gregorian");
  const [form, setForm] = useState<YearForm>({ era: "after", year: "", month: "", day: "" });
  const [useYuanNian, setUseYuanNian] = useState(true);

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
  };

  const update = (patch: Partial<YearForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const filled = form.year.trim() !== "" && form.month.trim() !== "" && form.day.trim() !== "";
  const result = useMemo(
    () =>
      filled
        ? convertYear(
            { calendar: meta.source, era: form.era, year: form.year, month: form.month, day: form.day },
            useYuanNian,
          )
        : null,
    [filled, form, meta.source, useYuanNian],
  );

  return (
    <Screen appbar={<AppBar back title="年制换算" />}>
      <div className="msc-yc">
        <div className="msc-yc-today">
          <Icon name="clock" size={14} />
          <span>
            {today
              ? `今天 ${formatGregorianLabel(today.year, useYuanNian)} ${today.month} 月 ${today.day} 日`
              : "正在读取今天的日期…"}
            {today && todayInfinite
              ? ` · ${formatInfiniteLabel(todayInfinite.year, todayInfinite.before, useYuanNian)} ${today.month} 月 ${today.day} 日`
              : ""}
          </span>
        </div>

        <div className="m-seg msc-yc-dir" role="tablist" aria-label="换算方向">
          {(Object.keys(YEAR_DIRECTIONS) as YearDirection[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={direction === key}
              className={`m-seg-btn ${direction === key ? "on" : ""}`.trim()}
              onClick={() => switchDirection(key)}
            >
              {YEAR_DIRECTIONS[key].short}
            </button>
          ))}
        </div>

        <section className="msc-yc-card">
          <p className="msc-yc-desc">{meta.desc}</p>

          <div className="msc-yc-row">
            <label className="msc-yc-field msc-yc-field--era">
              <span className="m-label">纪年</span>
              <select className="m-input" value={form.era} onChange={(event) => update({ era: event.target.value as YearEra })}>
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
            <label className="msc-yc-field msc-yc-field--year">
              <span className="m-label">年</span>
              <input
                className="m-input msc-yc-year"
                type="text"
                inputMode="numeric"
                value={form.year}
                onChange={(event) => update({ year: event.target.value })}
                placeholder={isInfiniteSource ? "423 或 元年" : "2026 或 元年"}
                aria-label="年份"
              />
            </label>
          </div>

          <div className="msc-yc-row">
            <label className="msc-yc-field">
              <span className="m-label">月</span>
              <input
                className="m-input"
                type="text"
                inputMode="numeric"
                value={form.month}
                onChange={(event) => update({ month: event.target.value })}
                placeholder="1-12"
                aria-label="月份"
              />
            </label>
            <label className="msc-yc-field">
              <span className="m-label">日</span>
              <input
                className="m-input"
                type="text"
                inputMode="numeric"
                value={form.day}
                onChange={(event) => update({ day: event.target.value })}
                placeholder="1-31"
                aria-label="日期"
              />
            </label>
          </div>

          <label className="msc-yc-yuan">
            <input type="checkbox" checked={useYuanNian} onChange={(event) => setUseYuanNian(event.target.checked)} />
            <span>第 1 年显示为「元年」（如无限元年 / 公元元年）</span>
          </label>
        </section>

        <YearResultCard result={result} />

        <p className="msc-yc-formula">
          无限 N 年 = 公元 (1603 + N) 年；公元 1603 年及以前 = 无限前 (1604 − 公元年) 年。
        </p>

        <section className="msc-block">
          <h2 className="msc-block-title">换算规则</h2>
          <ul className="msc-rule-list">
            <li>无限元年 = 公元 1604 年；无限 N 年 = 公元 (1603 + N) 年。</li>
            <li>公元 1603 年及以前记为「无限前」：无限前 1 年 = 公元 1603 年。</li>
            <li>两套纪年都不存在 0 年：无限前 1 年之后直接是无限元年；公元前 1 年之后直接是公元 1 年。</li>
            <li>第 1 年可显示为「元年」，也可直接在年份框输入「元年」。</li>
            <li>2 月 29 日只在闰年存在；目标年份不是闰年时会给出提示，不输出无效日期。</li>
          </ul>
        </section>
      </div>
    </Screen>
  );
}
