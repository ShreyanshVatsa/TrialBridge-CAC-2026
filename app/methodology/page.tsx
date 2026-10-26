import type { Metadata } from "next";
import { MethodologyPage } from "@/components/pages/content-pages";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "How it works" };

export default function Page() {
  return (
    <PageTransition>
      <MethodologyPage />
    </PageTransition>
  );
}
