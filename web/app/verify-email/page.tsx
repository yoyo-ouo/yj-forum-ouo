"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { request } from "@/lib/api";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [status, setStatus] = useState<"loading" | "ok" | "fail">("loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) { setStatus("fail"); setMsg("缺少验证 token"); return; }
    fetch("/api/v1/auth/verify-token?token=" + encodeURIComponent(token) + "&type=email_verify", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) { setStatus("ok"); setMsg("邮箱验证成功！"); }
        else { setStatus("fail"); setMsg("验证失败或链接已过期"); }
      })
      .catch(() => { setStatus("fail"); setMsg("验证失败或链接已过期"); });
  }, [token]);

  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <Header />
      {status === "loading" && <div className="forum-loading">验证中...</div>}
      {status === "ok" && (
        <div style={{ padding: 32, background: "#fff", borderRadius: 12, maxWidth: 400, margin: "0 auto", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
          <h3 style={{ color: "#10b981" }}><i className="fa fa-check-circle"></i> {msg}</h3>
          <p>你的邮箱已通过验证，现在可以使用完整功能。</p>
          <Link className="submit-button" style={{ marginTop: 16 }} href="/">返回首页</Link>
        </div>
      )}
      {status === "fail" && (
        <div style={{ padding: 32, background: "#fff", borderRadius: 12, maxWidth: 400, margin: "0 auto", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
          <h3 style={{ color: "#ef4444" }}><i className="fa fa-times-circle"></i> 验证失败</h3>
          <p>{msg}</p>
          <Link className="submit-button secondary" style={{ marginTop: 16 }} href="/">返回首页</Link>
        </div>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 40 }}>加载中...</div>}>
      <VerifyInner />
    </Suspense>
  );
}
