import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/tokens.css";
/* 富文本基础样式（RichContent 内部 .rich-content 的标题/列表/引用/嵌入卡） */
import "./styles/web/rich-content.css";
import "./styles/m.css";
import "./styles/screens/feed-post.css";
import "./styles/screens/compose-search-auth.css";
import "./styles/screens/me-settings.css";
import "./styles/screens/world-messages.css";
import "./styles/screens/guilds-user.css";
import "./styles/screens/character-misc.css";
import "./styles/screens/social.css";
import "./styles/screens/account.css";
import "./styles/screens/editor.css";
import "./styles/screens/overlay.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 20_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
