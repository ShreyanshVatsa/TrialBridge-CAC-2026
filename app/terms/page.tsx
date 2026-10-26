import type { Metadata } from "next";
import { PolicyPage } from "@/components/pages/content-pages";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "Terms of use (draft)" };

export default function Page() {
  return (
    <PageTransition>
      <PolicyPage kind="terms" />
    </PageTransition>
  );
}
