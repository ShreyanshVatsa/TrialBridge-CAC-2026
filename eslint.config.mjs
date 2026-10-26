import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// RTL support (QUESTIONNAIRE_SPEC.md section 6.3): use logical utilities (ms-/me-/ps-/pe-/start-/end-/text-start/
// text-end/border-s/e, rounded-s/e) instead of physical left/right ones, so Arabic, Urdu and Persian mirror correctly.
const PHYSICAL = String.raw`(^|[\s:!])(-?)(ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)-`;
const noPhysicalDirection = [
  "error",
  ...["JSXAttribute[name.name='className'] Literal", "JSXAttribute[name.name='className'] TemplateElement", "CallExpression[callee.name=/^(cn|clsx|cva)$/] Literal", "CallExpression[callee.name=/^(cn|clsx|cva)$/] TemplateElement"].map((sel) => ({
    selector: `${sel}[${sel.endsWith("TemplateElement") ? "value.raw" : "value"}=/${PHYSICAL}/]`,
    message: "Use logical Tailwind utilities (ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/rounded-s) so RTL languages mirror correctly.",
  })),
];

const config = [
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["components/ui/**"],
    rules: { "no-restricted-syntax": noPhysicalDirection },
  },
  {
    ignores: ["vendor/**", ".next/**", "out/**", ".wrangler/**", "coverage/**", "public/**", "data/**", "next-env.d.ts", "playwright-report/**", "test-results/**"],
  },
];
export default config;
