import type { Metadata } from "next";
import { ForSitesPage } from "@/components/pages/content-pages";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "For research sites" };

export default function Page() {
  return (
    <PageTransition>
      <ForSitesPage />
    </PageTransition>
  );
}
