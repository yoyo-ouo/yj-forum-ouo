"use client";

// 消息中心页面：类型由 MessageCenter 内部状态管理，不再使用 URL ?type=，
// 因此不需要 Suspense / useSearchParams。

import MessageCenter from "@/components/messages/MessageCenter";

export default function MessagesPage() {
  return <MessageCenter />;
}
