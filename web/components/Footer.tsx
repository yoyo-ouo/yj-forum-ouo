"use client";

import Link from "next/link";

/** 页脚（多列布局：品牌/免责声明 · 联系方式 · 公众号） */
export default function Footer() {
  return (
    <footer id="footer">
      <div className="footer-container">
        <div className="footer-col footer-brand">
          <h4 className="footer-title">
            <img src="/assets/img/favicon.png" alt="" className="footer-logo" />
            妖精论坛
          </h4>
          <p className="footer-desc">罗小黑战记同人社区</p>
          <p className="footer-disclaimer">
            <i className="fa fa-info-circle"></i> 本二创无官方授权，仅粉丝公益创作
          </p>
          <Link href="/privacy" id="FooterPrivacy"><i className="fa fa-shield"></i> 隐私政策</Link>
        </div>
        <div className="footer-col">
          <h4 className="footer-title"><i className="fa fa-users"></i> 联系方式</h4>
          <ul className="footer-links">
            <li><i className="fa fa-envelope-o"></i> 邮箱：<a href="mailto:339202808@qq.com">339202808@qq.com</a></li>
            <li><i className="fa fa-github"></i> Github：<a href="https://github.com/yoyo-ouo" target="_blank" rel="noopener">yoyo-ouo</a></li>
            <li><i className="fa fa-book"></i> 小红书：<a href="https://www.xiaohongshu.com/user/profile/6107cd1c000000000100193d" target="_blank" rel="noopener">幽悠ouo_</a></li>
            <li><i className="fa fa-link"></i> 个人站点：<a href="https://youhuge.site" target="_blank" rel="noopener">youhuge.site</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4 className="footer-title"><i className="fa fa-weixin"></i> 公众号</h4>
          <span className="qr-hover-wrap">
            <span id="Footer公众号">悬停扫码</span>
            <img className="qr-img" src="/assets/img/OfficialAccount.jpg" alt="公众号二维码" />
          </span>
        </div>
      </div>
    </footer>
  );
}
