import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

// 批量添加 OC：登录后使用的功能页，不进入搜索引擎。
export const metadata: Metadata = pageMetadata({
  title: "批量添加 OC",
  description: "按固定文本格式一次添加多个角色设定，服务端解析校验后统一创建为草稿。",
  path: "/character/batch",
  index: false,
});

export default function CharacterBatchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
