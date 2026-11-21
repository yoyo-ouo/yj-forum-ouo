import type { Metadata } from "next";
import Link from "next/link";
import CharacterBatchAiHelp from "@/components/character/CharacterBatchAiHelp";
import { pageMetadata } from "@/lib/seo";

// 批量添加规则：静态说明页，内容必须与服务端解析器（character_batch_parse.go）一致。
export const metadata: Metadata = pageMetadata({
  title: "批量添加规则",
  description: "角色批量添加的文本格式、完整英文属性标识符、字段限制、转义规则、错误处理与用户角色配额说明。",
  path: "/character/batch/rules",
  index: false,
});

const IDENTIFIERS: Array<[string, string, string, string]> = [
  ["name", "name", "string", "24 字，必填"],
  ["alias", "alias", "string", "24 字"],
  ["title", "title", "string", "24 字"],
  ["gender", "gender", "integer", "0 = 无 / 1 = 男 / 2 = 女"],
  ["age", "age", "string", "32 字"],
  ["build", "build", "string", "32 字"],
  ["species", "species", "string", "32 字"],
  ["identity", "identity", "string", "32 字"],
  ["description", "description_html", "string（纯文本）", "2000 字，服务端自动转义"],
  ["ability", "abilities", "object（可重复）", "分类:内容；最多 10 项"],
  ["quote", "quotes", "string（可重复）", "120 字；最多 20 条"],
  ["quotes_visible", "quotes_visible", "boolean", "true / false"],
];

export default function CharacterBatchRulesPage() {
  return (
    <div className="cb-page cb-rules">
      <header className="cb-head">
        <div>
          <Link href="/character/batch" className="cb-back">
            <i className="fa fa-arrow-left" aria-hidden="true"></i> 返回批量添加
          </Link>
          <h1>批量添加规则</h1>
          <p>这份说明与服务端实际解析逻辑保持一致；若与页面提示冲突，以服务端返回的错误信息为准。</p>
        </div>
        <Link href="/character/batch" className="cb-btn cb-btn-primary">
          开始批量添加
        </Link>
      </header>

      {/* 顶部第一块：不想手写时，直接复制提示词交给 AI */}
      <CharacterBatchAiHelp />

      <section className="cb-card cb-doc">
        <h2>1. 基本格式</h2>
        <p>每一行代表一个角色（OC），空行会被忽略：</p>
        <pre className="cb-code">{"角色标识符：属性标识符-属性值|属性标识符-属性值"}</pre>
        <ul>
          <li>角色标识符与属性之间支持中文冒号 <code>：</code> 或英文冒号 <code>:</code>。</li>
          <li>属性之间用 <code>|</code> 分隔。</li>
          <li>属性名与属性值之间用第一个 <code>-</code> 分隔；属性值里其余的连字符会原样保留（例如 <code>name-White-Night</code>）。</li>
          <li>一行就是一个角色，不支持跨行续写同一个角色。</li>
        </ul>
        <pre className="cb-code">{"A：name-白夜\nB：name-黑夜|age-20\nC：name-幽悠|age-17|species-人类"}</pre>

        <h2>2. 角色标识符</h2>
        <ul>
          <li>必须是<strong>单个英文字母</strong>（A–Z / a–z），例如 A、B、C。</li>
          <li>同一批次内不能重复。</li>
          <li>它只用于报错定位，不会写进角色名字或其他角色数据。</li>
        </ul>

        <h2>3. 属性标识符</h2>
        <p>属性必须使用完整英文标识符，不接受中文缩写或单字母：</p>
        <div className="cb-table-wrap">
          <table className="cb-table">
            <thead>
              <tr>
                <th>标识符</th>
                <th>对应字段</th>
                <th>类型</th>
                <th>限制</th>
              </tr>
            </thead>
            <tbody>
              {IDENTIFIERS.map(([key, field, type, limit]) => (
                <tr key={key}>
                  <td><code>{key}</code></td>
                  <td>{field}</td>
                  <td>{type}</td>
                  <td>{limit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cb-doc-warn">
          <i className="fa fa-ban" aria-hidden="true"></i>
          没有 <code>high</code> 属性；也不支持通过批量文本设置会馆（<code>guild</code>）。头像与角色图片暂不支持批量设置。
          出现这些属性会被当作未知/不允许的属性直接报错，不会静默忽略。
        </p>

        <h2>4. 字段规则</h2>
        <ul>
          <li><code>name</code> 必填且不能为空；其他单值字段可以省略，省略即使用现有默认值（空串 / 性别「无」/ 不参与彩蛋）。</li>
          <li>除 <code>ability</code> 与 <code>quote</code> 外，其余属性每个角色最多写一次；重复会被报错。</li>
          <li><code>gender</code> 只接受 <code>0</code>、<code>1</code>、<code>2</code> 三个数字，不接受「男 / 女」等文字。</li>
          <li><code>quotes_visible</code> 只接受小写的 <code>true</code> 或 <code>false</code>。</li>
          <li>所有字段值会去掉首尾空白；空属性值会被报错。</li>
        </ul>

        <h2>5. ability（能力，可重复）</h2>
        <p>格式：<code>ability-能力分类:能力内容</code>，分类与内容之间支持中文或英文冒号。</p>
        <p>能力分类必须是现有六大系之一：御灵系、生灵系、锁御系、造物系、心灵系、空间系。单项内容最多 60 字，每个角色最多 10 项。</p>
        <pre className="cb-code">{"A：name-白夜|ability-御灵系:灯影|ability-空间系:空间折叠"}</pre>
        <p>解析结果与现有角色数据结构一致：</p>
        <pre className="cb-code">{"[\n  { \"category\": \"御灵系\", \"detail\": \"灯影\" },\n  { \"category\": \"空间系\", \"detail\": \"空间折叠\" }\n]"}</pre>

        <h2>6. quote 与 quotes_visible</h2>
        <ul>
          <li><code>quote</code> 可以重复，每条最多 120 字，最多 20 条。</li>
          <li>语录里可以正常使用冒号，不会与角色行或能力的分隔符混淆。</li>
          <li><code>quotes_visible-true</code> 表示该角色的语录参与站点彩蛋池；默认 <code>false</code>。</li>
        </ul>
        <pre className="cb-code">{"A：name-白夜|quote-灯不必亮，路自会让人看见。|quote-我一直在这里。"}</pre>

        <h2>7. description（角色描述）</h2>
        <p>
          批量文本只接收<strong>普通文本</strong>，不会执行任何 HTML。服务端会先做 HTML 转义再写入角色描述，
          因此写 <code>&lt;script&gt;</code> 也只会当成普通文字展示；描述单行最多 2000 字。
          需要富文本、图片或引用卡片时，请在创建后进入角色编辑器完善。
        </p>

        <h2>8. 转义规则</h2>
        <p>属性值里需要写字面量特殊字符时使用反斜杠转义：</p>
        <div className="cb-table-wrap">
          <table className="cb-table">
            <thead>
              <tr><th>写法</th><th>含义</th></tr>
            </thead>
            <tbody>
              <tr><td><code>\|</code></td><td>字面量竖线 <code>|</code></td></tr>
              <tr><td><code>\\</code></td><td>字面量反斜杠 <code>\</code></td></tr>
            </tbody>
          </table>
        </div>
        <ul>
          <li>先处理转义，再按 <code>|</code> 分割属性。</li>
          <li>反斜杠后面只能跟 <code>|</code> 或 <code>\</code>；其他写法（例如 <code>\a</code>、末尾单个反斜杠）会报「转义格式错误」。</li>
          <li>普通连字符 <code>-</code> 不需要转义：属性只按第一个 <code>-</code> 分割，值里的连字符会保留。</li>
        </ul>
        <pre className="cb-code">{"A：name-White-Night|title-A\\|B"}</pre>

        <h2>9. 错误处理</h2>
        <p>
          服务端会逐行解析并返回结构化错误（行号、角色标识符、属性标识符、错误码、说明）。
          <strong>只要存在任意一个错误，整个批次都会被拒绝</strong>，不会只创建成功的那部分，也不会自动跳过无效角色。
        </p>
        <div className="cb-table-wrap">
          <table className="cb-table">
            <thead>
              <tr><th>错误码</th><th>常见原因</th></tr>
            </thead>
            <tbody>
              <tr><td><code>INVALID_LINE</code></td><td>缺角色标识符或冒号</td></tr>
              <tr><td><code>INVALID_IDENTIFIER</code> / <code>DUPLICATE_IDENTIFIER</code></td><td>标识符不是单个字母 / 同批次重复</td></tr>
              <tr><td><code>MISSING_NAME</code> / <code>EMPTY_NAME</code></td><td>角色缺少 name / name 为空</td></tr>
              <tr><td><code>UNKNOWN_FIELD</code></td><td>未知属性（包括 guild、high）</td></tr>
              <tr><td><code>DUPLICATE_FIELD</code></td><td>单值字段重复</td></tr>
              <tr><td><code>INVALID_GENDER</code> / <code>INVALID_BOOLEAN</code></td><td>枚举值不合法</td></tr>
              <tr><td><code>INVALID_ABILITY</code> / <code>UNKNOWN_ABILITY_CATEGORY</code></td><td>能力格式或分类不合法</td></tr>
              <tr><td><code>FIELD_TOO_LONG</code> / <code>TOO_MANY_ABILITIES</code> / <code>TOO_MANY_QUOTES</code></td><td>长度或数量超限</td></tr>
              <tr><td><code>INVALID_ESCAPE</code></td><td>转义写法不合法</td></tr>
              <tr><td><code>BATCH_TOO_LARGE</code></td><td>单次超过 20 个角色或原文超过 64 KB</td></tr>
            </tbody>
          </table>
        </div>

        <h2>10. 配额与草稿</h2>
        <ul>
          <li>每位用户最多拥有 <strong>60 个角色设定</strong>（草稿、已公开、已下架都计入）。</li>
          <li>剩余配额 = 60 − 当前角色数量；本次准备创建的数量必须小于或等于剩余配额，否则整个批次无法继续。</li>
          <li>预览阶段会检查一次配额；正式提交时会在数据库事务内再次检查，并发请求也不会突破 60 个上限。</li>
          <li>所有批量创建的角色都是<strong>草稿</strong>，不会自动发布，也不会自动加入会馆。</li>
          <li>确认按钮需等待 3 秒后开放；服务端也会校验预览凭证的生成时间，防止绕过前端倒计时。</li>
          <li>预览凭证有效期 10 分钟，且绑定当前用户与原文内容；修改原文后必须重新解析预览。</li>
        </ul>

        <h2>11. 完整示例</h2>
        <pre className="cb-code">{
"A：name-白夜|alias-夜|title-守灯人|gender-1|age-20|build-修长|species-人类|identity-旅人|description-总在灯下等到最后一个路人。|ability-御灵系:灯影|quote-灯不必亮，路自会让人看见。|quotes_visible-true\n" +
"B：name-黑夜|gender-2|age-21|ability-空间系:空间折叠|quote-我一直在这里。"
        }</pre>
        <p>
          上面两行会创建两个角色草稿：A 白夜（含一条能力、一条彩蛋语录）与 B 黑夜（含一项空间系能力）。
          创建后可在角色编辑器里继续补头像、图片、会馆等信息，确认无误后再发布。
        </p>
      </section>

      <div className="cb-rules-foot">
        <Link href="/character/batch" className="cb-btn cb-btn-primary">
          <i className="fa fa-arrow-left" aria-hidden="true"></i> 返回批量添加
        </Link>
      </div>
    </div>
  );
}
