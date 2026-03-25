## Packages
recharts | Dashboard analytics and charts
framer-motion | Smooth animations for UI interactions
react-markdown | Rendering markdown content in notes
date-fns | Date formatting and manipulation
clsx | Utility for constructing className strings conditionally (often used with tailwind-merge)
tailwind-merge | Utility for merging tailwind classes

## Notes
Tailwind Config - extend fontFamily:
fontFamily: {
  sans: ["Inter", "sans-serif"],
  display: ["Space Grotesk", "sans-serif"],
  mono: ["JetBrains Mono", "monospace"],
}

API Integration:
- Chat endpoints are under /api/conversations (GET, POST)
- Message streaming uses Server-Sent Events (SSE) via POST /api/conversations/:id/messages
- Projects, Tasks, Notes use standard REST endpoints defined in routes.ts
