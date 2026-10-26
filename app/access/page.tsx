import type { Metadata } from "next";
import { AccessPage } from "@/components/access/access-page";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "Access Intelligence" };

export default function Page() {
  return (
    <PageTransition>
      <AccessPage />
    </PageTransition>
  );
}
