import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { fetchApi, pageMetadata, truncate } from "@/lib/seo";

// 角色设定页：只读、noindex（用户生成内容不进入搜索引擎）、可分享。

interface SheetResp {
  item?: {
    id: string;
    name: string;
    title?: string;
    alias?: string;
    status: number;
    owner_name?: string;
    description_html?: string;
  };
}

const getSheet = cache(async (id: string) => {
  const r = await fetchApi<SheetResp>(`/character-sheets/${encodeURIComponent(id)}`);
  return { ok: r.ok, status: r.status, sheet: r.data?.item ?? null };
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { ok, sheet } = await getSheet(id);
  if (!ok || !sheet || sheet.status !== 1) {
    return pageMetadata({
      title: "设定不存在",
      description: "该角色设定不存在或尚未公开。",
      path: `/character/${encodeURIComponent(id)}`,
      index: false,
    });
  }
  const plain = (sheet.description_html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const description =
    truncate(plain, 140) || `${sheet.name}${sheet.title ? `「${sheet.title}」` : ""} 的角色设定。`;
  return pageMetadata({
    title: `${sheet.name}${sheet.title ? `「${sheet.title}」` : ""} 的设定`,
    description,
    path: `/character/${encodeURIComponent(id)}`,
    index: false,
  });
}

export default async function CharacterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ok, status } = await getSheet(id);
  if (!ok && status === 404) notFound();
  return <>{children}</>;
}
