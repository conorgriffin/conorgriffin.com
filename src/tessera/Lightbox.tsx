import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent, type MouseEvent } from "react";

/** An image that can be opened full screen. `width`/`height` are the image's pixel size (2× Retina captures). */
export type Enlargeable = { src: string; alt: string; width: number; height: number };

type Open = (image: Enlargeable, trigger: HTMLElement) => void;
const LightboxContext = createContext<Open>(() => {});
export const useLightbox = () => useContext(LightboxContext);

/**
 * One shared full-screen viewer. Opens fitted to the screen; tap or click the image to see it at
 * actual size and pan around, tap again to fit. Closes with ×, Esc, a tap outside the image, or a
 * swipe down. Uses <dialog> for focus trapping, and returns focus to the thumbnail on close.
 */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const zoomPoint = useRef<{ x: number; y: number } | null>(null);
  const swipe = useRef<{ y: number; dy: number } | null>(null);
  const [image, setImage] = useState<Enlargeable | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [drag, setDrag] = useState(0);

  const open = useCallback<Open>((img, el) => {
    trigger.current = el;
    setZoomed(false);
    setDrag(0);
    setImage(img);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d || !image || d.open) return;
    d.showModal();
    document.documentElement.style.overflow = "hidden";
  }, [image]);

  const close = () => dialog.current?.close();

  // Fired by close(), Esc, or the browser; tidy up and hand focus back.
  const onClose = () => {
    document.documentElement.style.overflow = "";
    setImage(null);
    trigger.current?.focus();
  };

  // After zooming in, scroll so the point that was tapped stays under the finger.
  useLayoutEffect(() => {
    const s = scroller.current;
    const p = zoomPoint.current;
    if (!s || !zoomed || !p) return;
    s.scrollLeft = p.x * s.scrollWidth - s.clientWidth / 2;
    s.scrollTop = p.y * s.scrollHeight - s.clientHeight / 2;
    zoomPoint.current = null;
  }, [zoomed]);

  const toggleZoom = (e: MouseEvent<HTMLImageElement>) => {
    e.stopPropagation();
    if (!zoomed) {
      const r = e.currentTarget.getBoundingClientRect();
      zoomPoint.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }
    setZoomed(!zoomed);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (zoomed || e.touches.length !== 1) return;
    swipe.current = { y: e.touches[0].clientY, dy: 0 };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!swipe.current) return;
    swipe.current.dy = Math.max(0, e.touches[0].clientY - swipe.current.y);
    setDrag(swipe.current.dy);
  };
  const onTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (s && s.dy > 90) close();
    else setDrag(0);
  };

  // Retina captures: actual size on screen is half the pixel width.
  const actualWidth = image ? image.width / 2 : 0;

  return (
    <LightboxContext.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        onClose={onClose}
        aria-label={image ? `Screenshot: ${image.alt}` : "Screenshot"}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-white backdrop:bg-[#0b0c12]/90 backdrop:backdrop-blur-sm"
      >
        {image && (
          <>
            <div
              ref={scroller}
              onClick={close}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              className={`h-full w-full overscroll-contain ${zoomed ? "overflow-auto" : "flex items-center justify-center overflow-hidden p-4 pt-16 sm:p-10 sm:pt-16"}`}
              style={drag ? { transform: `translateY(${drag}px)`, opacity: Math.max(0.4, 1 - drag / 400) } : undefined}
            >
              <img
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                onClick={toggleZoom}
                draggable={false}
                className={zoomed
                  ? "mx-auto block max-w-none cursor-zoom-out"
                  : "h-auto max-h-full w-auto max-w-full cursor-zoom-in object-contain drop-shadow-[0_24px_60px_rgba(0,0,0,0.5)]"}
                style={zoomed ? { width: actualWidth, height: "auto" } : undefined}
              />
            </div>
            <p aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-3 text-center text-xs text-white/60">
              {zoomed ? "Tap to fit" : "Tap to zoom · swipe down or Esc to close"}
            </p>
            <button
              type="button"
              autoFocus
              onClick={close}
              aria-label="Close"
              className="fixed right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </>
        )}
      </dialog>
    </LightboxContext.Provider>
  );
}

/** Wraps a thumbnail so tapping it, or pressing Enter/Space on it, opens the full-size image. */
export function EnlargeButton({ image, className = "", children }: { image: Enlargeable; className?: string; children: ReactNode }) {
  const open = useLightbox();
  return (
    <button type="button" onClick={(e) => open(image, e.currentTarget)} aria-label={`View larger: ${image.alt}`}
      className={`group relative block w-full cursor-zoom-in text-left ${className}`}>
      {children}
      <span aria-hidden="true"
        className="pointer-events-none absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-tessera-navy/80 text-tessera-ink opacity-90 shadow-lg backdrop-blur transition group-hover:scale-110 group-hover:opacity-100 group-focus-visible:scale-110 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
      </span>
    </button>
  );
}
