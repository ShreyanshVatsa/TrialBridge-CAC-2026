import { LandingPage } from "@/components/pages/landing";
import { PageTransition } from "@/components/fx/page-transition";

export default function Home() {
  return (
    <PageTransition>
      <LandingPage />
    </PageTransition>
  );
}
