import type { Metadata } from "next";
import { FindFlow } from "@/components/find/find-flow";
import { en } from "@/components/i18n/en";
import { PageTransition } from "@/components/fx/page-transition";

export const metadata: Metadata = { title: en.chat.title };

export default function FindPage() {
  return (
    <PageTransition>
      <FindFlow />
    </PageTransition>
  );
}
