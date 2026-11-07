import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "服务条款",
  description: "妖精论坛服务条款：说明本站的服务定位、账号与安全、用户内容授权、社区规范、会馆规则、知识产权与免责声明。",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <>
      <div className="privacy-page">
        <div className="privacy-header">
          <h2><i className="fa fa-file-text-o"></i> 服务条款</h2>
          <p className="privacy-intro">
            欢迎来到妖精论坛。在注册、登录或使用本站服务前，请仔细阅读本条款；一旦使用本站，即表示您已理解并同意以下约定。
          </p>
          <span className="privacy-updated"><i className="fa fa-clock-o"></i> 最后更新：2026年11月7日</span>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-info-circle"></i></span>服务说明</h3>
          <p>妖精论坛是《罗小黑战记》的非官方同人社区，由爱好者自发搭建与维护，与寒木春华动画工作室无任何关联，也未获得官方授权。</p>
          <ul className="privacy-list">
            <li>本站仅供学习、交流与非商业用途，不提供付费服务，也不以盈利为目的；</li>
            <li>您可以浏览帖子与文章、加入会馆、在世界频道聊天，并使用消息中心等站内功能；</li>
            <li>本站可能根据运营情况调整、暂停或终止部分功能，具体见「服务的变更与终止」。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-user-circle"></i></span>账号与安全</h3>
          <ul className="privacy-list">
            <li>注册需使用有效邮箱并通过验证码验证；请妥善保管账号与密码，<b>不得将账号出借、共享或转让给他人</b>；</li>
            <li>登录状态通过 Cookie 保持，有效期最长 14 天；在公共设备上使用后请及时退出登录；</li>
            <li>账号下的一切行为视为账号持有人所为，因保管不善造成的损失由您自行承担；</li>
            <li>如发现账号被盗用或存在异常登录，请立即通过下方邮箱联系我们处理。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-pencil-square-o"></i></span>用户内容与授权</h3>
          <ul className="privacy-list">
            <li>您对发布在本站的帖子、评论、文章、图片等内容保留著作权；</li>
            <li>为了展示、存储与分发站内内容，您授予本站一项非独占、免费、仅限本站服务范围内使用的许可（包括必要的缓存、缩略图与镜像分发）；</li>
            <li>您应确保发布的内容不侵犯他人的著作权、肖像权、名誉权等合法权益，并已获得必要授权；</li>
            <li>您可以删除自己发布的内容；删除后相关页面将不再展示，备份与日志中的残留会在合理期限内清除。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-id-card-o"></i></span>设定记录</h3>
          <p>设定记录中的一切内容——角色、能力、描述与语录——由您自行创作并提交，属于用户生成内容（UGC）。著作权仍归您所有；为了让这张卡能被看见，您授予本站一项非独占、免费、限于站内服务范围的许可，涵盖设定页的呈现、会馆名册里的那一行、引用卡片上的摘录，以及为适配屏幕所做的裁剪与压缩。</p>
          <p>每一个字都由您负责。设定卡一旦公开，任何访问者都能读到，请确认写下的内容合法、得当，不损害他人的权益；因内容引起的纠纷，由发布者自己承担。</p>
          <p>不要冒用他人的作品。搬用别人笔下的角色、设定、立绘或文字，须先取得原作者同意并注明出处；也不要借设定卡冒充现实里的某个人，无论是姓名、肖像、经历，还是足以让人认错的描述。</p>
          <p>违法违规、暴力、色情、赌博、诈骗、宣扬仇恨的内容，以及侵犯著作权、肖像权、名誉权、隐私权的内容，同样不允许出现在卡上的任何一栏——名字、称号、描述与语录，一律算数。</p>
          <p>违反上述约定或社区规范的设定，站务可以要求修改、下架或删除，并视情节限制相关账号的功能。卡被撤下之后，其中的语录、配图与点赞记录一并失效；情节严重或屡次违规的，我们保留进一步处理的权利。</p>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-home"></i></span>设定、会馆与引用</h3>
          <p>角色可以归属于某一个会馆。绑定之后，这个角色会以「设定角色」的身份出现在该会馆的成员列表里，也计入会馆的人数统计；它与账号入馆是两件事——入馆的是人，挂上名册的是角色。</p>
          <p>引用会把设定卡带出它原来待着的地方。别人在帖子、评论或文章里引用您的角色，角色名、称号与头像便可能出现在您从未到过的页面，被更多双眼睛看见，也可能被转到站外。设定卡既已公开，他人引用时无需再向您逐一请示；引用的文字由引用者负责，引用本身不改变角色与设定的归属，也不等于您许可对方另作他用。</p>
          <p>若不认同某处引用的措辞，可以请引用者修改，或通过反馈中心请站务介入；涉及侵权或违规的引用，我们会在核实后处理。</p>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-ban"></i></span>社区规范</h3>
          <p>为维护良好的交流氛围，使用本站时不得：</p>
          <ul className="privacy-list">
            <li>发布违法违规、暴力、色情、赌博、诈骗或宣扬仇恨的内容；</li>
            <li>侵犯他人著作权、商标权、肖像权、隐私权等合法权益，或未经授权搬运、商用他人作品；</li>
            <li>骚扰、辱骂、人身攻击、恶意引战或披露他人隐私信息；</li>
            <li>刷屏、恶意灌水、批量注册、刷赞刷评论等扰乱秩序的行为；</li>
            <li>使用脚本、爬虫或其它自动化工具批量请求接口，绕过限流、人机验证等安全机制；</li>
            <li>冒用管理团队名义，或利用漏洞获取不当利益。</li>
          </ul>
          <p>违反上述规范的，我们有权视情节删除内容、限制功能、封禁账号，并保留追究法律责任的权利。</p>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-home"></i></span>会馆规则</h3>
          <ul className="privacy-list">
            <li>会馆由用户申请创建并管理，须遵守本站社区规范；</li>
            <li>入馆申请由会馆管理员审核，审批结果会通过站内通知告知；</li>
            <li>会馆管理员应公平、善意地管理成员与内容，不得滥用权限；</li>
            <li>对于违规或长期无人管理的会馆，站务有权介入、调整或解散。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-copyright"></i></span>知识产权</h3>
          <ul className="privacy-list">
            <li>本站站点代码与站务原创内容基于 <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a> 许可发布，版权归开发者所有；</li>
            <li>站内用户创作内容的权利归各自作者所有，转载或使用前请取得作者授权并注明出处；</li>
            <li>《罗小黑战记》及相关角色、形象的著作权归寒木春华动画工作室所有，本站仅作非商业同人交流使用；</li>
            <li>本站为非商业站点，禁止将站内任何内容用于商业用途。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-exclamation-triangle"></i></span>免责声明</h3>
          <ul className="privacy-list">
            <li>本站按「现状」提供服务，不对可用性、连续性或内容准确性作出保证；</li>
            <li>用户发布的内容仅代表其个人观点，不代表本站立场；</li>
            <li>因网络故障、服务维护、不可抗力或第三方服务异常导致的服务中断或数据损失，本站不承担责任，但会尽力恢复；</li>
            <li>本站包含的站外链接由第三方运营，访问风险由您自行承担。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-refresh"></i></span>服务的变更与终止</h3>
          <ul className="privacy-list">
            <li>我们可能根据运营需要调整功能、规则或本条款，并通过站内公告等方式告知；</li>
            <li>若您违反本条款或社区规范，我们有权限制或终止您使用本站的权利；</li>
            <li>您可以随时停止使用本站，并通过反馈中心或邮箱申请注销账号；</li>
            <li>服务终止后，我们将按《隐私政策》处理您的个人信息。</li>
          </ul>
        </div>

        <div className="privacy-section">
          <h3><span className="section-icon"><i className="fa fa-child"></i></span>未成年人</h3>
          <p>若您未满 14 周岁，请在监护人指导下阅读并同意本条款后使用本站；监护人应指导未成年人合理使用网络，避免泄露个人隐私。</p>
        </div>

        <div className="privacy-section privacy-contact">
          <h3><span className="section-icon"><i className="fa fa-envelope"></i></span>联系方式</h3>
          <p>如对本条款有任何疑问、建议或投诉，欢迎通过以下方式联系我们：</p>
          <div className="privacy-contact-actions">
            <a className="privacy-contact-btn" href="mailto:3890320020@qq.com"><i className="fa fa-envelope-o"></i> 3890320020@qq.com</a>
            <Link className="privacy-contact-btn" href="/privacy"><i className="fa fa-shield"></i> 隐私政策</Link>
          </div>
        </div>

        <div className="privacy-footer">
          <p><i className="fa fa-heart"></i> 感谢你与我们一起维护这个小小的同人社区。</p>
        </div>
      </div>
    </>
  );
}
