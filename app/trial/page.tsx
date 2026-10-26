import type { Metadata } from "next";
import { Suspense } from "react";
import { TrialLoading } from "@/components/trial/trial-detail";
import { SessionTrialDetail } from "@/components/trial/session-trial-detail";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: "Trial details" };

/** One static page for every trial: the NCT ID comes from ?id= and data loads on the client. */
export default function TrialPage() {
  return (
    <>
      {/* Start fetching the data manifest with the HTML, before the page script asks for it. */}
      <link rel="preload" href="/data/manifest.json" as="fetch" crossOrigin="anonymous" />
      <PageTransition>
        <Suspense fallback={<TrialLoading />}>
          <SessionTrialDetail />
        </Suspense>
      </PageTransition>
    </>
  );
}
