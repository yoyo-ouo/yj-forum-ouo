"use client";
import { useState } from "react";
import Header from "@/components/Header";

const GIFS = [
  { src: "/assets/live2d/standby.gif", name: "待机" },
  { src: "/assets/live2d/hey.gif", name: "嘿咻" },
  { src: "/assets/live2d/wake.gif", name: "惊醒" },
  { src: "/assets/live2d/jump.gif", name: "起跳" },
  { src: "/assets/live2d/iron.gif", name: "铁片" },
];

export default function Live2DPage() {
  const [idx, setIdx] = useState(0);
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
            <img src={GIFS[idx].src} alt={GIFS[idx].name} style={{ width: "100%", borderRadius: 12 }} />
            <div className="live2d-loading" id="live2d-loading" style={{ position: "static", display: "block", textAlign: "center", marginTop: 8, fontSize: 13, color: "#999" }}>
              动作：{GIFS[idx].name}（点击下方卡片切换）
            </div>
          </div>
        </div>

        <div className="live2d-actions-section">
          <h3 className="live2d-actions-title">动作示例</h3>
          <div className="live2d-actions-grid">
            {GIFS.map((g, i) => (
              <button key={g.name} className={`live2d-action-card ${i === idx ? "active" : ""}`} onClick={() => setIdx(i)}>
                <div className="live2d-action-gif">
                  <img src={g.src} alt={g.name} loading="lazy" />
                </div>
                <span className="live2d-action-name">{g.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="wiki-footer">
          <p>点击模型可以互动哦~</p>
        </div>
      </div>
    </div>
  );
}
