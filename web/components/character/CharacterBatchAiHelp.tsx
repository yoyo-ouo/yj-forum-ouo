"use client";

// ===== 批量添加：AI 提示词帮助区块 =====
// 规则页顶部展示：一键复制提示词，用户把它和 OC 资料一起发给 AI 软件，
// 再把 AI 输出的文本粘回批量添加页。提示词内容必须与服务端解析规则一致。

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const FENCE = "```";

export const AI_PROMPT = String.raw`你是一名角色设定整理助手。请把我提供的 OC（原创角色）资料，整理成「妖精论坛批量添加 OC」规定的纯文本格式。

【分析指南】
1. 先通读资料，确认有几个角色；一个角色一行，不要合并，也不要跨行续写。
2. 逐个角色提取：name 必须有；alias、title、gender、age、build、species、identity、description 有就填，没有就省略。
3. 能力：把资料里的能力归入六大系（御灵系、生灵系、锁御系、造物系、心灵系、空间系）；无法判断分类时先问我，不要硬猜。
4. 语录：只收我明确给出的原话，不要自己编。
5. 资料里出现会馆、头像、图片、等信息时忽略，并在输出前提一句「已忽略不支持的字段」。
6. 如果 name 缺失、一个角色有多个可能的名字、性别或能力分类无法判断，先向我提问；等我确认后再输出。
7. 输出前自检：每行有 name；标识符唯一；单值字段不重复；值里没有未转义的 |；能力分类合法；数量不超限。

【输出格式】
每一行代表一个角色，格式为：
角色标识符：属性标识符-属性值|属性标识符-属性值
- 角色标识符必须是单个英文字母（A-Z / a-z），同一批次内不能重复；只用于定位，不会写入角色数据。
- 角色标识符与属性之间使用中文冒号「：」或英文冒号「:」。
- 属性之间用竖线「|」分隔。
- 属性名与属性值之间用第一个「-」分隔；属性值里可以正常包含连字符。

【可用属性（必须使用完整英文标识符）】
- name：角色名字，必填，最多 24 字。
- alias：别称，最多 24 字。
- title：称号，最多 24 字。
- gender：性别，只能是 0（无）/ 1（男）/ 2（女）。
- age：年龄，文本，最多 32 字。
- build：体型（也就是身高，可以写具体的例如「165cm」，也可以写为「娇小的」这种形容词），最多 32 字。
- species：种族，最多 32 字。
- identity：身份，最多 32 字。
- description：角色描述，纯文本，最多 2000 字；不要写 HTML。
- ability：能力，可重复，格式为「能力分类:能力内容」。分类只能是：御灵系、生灵系、锁御系、造物系、心灵系、空间系。能力内容最多 60 字，每个角色最多 10 项。
- quote：角色语录，可重复，每条最多 120 字，每个角色最多 20 条。
- quotes_visible：语录是否参与站点彩蛋，只能写 true 或 false；没有要求就省略。

【正向示例（仅示意格式，不要原样照抄）】
${FENCE}text
A：name-黑刃|alias-刃|title-断夜者|gender-1|age-二十七|build-修长|species-妖族|identity-游侠|description-总在雨夜出现，刀鞘上缠着褪色的红绳。|ability-锁御系:断刃|ability-空间系:影跃|quote-刀出鞘之前，我从不问对错。|quotes_visible-true
B：name-灰烬|gender-2|age-十九|species-人类|identity-记录者|quote-我负责记住他们。
${FENCE}

【反向示例（错误，不要这样做）】
- A：name-黑刃|guild-12 —— guild 不是合法属性，会报 UNKNOWN_FIELD。
- B：age-20|quote-你好 —— 缺少 name，会报 MISSING_NAME。
- A：name-黑刃 与 A：name-灰烬 —— 标识符 A 重复，会报 DUPLICATE_IDENTIFIER。
- A：name-黑刃|gender-男 —— gender 只接受 0/1/2。
- A：name-黑刃|ability-水系:水刃 —— 能力分类不存在。
- A：name-黑刃|title-断|夜 —— 未转义的 | 会被当成属性分隔符；字面量竖线要写成 \|。

【禁止项】
- 不要使用 guild（会馆）属性，这不是合法字段。
- 不要输出头像、图片或媒体 ID。
- 不要编造我资料里没有的信息；缺失的可选属性直接省略，但 name 必须有。
- 不要合并角色，也不要跨行续写同一个角色。

【转义】
- 属性值里需要写竖线时用「\|」，需要写反斜杠时用「\\」。
- 反斜杠后面只能跟「|」或「\」，其他写法会报解析错误。

【数量限制】
- 单次最多整理 20 个角色，原文不超过 64KB。
- 如果我的资料超过 20 个角色，请提醒我分批，不要自行截断。

【最终输出】
- 资料齐全且没有不确定项时，只输出一个 Markdown 代码块（语言标记 text），代码块内只放批量文本；代码块外不要写解释。
- 我会点击代码块的复制按钮，把内容粘贴到批量添加页面。
- 如果资料不完整或存在不确定项，先不要输出代码块，先用简短的问题向我确认。

现在我会在下面提供 OC 资料。请先检查是否有 name；如果缺少 name，请先问我。资料齐全后，按上述规则输出。

---`;

/** 复制到剪贴板：优先 Clipboard API，失败时回退到临时 textarea。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走回退方案
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export default function CharacterBatchAiHelp() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    setFailed(false);
    const ok = await copyText(AI_PROMPT);
    if (!ok) {
      setCopied(false);
      setFailed(true);
      return;
    }
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2400);
  }, []);

  return (
    <section className="cb-ai-help" id="ai" aria-labelledby="cb-ai-title">
      <header className="cb-ai-head">
        <span className="cb-ai-badge" aria-hidden="true">
          <i className="fa fa-magic"></i>
        </span>
        <div>
          <h2 id="cb-ai-title">不想手动整理？让 AI 来帮你</h2>
          <p>
            把提示词和你的 OC 资料一起发给 AI；它会在 Markdown 代码块里返回整理好的批量文本，再粘回批量添加页面即可。
          </p>
        </div>
      </header>

      <ol className="cb-ai-steps">
        <li>
          <b>复制提示词</b>：点击下面的按钮。
        </li>
        <li>
          <b>打开你常用的 AI 软件</b>：ChatGPT、DeepSeek、豆包、Kimi 等都可以。
        </li>
        <li>
          <b>把你的 OC 资料也一起发过去</b>：名字、年龄、体型、种族、能力、语录等，越详细越好。
          <strong>记得一起丢给 AI，不要只发提示词。</strong>
        </li>
        <li>
          <b>复制 AI 的结果</b>：点 AI 回复里代码块的复制按钮（不同软件位置略有差异），
          再粘到{" "}
          <Link href="/character/batch">批量添加页面</Link>，先点「解析预览」检查，再确认创建。
        </li>
      </ol>

      <div className="cb-ai-actions">
        <button type="button" className="cb-btn cb-btn-primary" onClick={() => void handleCopy()}>
          <i className={`fa ${copied ? "fa-check" : "fa-copy"}`} aria-hidden="true"></i>
          {copied ? "已复制，去粘给 AI 吧" : "点击此按钮复制提示词"}
        </button>
        <span className="cb-ai-note" role="status">
          {failed
            ? "复制失败，请手动选中下方提示词复制。"
            : "提示词已包含分析指南、正/反示例、格式限制与转义规则。"}
        </span>
      </div>

      <details className="cb-ai-details">
        <summary>查看提示词内容</summary>
        <pre className="cb-code cb-ai-prompt">{AI_PROMPT}</pre>
      </details>

      <p className="cb-hint">
        <i className="fa fa-info-circle" aria-hidden="true"></i>
        AI 可能编造不存在的字段或写错格式；最终以批量添加页面的「解析预览」结果为准。
      </p>
    </section>
  );
}
