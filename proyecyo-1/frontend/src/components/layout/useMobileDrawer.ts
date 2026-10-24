import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

/** Mantiene el foco y el desplazamiento dentro del menú móvil abierto. */
export function useMobileDrawer(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia?.("(min-width: 1024px)");
    if (media?.matches) {
      setOpen(false);
      return;
    }
    const content = contentRef.current;
    const previousInert = content?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (content) content.inert = true;
    document.body.style.overflow = "hidden";
    const controls = () => [
      menuButtonRef.current,
      ...Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)") ?? []),
    ].filter((element): element is HTMLElement => Boolean(element && element.getClientRects().length));

    const firstLink = drawerRef.current?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?? drawerRef.current?.querySelector<HTMLElement>("a[href]");
    firstLink?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key !== "Tab") return;
      const elements = controls();
      if (!elements.length) return;
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (index === -1 || (!event.shiftKey && index === elements.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        (event.shiftKey ? elements[elements.length - 1] : elements[0]).focus();
      }
    };
    const handleDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    media?.addEventListener("change", handleDesktop);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      media?.removeEventListener("change", handleDesktop);
      document.body.style.overflow = previousOverflow;
      if (content) content.inert = previousInert;
    };
  }, [open, setOpen]);

  const closeDrawer = () => {
    setOpen(false);
    if (open) menuButtonRef.current?.focus();
  };

  return { menuButtonRef, drawerRef, contentRef, closeDrawer };
}
