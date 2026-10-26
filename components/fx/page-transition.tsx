import { ViewTransition, type ReactNode } from "react";

/**
 * Route transition (React <ViewTransition>, driven by Next's navigation transitions): the old page lifts
 * out, the new one rises in, and the header stays put (it has its own view-transition-name). Keyframes live
 * in globals.css under `.tb-page`; reduced motion and browsers without the API swap instantly.
 * Used in each page.tsx, not the layout: layouts persist across navigations, so enter/exit never fire there.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="tb-page" exit="tb-page" default="none">
      {children}
    </ViewTransition>
  );
}
