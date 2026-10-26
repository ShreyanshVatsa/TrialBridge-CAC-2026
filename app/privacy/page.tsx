import type { Metadata } from "next";
import { PrivacyPage } from "@/components/pages/privacy";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "Privacy" };

export default function Page() {
  return (
    <PageTransition>
      <PrivacyPage />
    </PageTransition>
  );
}
