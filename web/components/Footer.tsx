"use client";

import Link from "next/link";

/** 页脚（与 legacy base.html footer 结构一致） */
export default function Footer() {
  return (
    <footer id="footer">
      <Link href="/privacy" id="FooterPrivacy">隐私</Link>
      <br />
      <br />
      联系方式<br />
      邮箱：3890320020@qq.com<br />
      <a href="https://github.com/crazying-dev">Github（大号）：crazying-dev</a><br />
      小红书：<a href="https://xhslink.com/m/7yCXhVvmCaJ">卡里</a><br />
      站长的个人站点：<a href="https://crazying-dev.top" target="_blank" rel="noopener">crazying-dev.top</a><br />
      公众号：
      <span className="qr-hover-wrap">
        <span id="Footer公众号">悬停扫码</span>
        <img className="qr-img" src="/assets/img/OfficialAccount.jpg" alt="公众号二维码" />
      </span>
      <br />
      <br />
      <span className="footer-disclaimer">
        <i className="fa fa-info-circle"></i> 本二创无官方授权，仅粉丝公益创作
      </span>
      <br />
      <br />
    </footer>
  );
}
