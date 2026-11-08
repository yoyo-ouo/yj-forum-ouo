import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav, type FollowTab } from "../lib/nav";
import { AppBar, Empty, Screen, Segmented, Skeletons } from "../components/mobile";
import { UserRow } from "../components/UserRow";
import type { FollowUser, FollowingResponse } from "../lib/types";

const FOLLOW_TITLE: Record<FollowTab, string> = {
  following: "关注",
  followers: "粉丝",
  mutual: "共同关注",
};

const FOLLOW_EMPTY: Record<FollowTab, { title: string; hint: string }> = {
  following: { title: "还没有关注任何人", hint: "在别人的主页点「关注」，这里就会列出来" },
  followers: { title: "还没有粉丝", hint: "多发帖、多聊天，会有人关注你的" },
  mutual: { title: "还没有共同关注", hint: "你们同时关注的人会出现在这里" },
};

const PAGE_SIZE = 20;

/** 关注 / 粉丝 / 共同关注列表（id 缺省 = 当前登录用户） */
export function FollowsScreen({ id, tab: initialTab = "following" }: { id?: string | number; tab?: FollowTab }) {
  const me = useApp((state) => state.user);
  const showToast = useApp((state) => state.showToast);
  const { push } = useNav();
  const targetId = id ? String(id) : me?.id ? String(me.id) : "";
  const isSelf = !id || (me ? String(me.id) === String(id) : false);
  /** 共同关注只在「登录后看他人的列表」时有意义（服务端匿名/看自己返回空） */
  const canSeeMutual = Boolean(me) && Boolean(targetId) && !isSelf;
  const tabs = useMemo<FollowTab[]>(() => (canSeeMutual ? ["following", "followers", "mutual"] : ["following", "followers"]), [canSeeMutual]);

  const [tab, setTab] = useState<FollowTab>(() => (initialTab === "mutual" && !canSeeMutual ? "following" : initialTab));
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (tab === "mutual" && !canSeeMutual) setTab("following");
  }, [canSeeMutual, tab]);

  const load = useCallback(
    async (nextPage: number, append = false) => {
      if (!targetId) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const request = tab === "following" ? api.following : tab === "followers" ? api.followers : api.mutual;
        const res = (await request(targetId, nextPage, PAGE_SIZE)) as FollowingResponse;
        const incoming = Array.isArray(res?.users) ? res.users : [];
        setUsers((current) => {
          if (!append) return incoming;
          const known = new Set(current.map((item) => String(item.id)));
          return [...current, ...incoming.filter((item) => !known.has(String(item.id)))];
        });
        setPage(nextPage);
        setHasMore(Boolean(res?.has_more));
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : "列表加载失败";
        if (append) {
          showToast(message, "error");
        } else {
          setError(message);
          setUsers([]);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [showToast, tab, targetId],
  );

  useEffect(() => {
    if (!targetId) {
      setUsers([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    setUsers([]);
    setPage(1);
    setHasMore(false);
    void load(1, false);
  }, [load, targetId]);

  /** 行内关注：先乐观翻转，失败回滚 */
  const toggleFollow = async (row: FollowUser) => {
    if (!me) {
      showToast("登录后才能关注", "info");
      push("auth");
      return;
    }
    if (row.is_self || busyId) return;
    const previous = Boolean(row.is_following);
    setBusyId(String(row.id));
    setUsers((current) => current.map((item) => (String(item.id) === String(row.id) ? { ...item, is_following: !previous } : item)));
    try {
      const res = await api.follow(row.id);
      setUsers((current) =>
        current.map((item) => (String(item.id) === String(row.id) ? { ...item, is_following: Boolean(res.following) } : item)),
      );
      showToast(res.following ? "已关注" : "已取消关注");
    } catch (err) {
      setUsers((current) =>
        current.map((item) => (String(item.id) === String(row.id) ? { ...item, is_following: previous } : item)),
      );
      showToast(err instanceof Error && err.message ? err.message : "操作失败", "error");
    } finally {
      setBusyId("");
    }
  };

  const appbar = <AppBar back title={FOLLOW_TITLE[tab]} />;

  if (!targetId) {
    return (
      <Screen appbar={appbar}>
        <Empty
          icon="users"
          title="登录后查看关注列表"
          hint="登录后可以关注他人、查看粉丝与共同关注"
          action={
            <button type="button" className="m-btn m-btn--primary" onClick={() => push("auth")}>
              去登录
            </button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen appbar={appbar} bodyClassName="fl-body">
      {me ? (
        <div className="fl-tabs">
          <Segmented<FollowTab>
            items={tabs.map((key) => ({ key, label: FOLLOW_TITLE[key] }))}
            value={tab}
            onChange={setTab}
          />
        </div>
      ) : null}

      {loading ? (
        <Skeletons count={5} />
      ) : error ? (
        <Empty
          icon="info"
          title="列表加载失败"
          hint={error}
          action={
            <button type="button" className="m-btn m-btn--primary m-btn--sm" onClick={() => void load(1, false)}>
              重试
            </button>
          }
        />
      ) : users.length === 0 ? (
        <Empty icon="users" title={FOLLOW_EMPTY[tab].title} hint={FOLLOW_EMPTY[tab].hint} />
      ) : (
        <>
          <div className="fl-list">
            {users.map((row) => (
              <UserRow
                key={row.id}
                user={row}
                onOpen={() => push("user", { id: row.id })}
                onToggleFollow={me && !row.is_self ? () => toggleFollow(row) : undefined}
                busy={busyId === String(row.id)}
                showMutual={tab !== "mutual"}
              />
            ))}
          </div>
          {hasMore ? (
            <button
              type="button"
              className="m-more fl-more"
              disabled={loadingMore}
              onClick={() => void load(page + 1, true)}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </button>
          ) : (
            <div className="fl-end">— 到底了 —</div>
          )}
        </>
      )}
    </Screen>
  );
}
