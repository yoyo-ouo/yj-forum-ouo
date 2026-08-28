"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function GoToInner() {
  const params = useSearchParams();
  const target = params.get("to") || "";
  const safe = /^https?:\/\//i.test(target);
  return (
    <>
      <div className="goto-container">
        <div className="goto-card">
          <div className="goto-icon">
            <i className="fa fa-exclamation-triangle"></i>
          </div>
          <h2>即将离开妖精论坛</h2>
          <p className="goto-tip">无法验证以下链接的安全性，是否确认跳转？</p>
          <div className="goto-url" id="goto-url-box">{safe ? target : "（未提供跳转目标）"}</div>
          <div className="goto-actions">
            <button className="goto-btn goto-btn-cancel" onClick={() => window.history.back()}>
              <i className="fa fa-arrow-left"></i> 返回上一页
            </button>
            {safe && (
              <a className="goto-btn goto-btn-confirm" id="goto-confirm" href={target} target="_blank" rel="nofollow noopener noreferrer">
                <i className="fa fa-external-link"></i> 继续访问
              </a>
            )}
          </div>
          <p className="goto-warn">提示：该链接由用户发布，请注意防范钓鱼、诈骗等风险。</p>
        </div>
      </div>
    </>
  );
}

export default function GoToPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 40 }}>加载中...</div>}>
      <GoToInner />
    </Suspense>
  );
}
