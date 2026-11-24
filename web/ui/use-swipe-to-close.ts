import type { RefObject } from "react";
import { useEffectEvent, useLayoutEffect } from "react";

const DIRECTION_SLOP = 8;
const CLOSE_DISTANCE = 72;

type Direction = "pending" | "horizontal" | "vertical";
type SwipeStart = {
  identifier: number;
  x: number;
  y: number;
  direction: Direction;
  scroller: Element | null;
  scrollLeft: number;
};

const directionFor = (dx: number, dy: number): Direction =>
  Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";

const isElement = (target: EventTarget | null): target is Element =>
  target !== null &&
  "nodeType" in target &&
  target.nodeType === Node.ELEMENT_NODE;

const leftSwipeScroller = (target: EventTarget | null): Element | null => {
  if (!isElement(target)) {
    return null;
  }
  for (
    let element: Element | null = target;
    element;
    element = element.parentElement
  ) {
    const overflowX = getComputedStyle(element).overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      element.scrollWidth > element.clientWidth + 1 &&
      element.scrollLeft > 1
    ) {
      return element;
    }
  }
  return null;
};

/** A left swipe closes a right-side drawer without becoming browser history. */
export const useSwipeToClose = (
  opened: boolean,
  onClose: (() => void) | undefined,
  drawerRef: RefObject<HTMLDivElement | null>
): void => {
  const close = useEffectEvent(() => onClose?.());

  useLayoutEffect(() => {
    const root = drawerRef.current;
    if (!opened || !root) {
      return;
    }
    let detach = (): void => undefined;

    const attach = (): boolean => {
      const drawer = root.matches('[role="dialog"]')
        ? root
        : root.querySelector<HTMLElement>('[role="dialog"]');
      if (!drawer) {
        return false;
      }
      let start: SwipeStart | null = null;

      const onTouchStart = (event: TouchEvent): void => {
        const touch = event.touches[0];
        if (event.touches.length !== 1 || !touch) {
          start = null;
          return;
        }
        const scroller = leftSwipeScroller(touch.target);
        start = {
          identifier: touch.identifier,
          x: touch.clientX,
          y: touch.clientY,
          direction: "pending",
          scroller,
          scrollLeft: scroller?.scrollLeft ?? 0,
        };
      };
      const onTouchMove = (event: TouchEvent): void => {
        const touch = event.touches[0];
        if (
          !start ||
          event.touches.length !== 1 ||
          !touch ||
          touch.identifier !== start.identifier
        ) {
          start = null;
          return;
        }
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (start.direction === "pending") {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_SLOP) {
            return;
          }
          start.direction = directionFor(dx, dy);
        }
        if (start.direction !== "horizontal") {
          return;
        }
        if (start.scroller) {
          // ScrollArea's horizontal touch handling is blocked by the modal lock.
          event.preventDefault();
          const max = start.scroller.scrollWidth - start.scroller.clientWidth;
          start.scroller.scrollLeft = Math.max(
            0,
            Math.min(max, start.scrollLeft + dx)
          );
          return;
        }
        if (dx < 0) {
          event.preventDefault();
        }
      };
      const onTouchEnd = (event: TouchEvent): void => {
        const touch = event.changedTouches[0];
        if (
          !start ||
          event.touches.length !== 0 ||
          !touch ||
          touch.identifier !== start.identifier
        ) {
          start = null;
          return;
        }
        if (!start.scroller) {
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          const direction =
            start.direction === "pending" &&
            Math.max(Math.abs(dx), Math.abs(dy)) >= DIRECTION_SLOP
              ? directionFor(dx, dy)
              : start.direction;
          if (direction === "horizontal" && dx <= -CLOSE_DISTANCE) {
            close();
          }
        }
        start = null;
      };
      const onTouchCancel = (): void => {
        start = null;
      };

      drawer.addEventListener("touchstart", onTouchStart, { passive: true });
      drawer.addEventListener("touchmove", onTouchMove, { passive: false });
      drawer.addEventListener("touchend", onTouchEnd, { passive: true });
      drawer.addEventListener("touchcancel", onTouchCancel, { passive: true });
      detach = () => {
        drawer.removeEventListener("touchstart", onTouchStart);
        drawer.removeEventListener("touchmove", onTouchMove);
        drawer.removeEventListener("touchend", onTouchEnd);
        drawer.removeEventListener("touchcancel", onTouchCancel);
      };
      return true;
    };

    if (attach()) {
      return detach;
    }
    const observer = new MutationObserver(() => {
      if (attach()) {
        observer.disconnect();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach();
    };
  }, [drawerRef, opened]);
};
