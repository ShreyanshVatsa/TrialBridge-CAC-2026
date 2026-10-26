"use client";

import Link from "next/link";
import { ViewTransition } from "react";
import { useMessages } from "@/components/i18n";
import { Magnetic } from "@/components/landing/magnetic";
import { LensGlyph } from "@/components/site/lens-glyph";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  const m = useMessages();
  return (
    <ViewTransition enter="tb-page" exit="tb-page" default="none">
      <main id="main" className="relative flex flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:py-24">
        <div aria-hidden className="tb-ambient pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[34rem] [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
        <LensGlyph text="404" />
        <h1 className="tb-display mt-8 text-[clamp(2.25rem,5vw,3.75rem)]">{m.errors.notFoundTitle}</h1>
        <p className="mx-auto mt-4 max-w-[46ch] text-lg text-muted-foreground">{m.errors.notFoundBody}</p>
        <Magnetic className="mt-8">
          <Link href="/" className={cn(buttonVariants({ size: "lg" }), "min-h-14 px-8 text-lg")}>
            {m.common.home}
          </Link>
        </Magnetic>
      </main>
    </ViewTransition>
  );
}
