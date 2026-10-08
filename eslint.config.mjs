import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/**",
  ]),
  {
    rules: {
      // Data-fetching effects (fetch on mount, refetch on dependency change)
      // legitimately flip a loading flag synchronously. Keep as a warning.
      "react-hooks/set-state-in-effect": "warn",
      // The console is served by one catch-all page (app/[[...path]]), which
      // makes this rule read every internal href as a page. The only plain
      // <a> links are to /api/auth/google, an API redirect that has to be a
      // full navigation.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]);

export default eslintConfig;
