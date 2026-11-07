"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  convertYear,
  formatGregorianYear,
  formatInfiniteYear,
  shanghaiToday,
  toInfinite,
  type Calendar,
  type ConversionResult,
  type GregorianEra,
  type InfiniteEra,
  type Today,
} from "@/lib/year-conversion";

// ===== 无限历 ⇄ 公元历（统一入口）=====
// 一个表单 + 方向切换，双向换算共用 lib/year-conversion 的同一套口径；
// 支持「元年」显示与直接输入「元年」。

type Direction = "infinite-to-gregorian" | "gregorian-to-infinite";

type AnyEra = InfiniteEra | GregorianEra;

interface FormState {
  era: AnyEra;
  year: string;
  month: string;
  day: string;
}

const DIRECTION_META: Record<Direction, { label: string; source: Calendar; target: Calendar; desc: string }> = {
  "infinite-to-gregorian": {
    label: "无限历 → 公元历",
    source: "infinite",
    target: "gregorian",
    desc: "公元 1604 年之前为「无限前」，请切换纪年并填写正数年份。",
  },
  "gregorian-to-infinite": {
    label: "公元历 → 无限历",
    source: "gregorian",
    target: "infinite",
    desc: "公元前请选择「公元前」并填写正数年份；公元纪年没有 0 年。",
  },
};

function ResultPanel({ result }: { result: ConversionResult | null }) {
  if (!result) {
    return (
      <div className="yc-result yc-result-idle">
        <i className="fa fa-info-circle" aria-hidden="true"></i>
        <p>填写年、月、日后点击「换算」查看结果</p>
      </div>
    );
  }
  const icon =
    result.type === "success" ? "fa-check-circle" : result.type === "warning" ? "fa-exclamation-triangle" : "fa-times-circle";
  return (
    <div className={`yc-result yc-result-${result.type}`} role={result.type === "error" ? "alert" : "status"}>
      <i className={`fa ${icon}`} aria-hidden="true"></i>
      <p>{result.message}</p>
    </div>
  );
}

export default function YearConverterPage() {
  const [today, setToday] = useState<Today | null>(null);
  const [direction, setDirection] = useState<Direction>("infinite-to-gregorian");
  const [form, setForm] = useState<FormState>({ era: "after", year: "", month: "", day: "" });
  const [useYuanNian, setUseYuanNian] = useState(true);
  const [result, setResult] = useState<ConversionResult | null>(null);

  useEffect(() => {
    // 时钟属于外部系统：挂载后一个 tick 再读，避免 SSR/客户端首帧时区差异与同步 setState
    const t = window.setTimeout(() => setToday(shanghaiToday()), 0);
    return () => window.clearTimeout(t);
  }, []);

  const meta = DIRECTION_META[direction];
  const isInfiniteSource = meta.source === "infinite";

  const switchDirection = (next: Direction) => {
    if (next === direction) return;
    setDirection(next);
    setForm({ era: next === "infinite-to-gregorian" ? "after" : "ce", year: "", month: "", day: "" });
    setResult(null);
  };

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResult(
      convertYear(
        { calendar: meta.source, era: form.era, year: form.year, month: form.month, day: form.day },
        meta.target,
        { useYuanNian }
      )
    );
  };

  const todayInfinite = today ? toInfinite(today.year) : null;

  return (
    <div className="year-converter-page">
      <header className="yc-header">
        <h1 className="yc-heading">
          <i className="fa fa-calendar" aria-hidden="true"></i> 无限年换算
        </h1>
        <p className="yc-subtitle">
          统一入口：选择方向后一次完成「无限历 ⇄ 公元历」换算。基准：无限元年 = 公元 1604 年。
        </p>
        {today && todayInfinite && (
          <div className="yc-today">
            <i className="fa fa-clock-o" aria-hidden="true"></i>
            <span>
              今天是 {formatGregorianYear(today.year, useYuanNian)} {today.month} 月 {today.day} 日
            </span>
            <span className="yc-today-sep" aria-hidden="true">·</span>
            <span>
              {formatInfiniteYear(todayInfinite.year, todayInfinite.before, useYuanNian)} {today.month} 月 {today.day} 日
            </span>
          </div>
        )}
      </header>

      <div className="yc-direction" role="tablist" aria-label="换算方向">
        {(Object.keys(DIRECTION_META) as Direction[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={direction === key}
            className={`yc-direction-btn${direction === key ? " active" : ""}`}
            onClick={() => switchDirection(key)}
          >
            <i className={`fa ${key === "infinite-to-gregorian" ? "fa-long-arrow-right" : "fa-long-arrow-left"}`} aria-hidden="true"></i>
            {DIRECTION_META[key].label}
          </button>
        ))}
      </div>

      <section className="yc-card" aria-labelledby="yc-convert-title">
        <h2 className="yc-card-title" id="yc-convert-title">
          <i className="fa fa-exchange" aria-hidden="true"></i> {meta.label}
        </h2>
        <p className="yc-card-desc">{meta.desc}</p>
        <form className="yc-form" onSubmit={submit}>
          <div className="yc-field-row">
            <label className="yc-field">
              <span>纪年</span>
              <select value={form.era} onChange={(e) => update({ era: e.target.value as AnyEra })}>
                {isInfiniteSource ? (
                  <>
                    <option value="after">无限</option>
                    <option value="before">无限前</option>
                  </>
                ) : (
                  <>
                    <option value="ce">公元</option>
                    <option value="bce">公元前</option>
                  </>
                )}
              </select>
            </label>
            <label className="yc-field yc-field-grow">
              <span>年</span>
              <input
                type="text"
                inputMode="numeric"
                value={form.year}
                onChange={(e) => update({ year: e.target.value })}
                placeholder={isInfiniteSource ? "如 423 或 元年" : "如 2026 或 元年"}
              />
            </label>
          </div>
          <div className="yc-field-row">
            <label className="yc-field">
              <span>月</span>
              <input
                type="text"
                inputMode="numeric"
                value={form.month}
                onChange={(e) => update({ month: e.target.value })}
                placeholder="1-12"
              />
            </label>
            <label className="yc-field">
              <span>日</span>
              <input
                type="text"
                inputMode="numeric"
                value={form.day}
                onChange={(e) => update({ day: e.target.value })}
                placeholder="1-31"
              />
            </label>
          </div>
          <label className="yc-yuan-toggle">
            <input type="checkbox" checked={useYuanNian} onChange={(e) => setUseYuanNian(e.target.checked)} />
            <span>第 1 年显示为「元年」（如无限元年 / 公元元年）</span>
          </label>
          <button type="submit" className="yc-submit-btn">
            <i className="fa fa-exchange" aria-hidden="true"></i> 换算
          </button>
        </form>
        <ResultPanel result={result} />
        <p className="yc-formula">无限 N 年 = 公元 (1603 + N) 年；公元 1603 年及以前 = 无限前 (1604 - 公元年) 年。</p>
      </section>

      <section className="yc-rules" aria-labelledby="yc-rules-title">
        <h2 className="yc-rules-title" id="yc-rules-title">
          <i className="fa fa-book" aria-hidden="true"></i> 换算规则
        </h2>
        <ul className="yc-rules-list">
          <li>无限元年 = 公元 1604 年；无限 N 年 = 公元 (1603 + N) 年。</li>
          <li>公元 1603 年及以前记为「无限前」：无限前 1 年 = 公元 1603 年。</li>
          <li>两套纪年都不存在 0 年：无限前 1 年之后直接是无限元年；公元前 1 年之后直接是公元 1 年。</li>
          <li>第 1 年可显示为「元年」，也可直接在上方年份框输入「元年」。</li>
          <li>2 月 29 日只在闰年存在；目标年份不是闰年时会给出提示，不输出无效日期。</li>
          <li>年、月、日之外不改变月日，仅在换算年份时同步提示该日期在目标年是否有效。</li>
        </ul>
      </section>
    </div>
  );
}
