import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "妖精论坛",
  description: "妖精论坛 - 罗小黑战记社区",
  icons: { icon: "/assets/img/favicon.png" },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#6A8C89",
  width: "device-width",
  initialScale: 1,
};

// 防闪屏脚本：优先 localStorage，否则按时间
const themeScript = `
(function() {
  var theme = localStorage.getItem('forum-theme');
  if (theme === 'day') {
  } else if (theme === 'night') {
    document.documentElement.classList.add('night-mode');
  } else {
    var h = new Date().getHours();
    if (h < 6 || h >= 18) {
      document.documentElement.classList.add('night-mode');
    }
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: 防闪屏脚本（themeScript）会在 hydration 前给 <html> 加 night-mode class，
    // 这是「hydration 前外部修改 DOM」的官方推荐场景，属性差异不报错且保留客户端已应用的主题
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body id="body">
        <StoreProvider>
          {children}
        </StoreProvider>
      </body>
    </html>
  );
}
