"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function GoToInner() {
  const params = useSearchParams();
  const target = params.get("to") || "";
  const safe = /^https?:\/\//i.test(target);
  return (
    <div style={{ display: "flex", minHeight: "60vh", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 520, padding: 32, borderRadius: 12, background: "var(--color-bg-secondary, #fff)", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
        <h2 style={{ marginBottom: 12 }}>即将离开妖精论坛</h2>
        {safe ? (
          <>
            <p style={{ marginBottom: 20 }}>你正在访问外部链接：<br /><strong style={{ wordBreak: "break-all" }}>{target}</strong></p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <a className="submit-button" href={target} target="_blank" rel="noopener noreferrer">继续前往</a>
              <button className="submit-button secondary" onClick={() => history.back()}>返回</button>
            </div>
          </>
        ) : (
          <p>无效的链接地址</p>
        )}
      </div>
    </div>
  );
}

export default function GoToPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 40 }}>加载中...</div>}>
      <GoToInner />
    </Suspense>
  );
}
