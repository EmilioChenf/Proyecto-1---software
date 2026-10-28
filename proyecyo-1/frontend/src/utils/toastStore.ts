export type ToastTone = "success" | "error" | "warning" | "info";
export type ToastMessage = { id: number; tone: ToastTone; message: string; title?: string };

let sequence = 0;
let messages: ToastMessage[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

// A separate surface from SweetAlert confirmations: background feedback must never
// dismiss a confirmation or an optional cancellation-reason prompt.
export function pushToast(tone: ToastTone, message: string, title?: string) {
  const duplicate = messages.find((item) => item.tone === tone && item.message === message && item.title === title);
  if (duplicate) return duplicate.id;
  const id = ++sequence;
  messages = [...messages, { id, tone, message, title }].slice(-4);
  emit();
  return id;
}

export function dismissToast(id: number) {
  messages = messages.filter((item) => item.id !== id);
  emit();
}

export function clearToasts() {
  messages = [];
  emit();
}

export const toastStore = {
  getSnapshot: () => messages,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
