import type { Metadata } from "next";
import { OfflinePage } from "@/components/pages/offline";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

export default function Page() {
  return (
    <PageTransition>
      <OfflinePage />
    </PageTransition>
  );
}
