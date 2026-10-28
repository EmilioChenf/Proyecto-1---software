import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { getErrorMessage } from "@/utils/errorMessages";
import { pushToast, type ToastTone } from "@/utils/toastStore";

/** Keeps persistent inline feedback and announces each action in the global tray. */
export function useFeedbackState(tone: ToastTone, initial: string | (() => string)): readonly [string, Dispatch<SetStateAction<string>>];
export function useFeedbackState<T extends string | null>(tone: ToastTone, initial: T | (() => T)): readonly [T, Dispatch<SetStateAction<T>>];
export function useFeedbackState<T extends string | null = string>(tone: ToastTone, initial: T | (() => T)) {
  const [state, setState] = useState(() => ({ value: typeof initial === "function" ? initial() : initial, revision: 0 }));
  const lastRevision = useRef(-1);
  useEffect(() => {
    if (lastRevision.current === state.revision) return;
    lastRevision.current = state.revision;
    if (!state.value) return;
    const message = tone === "error" ? getErrorMessage(new Error(state.value)) : state.value;
    pushToast(tone, message);
  }, [state, tone]);

  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setState((current) => ({
      value: typeof next === "function" ? next(current.value) : next,
      revision: current.revision + 1,
    }));
  }, []);
  return [state.value, setValue] as const;
}
