type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function handleBack(): boolean {
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    try {
      if (handlers[index]()) return true;
    } catch {
      /* 单个处理器失败不应阻断返回 */
    }
  }
  return false;
}

declare global {
  interface Window {
    __yjBack?: () => boolean;
  }
}
