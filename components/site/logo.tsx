import { useId } from "react";
import { cn } from "@/lib/utils";

/** TrialBridge mark: a glowing suspension bridge whose gradient fades in from violet to amber. Decorative unless `title` is given. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const uid = useId();
  const id = (n: string) => `${uid}${n}`;
  const ref = (n: string) => `url(#${id(n)})`;
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-8 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <linearGradient id={id("bg")} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#24156e" />
          <stop offset=".55" stopColor="#110a3c" />
          <stop offset="1" stopColor="#07041a" />
        </linearGradient>
        <radialGradient id={id("gl")} cx="34" cy="38" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7d4dff" stopOpacity=".42" />
          <stop offset="1" stopColor="#7d4dff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("sn")} cx="20" cy="0" r="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("br")} x1="4" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7f6bff" stopOpacity="0" />
          <stop offset=".2" stopColor="#8f7bff" />
          <stop offset=".5" stopColor="#c98cff" />
          <stop offset=".78" stopColor="#ff8ac6" />
          <stop offset="1" stopColor="#ffc58a" />
        </linearGradient>
        <linearGradient id={id("rf")} x1="0" y1="41" x2="0" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={id("rm")} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect y="41" width="64" height="23" fill={ref("rf")} />
        </mask>
        <filter id={id("bl")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <g id={id("b")} fill="none" stroke={ref("br")} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 38Q15 33 20 15Q32 44 44 15Q49 33 59 38" strokeWidth="2.6" />
          <path d="M20 13V43M44 13V43" strokeWidth="3.4" />
          <path d="M4 40H60" strokeWidth="3.6" />
          <path d="M12.5 31.4V40M26 25.6V40M32 29.5V40M38 25.6V40M51.5 31.4V40" strokeWidth="1.2" />
        </g>
      </defs>
      <rect width="64" height="64" rx="14" fill={ref("bg")} />
      <rect width="64" height="64" rx="14" fill={ref("gl")} />
      <rect width="64" height="64" rx="14" fill={ref("sn")} />
      <use href={`#${id("b")}`} filter={ref("bl")} opacity=".85" />
      <use href={`#${id("b")}`} />
      <g mask={ref("rm")}>
        <use href={`#${id("b")}`} transform="matrix(1 0 0 -1 0 82)" />
      </g>
      <rect x=".5" y=".5" width="63" height="63" rx="13.5" fill="none" stroke="#fff" strokeOpacity=".14" />
    </svg>
  );
}
