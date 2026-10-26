import type { Metadata } from "next";
import { AboutPage } from "@/components/pages/content-pages";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "About" };

export default function Page() {
  return (
    <PageTransition>
      <AboutPage />
    </PageTransition>
  );
}
