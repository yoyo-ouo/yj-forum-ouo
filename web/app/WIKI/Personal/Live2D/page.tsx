"use client";
import { useState, useEffect } from "react";
import Header from "@/components/Header";

const GIFS = ["/assets/live2d/standby.gif", "/assets/live2d/hey.gif", "/assets/live2d/wake.gif", "/assets/live2d/jump.gif", "/assets/live2d/iron.gif"];
const NAMES = ["待机", "嘿咻", "惊醒", "起跳", "铁片"];

export default function Live2DPage() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % GIFS.length), 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ paddingTop: "70px" }}>
      <Header />
      <div className="wiki-page">
        <div className="wiki-header">
          <h2>罗小黑Live2D模型</h2>
          <h6 style={{ color: "red" }}>不可下载，仅供展示</h6>
        </div>

        <div className="live2d-author-card">
          <div className="live2d-author-label">Live2D 模型原作者</div>
          <div className="live2d-author-info">
            <i className="fa fa-paint-brush live2d-author-icon"></i>
            <div className="live2d-author-text">
              <span className="live2d-author-name">@盒装现烤奕潞</span>
              <span className="live2d-author-desc">在小红书收获了199.2K次赞与收藏</span>
            </div>
          </div>
          <a href="https://xhslink.com/m/7kf365dQt3n" target="_blank" rel="noopener noreferrer" className="live2d-author-link">
            查看Ta的主页 <i className="fa fa-arrow-right"></i>
          </a>
        </div>

        <div className="live2d-container">
          <div className="live2d-canvas-wrapper">
            <img src={GIFS[idx]} alt={NAMES[idx]} style={{ width: "100%", borderRadius: 12 }} />
            <div className="live2d-loading" style={{ textAlign: "center", marginTop: 8, fontSize: 13, color: "#999" }}>
              动作：{NAMES[idx]}（自动轮播，每4秒切换）
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
