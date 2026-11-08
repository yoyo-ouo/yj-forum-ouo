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
