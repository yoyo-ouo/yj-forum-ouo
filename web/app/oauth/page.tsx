"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useEffect, useState } from "react";
import { userApi } from "@/lib/api";
import { ApiException } from "@/lib/api";

function OAuthInner() {
  const params = useSearchParams();
  const port = params.get("port") || "";
  const [name, setName] = useState("Loading...");
  const [user, setUser] = useState<{ id: string; name: string; avatar: string } | null>(null);
  const [status, setStatus] = useState("");
  const [statusClass, setStatusClass] = useState("");

  useEffect(() => {
    const appId = params.get("app_id");
    if (appId !== "TheDoorOfBings") {
      setStatus("Unknown application");
      setStatusClass("status-err");
      return;
    }
    userApi.me().then((d) => {
      if (d.user) {
        setUser({ id: d.user.id, name: d.user.name, avatar: d.user.avatar || "" });
        setName(d.user.name);
      } else {
        setName("Not logged in");
        setStatus("Please login to the forum first");
        setStatusClass("status-err");
      }
    }).catch((e) => {
      if (e instanceof ApiException && e.status === 401) {
        setName("Not logged in");
        setStatus("Please login to the forum first");
        setStatusClass("status-err");
      } else {
        setName("Network error");
      }
    });
  }, [params]);

  const doAuth = () => {
    if (!user) return;
    const userData = JSON.stringify({ id: user.id, name: user.name, avatar: user.avatar });
    const url = "http://localhost:" + port + "/callback?user=" + encodeURIComponent(userData);
    window.location.href = url;
  };

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif", background: "#0d1117", color: "#c9d1d9", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0 }}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 32, width: 400, maxWidth: "90vw", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginBottom: 16, color: "#f0f6fc" }}>Third-party Login</h1>
        <p style={{ fontSize: 14, color: "#8b949e", marginBottom: 24, lineHeight: 1.6 }}>An application wants to access your forum account info. Please confirm to proceed.</p>
        <div style={{ background: "#0d1117", borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: "bold", color: "#58a6ff" }} id="username">{name}</div>
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button style={{ padding: "10px 24px", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer", background: "#238636", color: "white" }} disabled={!user} onClick={doAuth}>Authorize</button>
          <button style={{ padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer", background: "#21262d", color: "#c9d1d9", border: "1px solid #30363d" }} onClick={() => window.close()}>Deny</button>
        </div>
        <div style={{ marginTop: 16, fontSize: 13, minHeight: 20, color: statusClass === "status-err" ? "#f85149" : "#3fb950" }}>{status}</div>
      </div>
    </div>
  );
}

export default function OAuthPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading...</div>}>
      <OAuthInner />
    </Suspense>
  );
}
