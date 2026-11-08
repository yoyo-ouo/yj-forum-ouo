type Handler = (data: any) => void;

const handlers = new Map<string, Set<Handler>>();

export const bus = {
  on(event: string, handler: Handler) {
    const set = handlers.get(event) || new Set<Handler>();
    set.add(handler);
    handlers.set(event, set);
    return () => set.delete(handler);
  },
  emit(event: string, data: any) {
    handlers.get(event)?.forEach((handler) => handler(data));
  },
};
