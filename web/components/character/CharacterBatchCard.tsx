"use client";

// ===== 批量添加：单个 OC 预览卡 =====
// 数据完全来自服务端解析结果（CharacterBatchItem.payload），前端不重新解析。
// 空字段统一显示「暂无填写」，避免用户以为被静默丢弃。

import RichContent from "@/components/ui/RichContent";
import { categoryIndex, genderLabel } from "@/lib/character-constants";
import type { CharacterBatchItem } from "@/lib/api/character";

export default function CharacterBatchCard({ item }: { item: CharacterBatchItem }) {
  const p = item.payload;
  const abilities = p.abilities || [];
  const quotes = (p.quotes || []).filter((q) => (q.content || "").trim());
  const sub = [p.title, p.alias].filter(Boolean).join(" · ");

  return (
    <article className="cb-char">
      <header className="cb-char-head">
        <span className="cb-char-id" aria-label={`角色标识符 ${item.identifier}`}>
          {item.identifier}
        </span>
        <div className="cb-char-title">
          <h3>{p.name || "未命名角色"}</h3>
          <p>{sub || "暂无称号 / 别称"}</p>
        </div>
        <span className="cb-char-line">第 {item.line} 行</span>
      </header>

      <dl className="cb-char-attrs">
        <div>
          <dt>性别</dt>
          <dd>{genderLabel(p.gender)}</dd>
        </div>
        <div>
          <dt>年龄</dt>
          <dd>{p.age || "暂无填写"}</dd>
        </div>
        <div>
          <dt>体型</dt>
          <dd>{p.build || "暂无填写"}</dd>
        </div>
        <div>
          <dt>种族</dt>
          <dd>{p.species || "暂无填写"}</dd>
        </div>
        <div className="cb-char-attr-wide">
          <dt>身份</dt>
          <dd>{p.identity || "暂无填写"}</dd>
        </div>
      </dl>

      <section className="cb-char-sec">
        <h4>
          能力<span className="cb-char-count">{abilities.length} / 10</span>
        </h4>
        {abilities.length > 0 ? (
          <div className="cb-char-abilities">
            {abilities.map((a, i) => (
              <span key={`${a.category}-${i}`} className={`cs-ab cs-ab-${categoryIndex(a.category)}`}>
                {a.detail ? `${a.category} · ${a.detail}` : a.category}
              </span>
            ))}
          </div>
        ) : (
          <p className="cb-char-empty">暂无填写</p>
        )}
      </section>

      <section className="cb-char-sec">
        <h4>角色描述</h4>
        {p.description_html ? (
          <RichContent content={p.description_html} className="cb-char-desc" />
        ) : (
          <p className="cb-char-empty">暂无填写</p>
        )}
      </section>

      <section className="cb-char-sec">
        <h4>
          角色语录<span className="cb-char-count">{quotes.length} / 20</span>
          {p.quotes_visible ? <span className="cb-char-tag">参与彩蛋</span> : null}
        </h4>
        {quotes.length > 0 ? (
          <ul className="cb-char-quotes">
            {quotes.map((q, i) => (
              <li key={i}>{q.content}</li>
            ))}
          </ul>
        ) : (
          <p className="cb-char-empty">暂无填写</p>
        )}
      </section>

      <footer className="cb-char-foot">
        <i className="fa fa-home" aria-hidden="true"></i> 创建后请在编辑器里单独设置会馆
      </footer>
    </article>
  );
}
