"use client";

// 角色设定独立页：只读完整立绘卡 + 点赞 + 返回所有者主页。

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import CharacterSheetCard from "@/components/character/CharacterSheetCard";
import BackButton from "@/components/ui/BackButton";
import { useToast } from "@/components/Toast";
import { useStore } from "@/lib/store";
import { ApiException } from "@/lib/api";
import { characterApi, type CharacterSheet } from "@/lib/api/character";

export default function CharacterPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { user } = useStore();
  const { toast } = useToast();
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    characterApi
      .detail(id)
      .then((r) => {
        if (!alive) return;
        setSheet(r.item);
        setError("");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof ApiException ? e.message : "加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const handleLike = async () => {
    if (!sheet) return;
    if (!user) {
      toast("登录后才能点赞", "info");
      return;
    }
    try {
      const r = await characterApi.like(sheet.id);
      setSheet({ ...sheet, liked: r.liked, like_count: r.likes });
    } catch (e) {
      toast(e instanceof ApiException ? e.message : "操作失败", "error");
    }
  };

  return (
    <div className="cs-page">
      <BackButton />
      <div className="cs-page-inner">
        {loading ? (
          <p className="loading-text">加载中…</p>
        ) : error ? (
          <div className="cs-page-empty">
            <i className="fa fa-chain-broken" aria-hidden="true"></i>
            <p>{error}</p>
            <Link href="/forum" className="cs-btn cs-btn-ghost">
              回论坛逛逛
            </Link>
          </div>
        ) : sheet ? (
          <>
            <CharacterSheetCard sheet={sheet} expanded hideExpand onLike={sheet.mine ? undefined : handleLike} showOwner />
            <div className="cs-page-foot">
              <Link href={`/users/${sheet.user_id}`} className="cs-btn cs-btn-ghost">
                <i className="fa fa-user-o" aria-hidden="true"></i> 去 {sheet.owner_name || "TA"} 的主页
              </Link>
              {sheet.published_at ? (
                <span className="cs-page-time">
                  发布于 {new Date(sheet.published_at).toLocaleDateString("zh-CN")}
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
