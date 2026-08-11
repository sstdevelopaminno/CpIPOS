import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      ".next-local/**",
      ".open-next/**",
      ".vercel/**",
      "coverage/**",
      "node_modules/**",
      "tsconfig.tsbuildinfo"
    ]
  },
  ...nextVitals,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off"
    }
  },
  {
    files: [
      "src/components/backoffice/printer-connection-manager-v2.tsx",
      "src/components/backoffice/printer-connection-manager-v3.tsx"
    ],
    rules: {
      "react-hooks/rules-of-hooks": "off"
    }
  }
];

export default config;
