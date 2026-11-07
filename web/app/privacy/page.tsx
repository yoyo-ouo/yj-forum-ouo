
import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "隐私政策",
  description: "妖精论坛隐私政策：说明我们如何收集、使用、存储和保护您的个人信息。",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <>
      <div className="privacy-page">
        <div className="privacy-header">
          <h2><i className="fa fa-shield"></i> 隐私政策</h2>
          <p className="privacy-intro">
            妖精论坛非常重视您的隐私。本政策用简洁易懂的方式说明：我们会收集哪些信息、如何使用与保护它们，以及您拥有哪些权利，希望能帮您快速了解。
          </p>
          <span className="privacy-updated"><i className="fa fa-clock-o"></i> 最后更新：2026年11月7日</span>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-database"></i></span>我们收集的信息</h3>
          <p>为了提供和维护服务，我们会收集以下信息：</p>
          <ul className="privacy-list">
            <li><b>账号资料</b>：用户名、邮箱、头像、性别、生日、个性签名等；密码会经过加密存储，我们无法看到您的原始密码；</li>
            <li><b>内容数据</b>：您发布的帖子（含定时发布时间）、评论（富文本、图片、引用）、收藏、关注、会馆与入馆申请、会馆文章，以及您在消息中心与管理团队的聊天记录等；</li>
            <li><b>互动数据</b>：点赞（含「谁赞了我」的点赞记录）、世界频道发言、签到日期与灵力值等互动记录（灵力值会公开展示）；</li>
            <li><b>反馈数据</b>：使用反馈中心时填写的标题、描述与复现步骤；联系方式为选填，且仅管理员可见；您也可以不登录、匿名提交反馈；</li>
            <li><b>技术信息</b>：访问日志中的 IP 地址、浏览器标识（User-Agent）、访问时间等，用于安全防护与问题排查；</li>
            <li><b>本地存储</b>：登录会话 Cookie（有效期 14 天）、账号标识 Cookie，以及保存在浏览器本地的主题偏好等。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-cogs"></i></span>信息的使用</h3>
          <p>我们收集的信息仅用于以下目的：</p>
          <ul className="privacy-list">
            <li>提供核心功能（登录、发帖、评论、收藏、关注、会馆、签到、消息中心、世界频道等）；</li>
            <li>消息与通知：把赞、评论、系统通知、管理团队聊天等消息汇总到消息中心，并通过 SSE（Server-Sent Events）建立实时连接，让新消息及时送达；</li>
            <li>「谁赞了我」：当其他用户赞了您的帖子或评论时，记录点赞用户与对应内容，并在消息中心展示；</li>
            <li>会馆申请与审批：处理入馆申请，并将审批结果通过站内通知告知申请人；</li>
            <li>内容运营与审核：管理员通过运营管理后台查看与处理站内内容；</li>
            <li>安全风控：登录校验、访问限流、反滥用检测，并在必要时发送登录提醒；</li>
            <li>服务通知邮件：发送验证码、密码重置、邮箱换绑、登录提醒、入馆审批结果等；</li>
            <li>记住您的偏好（如明/暗主题），改善使用体验；</li>
            <li>以汇总、统计的方式了解服务运行情况，帮助我们改进产品。</li>
          </ul>
          <p>我们<b>不会</b>出售或出租您的个人信息。</p>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-lock"></i></span>信息的存储与保护</h3>
          <ul className="privacy-list">
            <li>全站通过 HTTPS 加密传输；</li>
            <li>密码使用 bcrypt 哈希存储，我们不会以任何形式保存明文密码；</li>
            <li>会话 Cookie 设置了 HttpOnly 等安全属性（SameSite 采用浏览器默认的 Lax 策略），登录会话有效期为 14 天；</li>
            <li>您上传的图片、附件等媒体资源保存在对象存储服务中，并通过 HTTPS 访问；</li>
            <li>内部遵循最小化的访问控制，只有必要的人员才能接触相关数据。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-comments"></i></span>消息中心与世界频道</h3>
          <ul className="privacy-list">
            <li><b>消息中心</b>：汇总「赞」「评论」「系统」「管理团队」四类消息并显示未读数量，消息内容仅您本人可见；</li>
            <li><b>谁赞了我</b>：当其他用户赞了您的帖子或评论时，会记录点赞用户与对应内容，并在消息中心展示；</li>
            <li><b>实时连接</b>：页面通过 SSE（Server-Sent Events）与服务器保持长连接以接收新消息，断线后会自动重连；该连接仅用于推送与您账号相关的消息；</li>
            <li><b>世界频道</b>：公开的聊天频道，您发送的内容会对所有用户可见，请不要在其中填写密码、邮箱等敏感信息；</li>
            <li><b>会馆申请与审批</b>：入馆申请理由等信息仅会馆管理员与站务可见，审批结果会通过站内通知告知您。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-shield"></i></span>人机验证（ALTCHA）</h3>
          <ul className="privacy-list">
            <li>登录、注册、找回密码等操作会进行 ALTCHA 人机验证；验证在您的浏览器本地完成工作量证明计算，计算结果仅用于本次请求的校验；</li>
            <li>人机验证不会采集指纹、面容等生物特征，也不会读取设备唯一标识；</li>
            <li>若浏览器无法完成验证，请更换浏览器或稍后重试。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-coffee"></i></span>Cookie 与本地存储</h3>
          <ul className="privacy-list">
            <li><b>登录会话</b>：名为 forum_session 的 Cookie 用于保持您的登录状态，有效期为 14 天；</li>
            <li><b>账号标识</b>：名为 user_id 的 Cookie（有效期 14 天，非 HttpOnly）用于在页面上识别当前登录账号；</li>
            <li><b>主题偏好</b>：您选择的明/暗主题保存在浏览器 localStorage 中（仅存于本机）；</li>
            <li><b>PWA 与 Service Worker</b>：将本站安装为 PWA 后，Service Worker 会缓存部分静态资源以加快访问，并在网络不佳时提供基础页面；缓存仅保存在本机，可在浏览器设置中清除；</li>
            <li>您可以在浏览器设置中随时清除 Cookie 或本地存储，清除后需要重新登录，不影响基础浏览。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-exchange"></i></span>第三方服务</h3>
          <ul className="privacy-list">
            <li><b>邮件服务商</b>：用于发送注册验证码、密码重置、邮箱换绑、登录提醒等通知邮件；</li>
            <li><b>对象存储</b>：您上传的图片、附件等媒体资源保存在对象存储服务中，并通过 HTTPS 访问；</li>
            <li><b>CDN</b>：部分静态资源通过内容分发网络加速加载。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-user-circle"></i></span>您的权利</h3>
          <ul className="privacy-list">
            <li><b>访问与更正</b>：您可以在个人中心查看并修改自己的资料；</li>
            <li><b>删除内容</b>：您可以删除自己发布的帖子、评论等内容；</li>
            <li><b>注销账号</b>：如需注销账号，可通过反馈中心或邮箱联系我们处理。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-child"></i></span>未成年人保护</h3>
          <p>若您未满 14 周岁，建议在监护人的指导下使用本站；填写个人信息前，请先征得监护人同意。</p>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-refresh"></i></span>政策的更新</h3>
          <p>我们会持续完善本政策，并在页面顶部标注最近更新日期。如有重大变更，会通过站内公示等方式告知您；更新后继续使用本站，即视为接受更新后的政策。</p>
        </div>

        <div className="privacy-section privacy-contact">
          <h3><span className="section-icon"><i className="fa fa-envelope"></i></span>联系我们</h3>
          <p>如对本隐私政策有任何疑问、建议或投诉，欢迎通过以下方式联系我们：</p>
          <div className="privacy-contact-actions">
            <a className="privacy-contact-btn" href="mailto:3890320020@qq.com"><i className="fa fa-envelope-o"></i> 3890320020@qq.com</a>
            <a className="privacy-contact-btn" href="https://github.com/crazying-dev" target="_blank" rel="noopener"><i className="fa fa-github"></i> GitHub: crazying-dev</a>
          </div>
        </div>

        <div className="privacy-footer">
          <p><i className="fa fa-info-circle"></i> 感谢您对妖精论坛的信任。我们会妥善保管您的每一份数据，也会持续把隐私保护做得更好。</p>
          <p>使用本站前，也请阅读并遵守<Link className="privacy-footer-link" href="/terms">《服务条款》</Link>。</p>
        </div>
      </div>
    </>
  );
}
