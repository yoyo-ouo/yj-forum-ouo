import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "font-awesome/css/font-awesome.min.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/web/forum-common.css";
import "./styles/web/filters.css";
import "./styles/web/search-page.css";
import "./styles/web/post-detail.css";
import "./styles/web/post-comments.css";
import "./styles/web/user-profile.css";
import "./styles/web/user-comments.css";
import "./styles/web/rich-content.css";
import "./styles/web/article-cards.css";
import "./styles/web/announcement.css";
import "./styles/web/quote-cards.css";
import "./styles/web/loading.css";
import "./styles/web/huiguan.css";
import "./styles/web/huiguan-intro.css";
import "./styles/web/huiguan-members.css";
import "./styles/web/huiguan-entry.css";
import "./styles/web/article-detail.css";
import "./styles/web/message-center.css";
import "./styles/web/world-channel.css";
import "./styles/web/character-sheet.css";
import "./styles/web/account.css";
import "./styles/web/auth.css";
import "./styles/web/privacy.css";
import "./styles/web/email-change.css";
import "./styles/web/guide.css";
import "./styles/web/feedback.css";
import "./styles/web/changelog.css";
import "./styles/web/year-converter.css";
import "./styles/web/forum-publish.css";
import "./styles/web/publish-page.css";


import "./styles/web-overrides.css";

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
