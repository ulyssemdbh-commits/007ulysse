export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "frontend" | "fullstack" | "backend" | "static";
  files: Array<{ path: string; content: string }>;
}

const COMMON_GITIGNORE = `node_modules
dist
.env
.env.local
.DS_Store
`;

const COMMON_POSTCSS = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;

const COMMON_TAILWIND = `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
`;

function vitePackageJson(name: string, extraDeps: Record<string, string> = {}, extraDevDeps: Record<string, string> = {}) {
  return JSON.stringify({
    name,
    private: true,
    version: "1.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc && vite build",
      preview: "vite preview",
      test: "vitest run",
      "test:watch": "vitest"
    },
    dependencies: {
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "react-router-dom": "^6.23.0",
      ...extraDeps
    },
    devDependencies: {
      "@types/react": "^18.3.0",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.0",
      autoprefixer: "^10.4.19",
      postcss: "^8.4.38",
      tailwindcss: "^3.4.4",
      typescript: "^5.5.0",
      vite: "^5.3.0",
      vitest: "^1.6.0",
      "@testing-library/react": "^15.0.0",
      "@testing-library/jest-dom": "^6.4.0",
      jsdom: "^24.1.0",
      ...extraDevDeps
    }
  }, null, 2);
}

const VITE_CONFIG = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    useDefineForClassFields: true,
    lib: ["ES2020", "DOM", "DOM.Iterable"],
    module: "ESNext",
    skipLibCheck: true,
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    isolatedModules: true,
    moduleDetection: "force",
    noEmit: true,
    jsx: "react-jsx",
    strict: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    noFallthroughCasesInSwitch: true
  },
  include: ["src"]
}, null, 2);

const INDEX_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;
`;

function indexHtml(title: string) {
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

const MAIN_TSX = `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`;

function readmeFile(name: string, desc: string, extra = "") {
  return `# ${name}

${desc}

## Démarrage

\`\`\`bash
npm install
npm run dev
\`\`\`

## Build

\`\`\`bash
npm run build
\`\`\`
${extra}`;
}

// ─── PORTFOLIO ─────────────────────────────────────────
const PORTFOLIO_TEMPLATE: ProjectTemplate = {
  id: "portfolio",
  name: "Portfolio",
  description: "Portfolio personnel avec React, Tailwind et animations",
  icon: "🎨",
  category: "frontend",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}", { "lucide-react": "^0.395.0", "framer-motion": "^11.2.0" }) },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Projects from './pages/Projects'
import Contact from './pages/Contact'
import Navbar from './components/Navbar'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
` },
    { path: "src/components/Navbar.tsx", content: `import { Link, useLocation } from 'react-router-dom'

const links = [
  { to: '/', label: 'Accueil' },
  { to: '/projects', label: 'Projets' },
  { to: '/contact', label: 'Contact' },
]

export default function Navbar() {
  const { pathname } = useLocation()
  return (
    <nav className="fixed top-0 w-full z-50 bg-gray-950/80 backdrop-blur border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
        <Link to="/" className="text-xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
          {{PROJECT_NAME}}
        </Link>
        <div className="flex gap-6">
          {links.map(l => (
            <Link
              key={l.to}
              to={l.to}
              className={\`text-sm transition \${pathname === l.to ? 'text-violet-400' : 'text-gray-400 hover:text-white'}\`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
` },
    { path: "src/pages/Home.tsx", content: `import { motion } from 'framer-motion'
import { ArrowDown, Github, Linkedin, Mail } from 'lucide-react'

export default function Home() {
  return (
    <main className="pt-20">
      <section className="min-h-[90vh] flex flex-col items-center justify-center text-center px-6">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 mx-auto mb-8 flex items-center justify-center text-3xl font-bold">
            MD
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-4">
            <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              Développeur Créatif
            </span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
            Je crée des expériences web modernes et performantes.
            Passionné par le design et le code propre.
          </p>
          <div className="flex gap-4 justify-center mb-12">
            <a href="#" className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 transition"><Github className="w-5 h-5" /></a>
            <a href="#" className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 transition"><Linkedin className="w-5 h-5" /></a>
            <a href="#" className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 transition"><Mail className="w-5 h-5" /></a>
          </div>
          <ArrowDown className="w-6 h-6 text-gray-500 animate-bounce mx-auto" />
        </motion.div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold mb-12 text-center">Compétences</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['React', 'TypeScript', 'Node.js', 'Tailwind CSS', 'Next.js', 'PostgreSQL', 'Docker', 'Git'].map(skill => (
            <div key={skill} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center hover:border-violet-500/50 transition">
              <p className="font-medium">{skill}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-800 py-8 text-center text-gray-500 text-sm">
        &copy; {new Date().getFullYear()} {{PROJECT_NAME}}. Tous droits réservés.
      </footer>
    </main>
  )
}
` },
    { path: "src/pages/Projects.tsx", content: `import { motion } from 'framer-motion'
import { ExternalLink, Github } from 'lucide-react'

const projects = [
  { title: "E-commerce App", desc: "Boutique en ligne avec paiement Stripe", tags: ["React", "Node.js", "Stripe"], color: "from-blue-500 to-cyan-500" },
  { title: "Dashboard Analytics", desc: "Tableau de bord temps réel avec graphiques", tags: ["React", "D3.js", "WebSocket"], color: "from-violet-500 to-purple-500" },
  { title: "App Mobile", desc: "Application mobile cross-platform", tags: ["React Native", "Firebase"], color: "from-orange-500 to-red-500" },
  { title: "API REST", desc: "Microservice haute performance", tags: ["Node.js", "PostgreSQL", "Redis"], color: "from-green-500 to-emerald-500" },
]

export default function Projects() {
  return (
    <main className="pt-24 pb-20 px-6 max-w-6xl mx-auto">
      <h1 className="text-4xl font-bold mb-2">Mes Projets</h1>
      <p className="text-gray-400 mb-12">Une sélection de mes travaux récents.</p>
      <div className="grid md:grid-cols-2 gap-6">
        {projects.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition group"
          >
            <div className={\`h-48 bg-gradient-to-br \${p.color} flex items-center justify-center\`}>
              <span className="text-5xl font-bold text-white/20">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-2">{p.title}</h3>
              <p className="text-gray-400 text-sm mb-4">{p.desc}</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {p.tags.map(t => (
                  <span key={t} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full">{t}</span>
                ))}
              </div>
              <div className="flex gap-3">
                <a href="#" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                  <ExternalLink className="w-4 h-4" /> Voir
                </a>
                <a href="#" className="text-sm text-gray-400 hover:text-white flex items-center gap-1">
                  <Github className="w-4 h-4" /> Code
                </a>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </main>
  )
}
` },
    { path: "src/pages/Contact.tsx", content: `import { useState } from 'react'
import { Send, MapPin, Mail, Phone } from 'lucide-react'

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', message: '' })
  const [sent, setSent] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSent(true)
    setTimeout(() => setSent(false), 3000)
    setForm({ name: '', email: '', message: '' })
  }

  return (
    <main className="pt-24 pb-20 px-6 max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold mb-2">Contact</h1>
      <p className="text-gray-400 mb-12">N'hésitez pas à me contacter.</p>

      <div className="grid md:grid-cols-2 gap-12">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-violet-500/10"><Mail className="w-5 h-5 text-violet-400" /></div>
            <div><p className="font-medium">Email</p><p className="text-gray-400 text-sm">contact@exemple.com</p></div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-violet-500/10"><Phone className="w-5 h-5 text-violet-400" /></div>
            <div><p className="font-medium">Téléphone</p><p className="text-gray-400 text-sm">+33 6 00 00 00 00</p></div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-violet-500/10"><MapPin className="w-5 h-5 text-violet-400" /></div>
            <div><p className="font-medium">Localisation</p><p className="text-gray-400 text-sm">Paris, France</p></div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text" placeholder="Votre nom" required value={form.name}
            onChange={e => setForm({...form, name: e.target.value})}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-violet-500"
          />
          <input
            type="email" placeholder="Votre email" required value={form.email}
            onChange={e => setForm({...form, email: e.target.value})}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-violet-500"
          />
          <textarea
            placeholder="Votre message" rows={5} required value={form.message}
            onChange={e => setForm({...form, message: e.target.value})}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-violet-500 resize-none"
          />
          <button
            type="submit"
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-medium py-3 rounded-lg transition flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" /> Envoyer
          </button>
          {sent && <p className="text-green-400 text-sm text-center">Message envoyé avec succès !</p>}
        </form>
      </div>
    </main>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}") },
  ]
};

// ─── BLOG ──────────────────────────────────────────────
const BLOG_TEMPLATE: ProjectTemplate = {
  id: "blog",
  name: "Blog",
  description: "Blog personnel avec Next.js et Markdown",
  icon: "📝",
  category: "fullstack",
  files: [
    {
      path: "package.json",
      content: JSON.stringify({
        name: "{{PROJECT_NAME}}",
        version: "1.0.0",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start"
        },
        dependencies: {
          next: "^14.2.0",
          react: "^18.3.1",
          "react-dom": "^18.3.1",
          "gray-matter": "^4.0.3",
          "react-markdown": "^9.0.0",
          "date-fns": "^3.6.0"
        },
        devDependencies: {
          "@types/node": "^20.14.0",
          "@types/react": "^18.3.0",
          "@types/react-dom": "^18.3.0",
          autoprefixer: "^10.4.19",
          postcss: "^8.4.38",
          tailwindcss: "^3.4.4",
          typescript: "^5.5.0"
        }
      }, null, 2)
    },
    { path: "next.config.mjs", content: `/** @type {import('next').NextConfig} */\nconst nextConfig = {}\nexport default nextConfig\n` },
    {
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          lib: ["dom", "dom.iterable", "esnext"], allowJs: true, skipLibCheck: true, strict: true, noEmit: true,
          esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true,
          isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }],
          paths: { "@/*": ["./src/*"] }
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"]
      }, null, 2)
    },
    { path: "tailwind.config.ts", content: `import type { Config } from "tailwindcss"\n\nconst config: Config = {\n  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],\n  theme: {\n    extend: {\n      typography: { DEFAULT: { css: { color: '#d1d5db', a: { color: '#818cf8' }, h1: { color: '#f3f4f6' }, h2: { color: '#f3f4f6' }, h3: { color: '#f3f4f6' }, strong: { color: '#f3f4f6' }, code: { color: '#c084fc' } } } }\n    }\n  },\n  plugins: [],\n}\nexport default config\n` },
    { path: "postcss.config.mjs", content: `const config = { plugins: { tailwindcss: {}, autoprefixer: {} } }\nexport default config\n` },
    { path: "src/app/globals.css", content: INDEX_CSS },
    { path: "src/app/layout.tsx", content: `import type { Metadata } from "next"
import "./globals.css"
import Link from "next/link"

export const metadata: Metadata = {
  title: "{{PROJECT_NAME}}",
  description: "{{PROJECT_DESC}}",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-950 text-gray-100">
        <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-3xl mx-auto px-6 py-4 flex justify-between items-center">
            <Link href="/" className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              {{PROJECT_NAME}}
            </Link>
            <div className="flex gap-6 text-sm text-gray-400">
              <Link href="/" className="hover:text-white transition">Blog</Link>
              <Link href="/about" className="hover:text-white transition">À propos</Link>
            </div>
          </div>
        </nav>
        <main className="max-w-3xl mx-auto px-6 py-12">{children}</main>
        <footer className="border-t border-gray-800 py-8 text-center text-gray-500 text-sm">
          &copy; {new Date().getFullYear()} {{PROJECT_NAME}}
        </footer>
      </body>
    </html>
  )
}
` },
    { path: "src/app/page.tsx", content: `import Link from "next/link"

const posts = [
  { slug: "premier-article", title: "Mon premier article", date: "2025-01-15", excerpt: "Bienvenue sur mon blog ! Dans cet article, je partage mon parcours de développeur et les raisons qui m'ont poussé à créer ce blog.", tags: ["Intro", "Personnel"] },
  { slug: "react-tips", title: "5 astuces React que j'aurais aimé connaître plus tôt", date: "2025-01-20", excerpt: "Des patterns React avancés qui vont changer votre façon de coder : custom hooks, composition, performance...", tags: ["React", "Tips"] },
  { slug: "tailwind-design", title: "Créer un design system avec Tailwind", date: "2025-02-01", excerpt: "Comment structurer vos classes Tailwind pour construire un design system cohérent et maintenable.", tags: ["CSS", "Design"] },
]

export default function Home() {
  return (
    <div>
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-3">Blog</h1>
        <p className="text-gray-400">Réflexions, tutoriels et retours d'expérience.</p>
      </div>
      <div className="space-y-8">
        {posts.map(post => (
          <article key={post.slug} className="group">
            <Link href={\`/blog/\${post.slug}\`} className="block">
              <time className="text-sm text-gray-500">{post.date}</time>
              <h2 className="text-xl font-semibold mt-1 group-hover:text-emerald-400 transition">{post.title}</h2>
              <p className="text-gray-400 mt-2 text-sm leading-relaxed">{post.excerpt}</p>
              <div className="flex gap-2 mt-3">
                {post.tags.map(tag => (
                  <span key={tag} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
            </Link>
          </article>
        ))}
      </div>
    </div>
  )
}
` },
    { path: "src/app/about/page.tsx", content: `export default function About() {
  return (
    <div className="prose prose-invert max-w-none">
      <h1>À propos</h1>
      <p>Développeur passionné, j'écris sur le web, le design et la technologie.</p>
      <h2>Compétences</h2>
      <ul>
        <li>React / Next.js / TypeScript</li>
        <li>Node.js / Express / PostgreSQL</li>
        <li>Tailwind CSS / Design Systems</li>
        <li>DevOps / Docker / CI/CD</li>
      </ul>
      <h2>Contact</h2>
      <p>Vous pouvez me retrouver sur <a href="#">GitHub</a> et <a href="#">LinkedIn</a>.</p>
    </div>
  )
}
` },
    { path: "src/app/blog/[slug]/page.tsx", content: `import { notFound } from "next/navigation"

const articles: Record<string, { title: string; date: string; content: string }> = {
  "premier-article": {
    title: "Mon premier article",
    date: "2025-01-15",
    content: "Bienvenue sur mon blog !\\n\\nDans cet article, je partage mon parcours de développeur. J'ai commencé la programmation il y a plusieurs années et depuis, je n'ai jamais arrêté d'apprendre.\\n\\n## Pourquoi ce blog ?\\n\\nPour partager, apprendre en enseignant, et garder une trace de mon évolution.\\n\\n## Ce que vous y trouverez\\n\\n- Des tutoriels techniques\\n- Des retours d'expérience\\n- Des réflexions sur le métier de développeur"
  },
  "react-tips": {
    title: "5 astuces React",
    date: "2025-01-20",
    content: "Voici 5 patterns React que j'utilise au quotidien :\\n\\n## 1. Custom Hooks\\n\\nExtrayez la logique métier dans des hooks réutilisables.\\n\\n## 2. Compound Components\\n\\nUtilisez le pattern de composition pour des composants flexibles.\\n\\n## 3. Render Props\\n\\nPartagez du comportement entre composants.\\n\\n## 4. React.memo\\n\\nOptimisez les re-renders avec mémoisation.\\n\\n## 5. useReducer\\n\\nPour les états complexes, préférez useReducer à useState."
  },
  "tailwind-design": {
    title: "Design System avec Tailwind",
    date: "2025-02-01",
    content: "Créer un design system cohérent avec Tailwind CSS.\\n\\n## Tokens de design\\n\\nDéfinissez vos couleurs, espacements et typographies dans tailwind.config.\\n\\n## Composants de base\\n\\nCréez des composants Button, Card, Input réutilisables.\\n\\n## Cohérence\\n\\nUtilisez @apply pour les patterns récurrents et gardez vos classes organisées."
  }
}

export default function BlogPost({ params }: { params: { slug: string } }) {
  const post = articles[params.slug]
  if (!post) return notFound()

  return (
    <article>
      <time className="text-sm text-gray-500">{post.date}</time>
      <h1 className="text-3xl font-bold mt-2 mb-6">{post.title}</h1>
      <div className="text-gray-300 leading-relaxed whitespace-pre-line">{post.content}</div>
    </article>
  )
}
` },
    { path: ".gitignore", content: `node_modules\n.next\nout\n.env\n.env.local\n` },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}") },
  ]
};

// ─── GALERIE PHOTO ─────────────────────────────────────
const GALERIE_PHOTO_TEMPLATE: ProjectTemplate = {
  id: "galerie-photo",
  name: "Galerie Photo",
  description: "Galerie photo responsive avec lightbox et filtres",
  icon: "📷",
  category: "frontend",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}", { "lucide-react": "^0.395.0", "framer-motion": "^11.2.0" }) },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `import { useState } from 'react'
import Gallery from './components/Gallery'
import Lightbox from './components/Lightbox'
import Header from './components/Header'

export interface Photo {
  id: number
  src: string
  title: string
  category: string
  width: number
  height: number
}

const photos: Photo[] = [
  { id: 1, src: "https://picsum.photos/seed/a1/800/600", title: "Paysage montagneux", category: "Nature", width: 800, height: 600 },
  { id: 2, src: "https://picsum.photos/seed/a2/600/800", title: "Portrait en lumière naturelle", category: "Portrait", width: 600, height: 800 },
  { id: 3, src: "https://picsum.photos/seed/a3/800/500", title: "Architecture moderne", category: "Architecture", width: 800, height: 500 },
  { id: 4, src: "https://picsum.photos/seed/a4/700/700", title: "Coucher de soleil", category: "Nature", width: 700, height: 700 },
  { id: 5, src: "https://picsum.photos/seed/a5/800/600", title: "Rue de Paris", category: "Urbain", width: 800, height: 600 },
  { id: 6, src: "https://picsum.photos/seed/a6/600/900", title: "Portrait studio", category: "Portrait", width: 600, height: 900 },
  { id: 7, src: "https://picsum.photos/seed/a7/900/600", title: "Forêt brumeuse", category: "Nature", width: 900, height: 600 },
  { id: 8, src: "https://picsum.photos/seed/a8/800/600", title: "Building vitré", category: "Architecture", width: 800, height: 600 },
  { id: 9, src: "https://picsum.photos/seed/a9/700/800", title: "Reflets urbains", category: "Urbain", width: 700, height: 800 },
  { id: 10, src: "https://picsum.photos/seed/a10/800/600", title: "Lac alpin", category: "Nature", width: 800, height: 600 },
  { id: 11, src: "https://picsum.photos/seed/a11/600/800", title: "Mode éditorial", category: "Portrait", width: 600, height: 800 },
  { id: 12, src: "https://picsum.photos/seed/a12/900/500", title: "Pont suspendu", category: "Architecture", width: 900, height: 500 },
]

const categories = ["Tous", ...Array.from(new Set(photos.map(p => p.category)))]

export default function App() {
  const [selected, setSelected] = useState<Photo | null>(null)
  const [filter, setFilter] = useState("Tous")

  const filtered = filter === "Tous" ? photos : photos.filter(p => p.category === filter)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-3 mb-8 flex-wrap justify-center">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={\`px-4 py-2 rounded-full text-sm transition \${filter === cat ? 'bg-amber-500 text-black font-medium' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}\`}
            >
              {cat}
            </button>
          ))}
        </div>
        <Gallery photos={filtered} onSelect={setSelected} />
      </main>
      {selected && (
        <Lightbox
          photo={selected}
          photos={filtered}
          onClose={() => setSelected(null)}
          onNavigate={setSelected}
        />
      )}
    </div>
  )
}
` },
    { path: "src/components/Header.tsx", content: `import { Camera } from 'lucide-react'

export default function Header() {
  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Camera className="w-6 h-6 text-amber-400" />
          <span className="text-xl font-bold">{{PROJECT_NAME}}</span>
        </div>
        <p className="text-sm text-gray-400">{{PROJECT_DESC}}</p>
      </div>
    </header>
  )
}
` },
    { path: "src/components/Gallery.tsx", content: `import { motion } from 'framer-motion'
import type { Photo } from '../App'

interface Props {
  photos: Photo[]
  onSelect: (photo: Photo) => void
}

export default function Gallery({ photos, onSelect }: Props) {
  return (
    <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
      {photos.map((photo, i) => (
        <motion.div
          key={photo.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="break-inside-avoid cursor-pointer group relative overflow-hidden rounded-xl"
          onClick={() => onSelect(photo)}
        >
          <img
            src={photo.src}
            alt={photo.title}
            className="w-full object-cover group-hover:scale-105 transition duration-500"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
            <div>
              <p className="font-medium text-sm">{photo.title}</p>
              <p className="text-xs text-gray-300">{photo.category}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
` },
    { path: "src/components/Lightbox.tsx", content: `import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Photo } from '../App'

interface Props {
  photo: Photo
  photos: Photo[]
  onClose: () => void
  onNavigate: (photo: Photo) => void
}

export default function Lightbox({ photo, photos, onClose, onNavigate }: Props) {
  const idx = photos.findIndex(p => p.id === photo.id)

  const prev = useCallback(() => { if (idx > 0) onNavigate(photos[idx - 1]) }, [idx, photos, onNavigate])
  const next = useCallback(() => { if (idx < photos.length - 1) onNavigate(photos[idx + 1]) }, [idx, photos, onNavigate])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, prev, next])

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white transition z-10">
        <X className="w-8 h-8" />
      </button>
      {idx > 0 && (
        <button onClick={(e) => { e.stopPropagation(); prev() }} className="absolute left-4 text-white/60 hover:text-white transition">
          <ChevronLeft className="w-10 h-10" />
        </button>
      )}
      {idx < photos.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); next() }} className="absolute right-4 text-white/60 hover:text-white transition">
          <ChevronRight className="w-10 h-10" />
        </button>
      )}
      <div onClick={e => e.stopPropagation()} className="max-w-5xl max-h-[85vh] px-16">
        <img src={photo.src} alt={photo.title} className="max-h-[80vh] object-contain mx-auto rounded-lg" />
        <div className="text-center mt-4">
          <p className="font-medium">{photo.title}</p>
          <p className="text-sm text-gray-400">{photo.category} &middot; {idx + 1}/{photos.length}</p>
        </div>
      </div>
    </div>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}") },
  ]
};

// ─── JEU WEB ───────────────────────────────────────────
const JEU_WEB_TEMPLATE: ProjectTemplate = {
  id: "jeu-web",
  name: "Jeu Web",
  description: "Jeu web avec canvas HTML5, scores et animations",
  icon: "🎮",
  category: "frontend",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}") },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `import { useState } from 'react'
import Game from './components/Game'
import Menu from './components/Menu'
import GameOver from './components/GameOver'

export type GameState = 'menu' | 'playing' | 'gameover'

export default function App() {
  const [state, setState] = useState<GameState>('menu')
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('{{PROJECT_NAME}}_highscore')
    return saved ? parseInt(saved) : 0
  })

  const startGame = () => { setScore(0); setState('playing') }

  const endGame = (finalScore: number) => {
    setScore(finalScore)
    if (finalScore > highScore) {
      setHighScore(finalScore)
      localStorage.setItem('{{PROJECT_NAME}}_highscore', String(finalScore))
    }
    setState('gameover')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      {state === 'menu' && <Menu highScore={highScore} onStart={startGame} />}
      {state === 'playing' && <Game onGameOver={endGame} />}
      {state === 'gameover' && <GameOver score={score} highScore={highScore} onRestart={startGame} onMenu={() => setState('menu')} />}
    </div>
  )
}
` },
    { path: "src/components/Menu.tsx", content: `interface Props {
  highScore: number
  onStart: () => void
}

export default function Menu({ highScore, onStart }: Props) {
  return (
    <div className="text-center">
      <div className="text-6xl mb-4">🎮</div>
      <h1 className="text-5xl font-bold mb-2 bg-gradient-to-r from-red-400 to-pink-500 bg-clip-text text-transparent">
        {{PROJECT_NAME}}
      </h1>
      <p className="text-gray-400 mb-8">Attrapez les étoiles, évitez les obstacles !</p>
      {highScore > 0 && (
        <p className="text-yellow-400 mb-4">Meilleur score : {highScore}</p>
      )}
      <button
        onClick={onStart}
        className="bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-400 hover:to-pink-500 text-white font-bold py-4 px-12 rounded-xl text-lg transition transform hover:scale-105"
      >
        Jouer
      </button>
      <p className="text-gray-600 text-sm mt-6">Utilisez ← → ou touchez l'écran</p>
    </div>
  )
}
` },
    { path: "src/components/Game.tsx", content: `import { useEffect, useRef, useState, useCallback } from 'react'

interface Entity {
  x: number; y: number; w: number; h: number; type: 'star' | 'bomb'; speed: number
}

interface Props { onGameOver: (score: number) => void }

export default function Game({ onGameOver }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const scoreRef = useRef(0)
  const playerRef = useRef({ x: 200, w: 50, h: 50 })
  const entitiesRef = useRef<Entity[]>([])
  const frameRef = useRef(0)
  const gameOverRef = useRef(false)
  const keysRef = useRef<Set<string>>(new Set())

  const W = 450, H = 600

  const spawnEntity = useCallback(() => {
    const isStar = Math.random() > 0.3
    entitiesRef.current.push({
      x: Math.random() * (W - 30), y: -30,
      w: isStar ? 25 : 30, h: isStar ? 25 : 30,
      type: isStar ? 'star' : 'bomb',
      speed: 2 + Math.random() * 3 + scoreRef.current * 0.02
    })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let animId: number

    const onKeyDown = (e: KeyboardEvent) => keysRef.current.add(e.key)
    const onKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.key)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    let spawnTimer = 0

    const loop = () => {
      if (gameOverRef.current) return
      frameRef.current++
      spawnTimer++

      const spawnRate = Math.max(15, 45 - scoreRef.current)
      if (spawnTimer >= spawnRate) { spawnEntity(); spawnTimer = 0 }

      const p = playerRef.current
      if (keysRef.current.has('ArrowLeft')) p.x = Math.max(0, p.x - 6)
      if (keysRef.current.has('ArrowRight')) p.x = Math.min(W - p.w, p.x + 6)

      ctx.fillStyle = '#030712'
      ctx.fillRect(0, 0, W, H)

      for (let i = 0; i < 40; i++) {
        const sx = (i * 97 + frameRef.current * 0.3) % W
        const sy = (i * 53 + frameRef.current * 0.5) % H
        ctx.fillStyle = 'rgba(255,255,255,0.15)'
        ctx.fillRect(sx, sy, 1, 1)
      }

      entitiesRef.current = entitiesRef.current.filter(e => {
        e.y += e.speed
        if (e.y > H) return false

        const hit = e.x < p.x + p.w && e.x + e.w > p.x && e.y < H - 20 && e.y + e.h > H - 20 - p.h

        if (hit) {
          if (e.type === 'star') {
            scoreRef.current += 1
            setScore(scoreRef.current)
            return false
          } else {
            gameOverRef.current = true
            onGameOver(scoreRef.current)
            return false
          }
        }

        if (e.type === 'star') {
          ctx.fillStyle = '#facc15'
          ctx.beginPath()
          const cx = e.x + e.w / 2, cy = e.y + e.h / 2
          for (let j = 0; j < 5; j++) {
            const angle = (j * 4 * Math.PI) / 5 - Math.PI / 2
            const r = j === 0 ? 12 : 12
            ctx.lineTo(cx + Math.cos((j * 2 * Math.PI) / 5 - Math.PI / 2) * 12, cy + Math.sin((j * 2 * Math.PI) / 5 - Math.PI / 2) * 12)
            ctx.lineTo(cx + Math.cos((j * 2 * Math.PI) / 5 + Math.PI / 5 - Math.PI / 2) * 5, cy + Math.sin((j * 2 * Math.PI) / 5 + Math.PI / 5 - Math.PI / 2) * 5)
          }
          ctx.closePath()
          ctx.fill()
        } else {
          ctx.fillStyle = '#ef4444'
          ctx.beginPath()
          ctx.arc(e.x + e.w / 2, e.y + e.h / 2, 15, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#030712'
          ctx.font = '16px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('💣', e.x + e.w / 2, e.y + e.h / 2 + 5)
        }
        return true
      })

      const gradient = ctx.createLinearGradient(p.x, H - 20 - p.h, p.x + p.w, H - 20)
      gradient.addColorStop(0, '#3b82f6')
      gradient.addColorStop(1, '#8b5cf6')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.moveTo(p.x + p.w / 2, H - 20 - p.h)
      ctx.lineTo(p.x + p.w, H - 20)
      ctx.lineTo(p.x, H - 20)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#fff'
      ctx.font = 'bold 18px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(\`Score: \${scoreRef.current}\`, 15, 30)

      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [onGameOver, spawnEntity])

  const handleTouch = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = touch.clientX - rect.left
    playerRef.current.x = Math.max(0, Math.min(W - playerRef.current.w, x - playerRef.current.w / 2))
  }

  return (
    <div className="text-center">
      <div className="mb-4 text-lg font-bold">Score : {score}</div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="border-2 border-gray-700 rounded-xl bg-gray-950"
        onTouchMove={handleTouch}
        onTouchStart={handleTouch}
      />
    </div>
  )
}
` },
    { path: "src/components/GameOver.tsx", content: `interface Props {
  score: number
  highScore: number
  onRestart: () => void
  onMenu: () => void
}

export default function GameOver({ score, highScore, onRestart, onMenu }: Props) {
  const isNewRecord = score >= highScore && score > 0

  return (
    <div className="text-center">
      <div className="text-5xl mb-4">{isNewRecord ? '🏆' : '💥'}</div>
      <h2 className="text-3xl font-bold mb-2">Game Over</h2>
      {isNewRecord && <p className="text-yellow-400 text-lg mb-2 animate-pulse">Nouveau record !</p>}
      <p className="text-4xl font-bold text-white mb-2">{score}</p>
      <p className="text-gray-400 mb-8">Meilleur : {highScore}</p>
      <div className="flex gap-4 justify-center">
        <button onClick={onRestart} className="bg-gradient-to-r from-red-500 to-pink-600 text-white font-bold py-3 px-8 rounded-xl transition hover:scale-105">
          Rejouer
        </button>
        <button onClick={onMenu} className="bg-gray-800 text-gray-300 font-bold py-3 px-8 rounded-xl transition hover:bg-gray-700">
          Menu
        </button>
      </div>
    </div>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}", "\n## Contrôles\n\n- Flèches gauche/droite pour déplacer le vaisseau\n- Attrapez les étoiles ⭐, évitez les bombes 💣\n- Le jeu accélère au fil du temps\n") },
  ]
};

// ─── PLAYLIST ──────────────────────────────────────────
const PLAYLIST_TEMPLATE: ProjectTemplate = {
  id: "playlist",
  name: "Playlist",
  description: "Lecteur de musique avec playlists et visualisation audio",
  icon: "🎵",
  category: "frontend",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}", { "lucide-react": "^0.395.0" }) },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `import { useState } from 'react'
import Sidebar from './components/Sidebar'
import Player from './components/Player'
import TrackList from './components/TrackList'

export interface Track {
  id: number
  title: string
  artist: string
  album: string
  duration: string
  cover: string
}

export interface Playlist {
  id: number
  name: string
  tracks: Track[]
}

const allTracks: Track[] = [
  { id: 1, title: "Sunset Vibes", artist: "Luna Wave", album: "Chill Horizons", duration: "3:42", cover: "https://picsum.photos/seed/m1/300/300" },
  { id: 2, title: "Midnight Drive", artist: "Neon Pulse", album: "After Hours", duration: "4:15", cover: "https://picsum.photos/seed/m2/300/300" },
  { id: 3, title: "Ocean Breeze", artist: "Aqua Sound", album: "Deep Blue", duration: "3:58", cover: "https://picsum.photos/seed/m3/300/300" },
  { id: 4, title: "City Lights", artist: "Metro Beat", album: "Urban Flow", duration: "4:32", cover: "https://picsum.photos/seed/m4/300/300" },
  { id: 5, title: "Morning Coffee", artist: "Jazz Café", album: "Smooth Sessions", duration: "3:21", cover: "https://picsum.photos/seed/m5/300/300" },
  { id: 6, title: "Electric Dreams", artist: "Synth Wave", album: "Retro Future", duration: "5:07", cover: "https://picsum.photos/seed/m6/300/300" },
  { id: 7, title: "Rain on Glass", artist: "Ambient Sky", album: "Quiet Moments", duration: "4:45", cover: "https://picsum.photos/seed/m7/300/300" },
  { id: 8, title: "Festival Night", artist: "Bass Drop", album: "Live Energy", duration: "3:55", cover: "https://picsum.photos/seed/m8/300/300" },
]

const playlists: Playlist[] = [
  { id: 1, name: "Chill Vibes", tracks: allTracks.slice(0, 4) },
  { id: 2, name: "Énergie", tracks: allTracks.slice(4) },
  { id: 3, name: "Favoris", tracks: [allTracks[0], allTracks[2], allTracks[5]] },
]

export default function App() {
  const [currentPlaylist, setCurrentPlaylist] = useState(playlists[0])
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const playTrack = (track: Track) => {
    setCurrentTrack(track)
    setIsPlaying(true)
  }

  const nextTrack = () => {
    if (!currentTrack) return
    const tracks = currentPlaylist.tracks
    const idx = tracks.findIndex(t => t.id === currentTrack.id)
    if (idx < tracks.length - 1) playTrack(tracks[idx + 1])
  }

  const prevTrack = () => {
    if (!currentTrack) return
    const tracks = currentPlaylist.tracks
    const idx = tracks.findIndex(t => t.id === currentTrack.id)
    if (idx > 0) playTrack(tracks[idx - 1])
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar playlists={playlists} current={currentPlaylist} onSelect={setCurrentPlaylist} />
        <TrackList
          playlist={currentPlaylist}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          onPlay={playTrack}
        />
      </div>
      <Player
        track={currentTrack}
        isPlaying={isPlaying}
        onToggle={() => setIsPlaying(!isPlaying)}
        onNext={nextTrack}
        onPrev={prevTrack}
      />
    </div>
  )
}
` },
    { path: "src/components/Sidebar.tsx", content: `import { Music, ListMusic, Heart, Home } from 'lucide-react'
import type { Playlist } from '../App'

interface Props {
  playlists: Playlist[]
  current: Playlist
  onSelect: (p: Playlist) => void
}

const icons = [ListMusic, ListMusic, Heart]

export default function Sidebar({ playlists, current, onSelect }: Props) {
  return (
    <aside className="w-60 bg-gray-900 border-r border-gray-800 p-4 flex-shrink-0">
      <div className="flex items-center gap-2 mb-8 px-2">
        <Music className="w-6 h-6 text-green-400" />
        <span className="font-bold text-lg">{{PROJECT_NAME}}</span>
      </div>
      <div className="mb-6">
        <p className="text-xs uppercase text-gray-500 mb-3 px-2">Navigation</p>
        <button className="flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm text-gray-300 hover:bg-gray-800 transition">
          <Home className="w-4 h-4" /> Accueil
        </button>
      </div>
      <div>
        <p className="text-xs uppercase text-gray-500 mb-3 px-2">Playlists</p>
        {playlists.map((p, i) => {
          const Icon = icons[i] || ListMusic
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className={\`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm transition \${current.id === p.id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}\`}
            >
              <Icon className="w-4 h-4" />
              <span>{p.name}</span>
              <span className="ml-auto text-xs text-gray-600">{p.tracks.length}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
` },
    { path: "src/components/TrackList.tsx", content: `import { Play, Pause, Clock } from 'lucide-react'
import type { Playlist, Track } from '../App'

interface Props {
  playlist: Playlist
  currentTrack: Track | null
  isPlaying: boolean
  onPlay: (track: Track) => void
}

export default function TrackList({ playlist, currentTrack, isPlaying, onPlay }: Props) {
  return (
    <main className="flex-1 p-8 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">{playlist.name}</h1>
        <p className="text-gray-400 text-sm">{playlist.tracks.length} titres</p>
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-[40px_1fr_1fr_80px] gap-4 px-4 py-2 text-xs text-gray-500 uppercase border-b border-gray-800">
          <span>#</span><span>Titre</span><span>Album</span><span className="text-right"><Clock className="w-3 h-3 inline" /></span>
        </div>
        {playlist.tracks.map((track, i) => {
          const active = currentTrack?.id === track.id
          return (
            <div
              key={track.id}
              onClick={() => onPlay(track)}
              className={\`grid grid-cols-[40px_1fr_1fr_80px] gap-4 px-4 py-3 rounded-lg cursor-pointer group transition \${active ? 'bg-gray-800/80' : 'hover:bg-gray-800/40'}\`}
            >
              <span className="flex items-center justify-center">
                {active && isPlaying ? (
                  <Pause className="w-4 h-4 text-green-400" />
                ) : (
                  <span className="group-hover:hidden text-gray-500 text-sm">{i + 1}</span>
                )}
                {!(active && isPlaying) && <Play className="w-4 h-4 hidden group-hover:block text-white" />}
              </span>
              <div className="flex items-center gap-3">
                <img src={track.cover} alt={track.album} className="w-10 h-10 rounded object-cover" />
                <div>
                  <p className={\`text-sm font-medium \${active ? 'text-green-400' : ''}\`}>{track.title}</p>
                  <p className="text-xs text-gray-400">{track.artist}</p>
                </div>
              </div>
              <span className="flex items-center text-sm text-gray-400">{track.album}</span>
              <span className="flex items-center justify-end text-sm text-gray-500">{track.duration}</span>
            </div>
          )
        })}
      </div>
    </main>
  )
}
` },
    { path: "src/components/Player.tsx", content: `import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import type { Track } from '../App'

interface Props {
  track: Track | null
  isPlaying: boolean
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
}

export default function Player({ track, isPlaying, onToggle, onNext, onPrev }: Props) {
  if (!track) {
    return (
      <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-center text-gray-500 text-sm">
        Sélectionnez un titre pour commencer
      </div>
    )
  }

  return (
    <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center px-6 gap-6">
      <div className="flex items-center gap-3 w-64">
        <img src={track.cover} alt={track.album} className="w-12 h-12 rounded object-cover" />
        <div>
          <p className="text-sm font-medium">{track.title}</p>
          <p className="text-xs text-gray-400">{track.artist}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center gap-1">
        <div className="flex items-center gap-6">
          <button onClick={onPrev} className="text-gray-400 hover:text-white transition"><SkipBack className="w-5 h-5" /></button>
          <button onClick={onToggle} className="bg-white text-black rounded-full p-2 hover:scale-105 transition">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
          <button onClick={onNext} className="text-gray-400 hover:text-white transition"><SkipForward className="w-5 h-5" /></button>
        </div>
        <div className="flex items-center gap-2 w-full max-w-md">
          <span className="text-xs text-gray-500">0:00</span>
          <div className="flex-1 h-1 bg-gray-700 rounded-full">
            <div className="h-full w-1/3 bg-green-500 rounded-full" />
          </div>
          <span className="text-xs text-gray-500">{track.duration}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-32">
        <Volume2 className="w-4 h-4 text-gray-400" />
        <div className="flex-1 h-1 bg-gray-700 rounded-full">
          <div className="h-full w-2/3 bg-gray-400 rounded-full" />
        </div>
      </div>
    </div>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}") },
  ]
};

// ─── BOUTIQUE ──────────────────────────────────────────
const BOUTIQUE_TEMPLATE: ProjectTemplate = {
  id: "boutique",
  name: "Boutique",
  description: "E-commerce avec panier, filtres et page produit",
  icon: "🛍️",
  category: "frontend",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}", { "lucide-react": "^0.395.0" }) },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `import { useState } from 'react'
import Header from './components/Header'
import ProductGrid from './components/ProductGrid'
import Cart from './components/Cart'
import ProductModal from './components/ProductModal'

export interface Product {
  id: number; name: string; price: number; image: string; category: string; description: string; rating: number
}

export interface CartItem { product: Product; quantity: number }

const products: Product[] = [
  { id: 1, name: "Casque Audio Pro", price: 129.99, image: "https://picsum.photos/seed/p1/400/400", category: "Audio", description: "Casque sans fil avec réduction de bruit active et 30h d'autonomie.", rating: 4.8 },
  { id: 2, name: "Montre Connectée", price: 249.99, image: "https://picsum.photos/seed/p2/400/400", category: "Wearable", description: "Suivi santé, GPS intégré et écran AMOLED.", rating: 4.6 },
  { id: 3, name: "Enceinte Bluetooth", price: 79.99, image: "https://picsum.photos/seed/p3/400/400", category: "Audio", description: "Son 360° puissant, étanche IPX7, 20h d'autonomie.", rating: 4.5 },
  { id: 4, name: "Clavier Mécanique", price: 159.99, image: "https://picsum.photos/seed/p4/400/400", category: "Accessoires", description: "Switches Cherry MX, RGB, construction aluminium.", rating: 4.9 },
  { id: 5, name: "Webcam 4K", price: 99.99, image: "https://picsum.photos/seed/p5/400/400", category: "Accessoires", description: "Capteur 4K, autofocus, micro intégré.", rating: 4.3 },
  { id: 6, name: "Souris Ergonomique", price: 69.99, image: "https://picsum.photos/seed/p6/400/400", category: "Accessoires", description: "Design vertical, sans fil, capteur 4000 DPI.", rating: 4.7 },
  { id: 7, name: "Écouteurs Sport", price: 89.99, image: "https://picsum.photos/seed/p7/400/400", category: "Audio", description: "Résistants à la sueur, maintien parfait, son immersif.", rating: 4.4 },
  { id: 8, name: "Bracelet Fitness", price: 49.99, image: "https://picsum.photos/seed/p8/400/400", category: "Wearable", description: "Suivi activité 24/7, notifications, 14 jours d'autonomie.", rating: 4.2 },
]

export default function App() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [filter, setFilter] = useState("Tous")

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { product, quantity: 1 }]
    })
  }

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(i => i.product.id !== productId))
  }

  const updateQuantity = (productId: number, qty: number) => {
    if (qty <= 0) return removeFromCart(productId)
    setCart(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: qty } : i))
  }

  const categories = ["Tous", ...Array.from(new Set(products.map(p => p.category)))]
  const filtered = filter === "Tous" ? products : products.filter(p => p.category === filter)
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header cartCount={cartCount} onCartClick={() => setCartOpen(true)} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex gap-3 mb-8 flex-wrap">
          {categories.map(cat => (
            <button key={cat} onClick={() => setFilter(cat)}
              className={\`px-4 py-2 rounded-full text-sm transition \${filter === cat ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}\`}>
              {cat}
            </button>
          ))}
        </div>
        <ProductGrid products={filtered} onSelect={setSelectedProduct} onAddToCart={addToCart} />
      </main>
      {cartOpen && <Cart items={cart} onClose={() => setCartOpen(false)} onRemove={removeFromCart} onUpdateQty={updateQuantity} />}
      {selectedProduct && <ProductModal product={selectedProduct} onClose={() => setSelectedProduct(null)} onAddToCart={addToCart} />}
    </div>
  )
}
` },
    { path: "src/components/Header.tsx", content: `import { ShoppingCart, Search } from 'lucide-react'

interface Props { cartCount: number; onCartClick: () => void }

export default function Header({ cartCount, onCartClick }: Props) {
  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">{{PROJECT_NAME}}</h1>
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input placeholder="Rechercher..." className="bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-blue-500 w-64" />
          </div>
          <button onClick={onCartClick} className="relative p-2 rounded-lg hover:bg-gray-800 transition">
            <ShoppingCart className="w-5 h-5" />
            {cartCount > 0 && <span className="absolute -top-1 -right-1 bg-blue-500 text-xs rounded-full w-5 h-5 flex items-center justify-center">{cartCount}</span>}
          </button>
        </div>
      </div>
    </header>
  )
}
` },
    { path: "src/components/ProductGrid.tsx", content: `import { ShoppingCart, Star } from 'lucide-react'
import type { Product } from '../App'

interface Props { products: Product[]; onSelect: (p: Product) => void; onAddToCart: (p: Product) => void }

export default function ProductGrid({ products, onSelect, onAddToCart }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {products.map(product => (
        <div key={product.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition group">
          <div className="aspect-square overflow-hidden cursor-pointer" onClick={() => onSelect(product)}>
            <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
          </div>
          <div className="p-4">
            <p className="text-xs text-gray-500 mb-1">{product.category}</p>
            <h3 className="font-medium text-sm mb-1 cursor-pointer hover:text-blue-400 transition" onClick={() => onSelect(product)}>{product.name}</h3>
            <div className="flex items-center gap-1 mb-2">
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
              <span className="text-xs text-gray-400">{product.rating}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold">{product.price.toFixed(2)}€</span>
              <button onClick={() => onAddToCart(product)} className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg transition">
                <ShoppingCart className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
` },
    { path: "src/components/Cart.tsx", content: `import { X, Minus, Plus, Trash2 } from 'lucide-react'
import type { CartItem } from '../App'

interface Props { items: CartItem[]; onClose: () => void; onRemove: (id: number) => void; onUpdateQty: (id: number, qty: number) => void }

export default function Cart({ items, onClose, onRemove, onUpdateQty }: Props) {
  const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-md bg-gray-900 h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-lg font-bold">Panier ({items.length})</h2>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-gray-400 text-center">Votre panier est vide</p>
        ) : (
          <>
            <div className="p-6 space-y-4">
              {items.map(item => (
                <div key={item.product.id} className="flex gap-4">
                  <img src={item.product.image} alt={item.product.name} className="w-16 h-16 rounded-lg object-cover" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.product.name}</p>
                    <p className="text-sm text-blue-400 font-bold">{(item.product.price * item.quantity).toFixed(2)}€</p>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => onUpdateQty(item.product.id, item.quantity - 1)} className="p-1 rounded bg-gray-800 hover:bg-gray-700"><Minus className="w-3 h-3" /></button>
                      <span className="text-sm w-6 text-center">{item.quantity}</span>
                      <button onClick={() => onUpdateQty(item.product.id, item.quantity + 1)} className="p-1 rounded bg-gray-800 hover:bg-gray-700"><Plus className="w-3 h-3" /></button>
                      <button onClick={() => onRemove(item.product.id)} className="p-1 rounded text-red-400 hover:bg-gray-800 ml-auto"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-800 p-6">
              <div className="flex justify-between mb-4"><span className="text-gray-400">Total</span><span className="text-xl font-bold">{total.toFixed(2)}€</span></div>
              <button className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-medium transition">Commander</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
` },
    { path: "src/components/ProductModal.tsx", content: `import { X, ShoppingCart, Star } from 'lucide-react'
import type { Product } from '../App'

interface Props { product: Product; onClose: () => void; onAddToCart: (p: Product) => void }

export default function ProductModal({ product, onClose, onAddToCart }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative bg-gray-900 rounded-2xl max-w-2xl w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 z-10 bg-gray-800 rounded-full p-2"><X className="w-5 h-5" /></button>
        <div className="grid md:grid-cols-2">
          <img src={product.image} alt={product.name} className="w-full aspect-square object-cover" />
          <div className="p-6 flex flex-col justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-1">{product.category}</p>
              <h2 className="text-2xl font-bold mb-2">{product.name}</h2>
              <div className="flex items-center gap-1 mb-4">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                <span className="text-sm text-gray-400">{product.rating} / 5</span>
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">{product.description}</p>
            </div>
            <div className="mt-6">
              <p className="text-3xl font-bold mb-4">{product.price.toFixed(2)}€</p>
              <button onClick={() => { onAddToCart(product); onClose() }} className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition">
                <ShoppingCart className="w-5 h-5" /> Ajouter au panier
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}") },
  ]
};

// ─── ART & DESIGN ──────────────────────────────────────
const ART_DESIGN_TEMPLATE: ProjectTemplate = {
  id: "art-design",
  name: "Art & Design",
  description: "Canvas de dessin interactif avec outils et export",
  icon: "🎨",
  category: "frontend",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}", { "lucide-react": "^0.395.0" }) },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `import Canvas from './components/Canvas'

export default function App() {
  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col">
      <Canvas />
    </div>
  )
}
` },
    { path: "src/components/Canvas.tsx", content: `import { useRef, useState, useEffect, useCallback } from 'react'
import { Pencil, Eraser, Square, Circle, Download, Trash2, Minus, Plus, Palette } from 'lucide-react'

type Tool = 'pencil' | 'eraser' | 'rectangle' | 'circle'

const COLORS = ['#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4']

export default function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState('#ffffff')
  const [lineWidth, setLineWidth] = useState(3)
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const snapshotRef = useRef<ImageData | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    ctx.fillStyle = '#111827'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const handleResize = () => {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      ctx.putImageData(imgData, 0, 0)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const getPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = (e: React.MouseEvent) => {
    const ctx = canvasRef.current!.getContext('2d')!
    const pos = getPos(e)
    setDrawing(true)
    setStartPos(pos)

    if (tool === 'pencil' || tool === 'eraser') {
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
    }
    if (tool === 'rectangle' || tool === 'circle') {
      snapshotRef.current = ctx.getImageData(0, 0, canvasRef.current!.width, canvasRef.current!.height)
    }
  }

  const draw = (e: React.MouseEvent) => {
    if (!drawing) return
    const ctx = canvasRef.current!.getContext('2d')!
    const pos = getPos(e)

    if (tool === 'pencil') {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    } else if (tool === 'eraser') {
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = lineWidth * 4
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    } else if (tool === 'rectangle' && snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0)
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.strokeRect(startPos.x, startPos.y, pos.x - startPos.x, pos.y - startPos.y)
    } else if (tool === 'circle' && snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0)
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      const rx = Math.abs(pos.x - startPos.x) / 2
      const ry = Math.abs(pos.y - startPos.y) / 2
      ctx.beginPath()
      ctx.ellipse(startPos.x + (pos.x - startPos.x) / 2, startPos.y + (pos.y - startPos.y) / 2, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  const stopDraw = () => { setDrawing(false); snapshotRef.current = null }

  const clearCanvas = () => {
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.fillStyle = '#111827'
    ctx.fillRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
  }

  const exportCanvas = () => {
    const link = document.createElement('a')
    link.download = '{{PROJECT_NAME}}.png'
    link.href = canvasRef.current!.toDataURL()
    link.click()
  }

  const tools: { id: Tool; icon: typeof Pencil; label: string }[] = [
    { id: 'pencil', icon: Pencil, label: 'Crayon' },
    { id: 'eraser', icon: Eraser, label: 'Gomme' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
    { id: 'circle', icon: Circle, label: 'Cercle' },
  ]

  return (
    <>
      <header className="flex items-center gap-4 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-1 mr-4">
          <Palette className="w-5 h-5 text-pink-400" />
          <span className="font-bold">{{PROJECT_NAME}}</span>
        </div>

        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {tools.map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={t.label}
              className={\`p-2 rounded-md transition \${tool === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}\`}>
              <t.icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={\`w-6 h-6 rounded-full border-2 transition \${color === c ? 'border-white scale-110' : 'border-transparent'}\`}
              style={{ backgroundColor: c }} />
          ))}
        </div>

        <div className="flex items-center gap-2 ml-2">
          <button onClick={() => setLineWidth(Math.max(1, lineWidth - 1))} className="text-gray-400 hover:text-white"><Minus className="w-4 h-4" /></button>
          <span className="text-xs text-gray-400 w-4 text-center">{lineWidth}</span>
          <button onClick={() => setLineWidth(Math.min(20, lineWidth + 1))} className="text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
        </div>

        <div className="ml-auto flex gap-2">
          <button onClick={clearCanvas} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition">
            <Trash2 className="w-4 h-4" /> Effacer
          </button>
          <button onClick={exportCanvas} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-pink-600 hover:bg-pink-500 rounded-lg transition">
            <Download className="w-4 h-4" /> Exporter
          </button>
        </div>
      </header>

      <canvas
        ref={canvasRef}
        className="flex-1 cursor-crosshair"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
      />
    </>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}", "\n## Outils\n\n- Crayon, Gomme, Rectangle, Cercle\n- 9 couleurs, épaisseur réglable\n- Export PNG\n") },
  ]
};

// ─── REACT + VITE (SPA classique) ──────────────────────
const REACT_VITE_TEMPLATE: ProjectTemplate = {
  id: "react-vite",
  name: "React + Vite",
  description: "Application React moderne avec Vite, TypeScript et Tailwind CSS",
  icon: "⚛️",
  category: "frontend",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}") },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'

function Navbar() {
  const { pathname } = useLocation()
  return (
    <nav className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
        <span className="font-bold text-lg bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">{{PROJECT_NAME}}</span>
        <div className="flex gap-4 text-sm">
          <Link to="/" className={\`\${pathname === '/' ? 'text-cyan-400' : 'text-gray-400 hover:text-white'} transition\`}>Accueil</Link>
          <Link to="/about" className={\`\${pathname === '/about' ? 'text-cyan-400' : 'text-gray-400 hover:text-white'} transition\`}>À propos</Link>
        </div>
      </div>
    </nav>
  )
}

function Home() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center text-center px-6">
      <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">{{PROJECT_NAME}}</h1>
      <p className="text-lg text-gray-400 max-w-lg">{{PROJECT_DESC}}</p>
      <p className="text-gray-600 mt-8 text-sm">Modifiez <code className="text-cyan-400">src/App.tsx</code> pour commencer.</p>
    </div>
  )
}

function About() {
  return (
    <div className="max-w-2xl mx-auto py-20 px-6">
      <h1 className="text-3xl font-bold mb-4">À propos</h1>
      <p className="text-gray-400 leading-relaxed">Cette application a été générée avec le template React + Vite. Elle utilise TypeScript, Tailwind CSS et React Router.</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}") },
  ]
};

// ─── PROJET LIBRE (empty) ─────────────────────────────
const EMPTY_TEMPLATE: ProjectTemplate = {
  id: "empty",
  name: "Projet Libre",
  description: "Repository avec base React + Vite minimale",
  icon: "📄",
  category: "static",
  files: [
    { path: "package.json", content: vitePackageJson("{{PROJECT_NAME}}") },
    { path: "vite.config.ts", content: VITE_CONFIG },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: "tailwind.config.js", content: COMMON_TAILWIND },
    { path: "postcss.config.js", content: COMMON_POSTCSS },
    { path: "index.html", content: indexHtml("{{PROJECT_NAME}}") },
    { path: "src/main.tsx", content: MAIN_TSX },
    { path: "src/index.css", content: INDEX_CSS },
    { path: "src/App.tsx", content: `export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">{{PROJECT_NAME}}</h1>
        <p className="text-gray-400">Projet prêt. Éditez <code className="text-cyan-400">src/App.tsx</code> pour commencer.</p>
      </div>
    </div>
  )
}
` },
    { path: ".gitignore", content: COMMON_GITIGNORE },
    { path: "README.md", content: readmeFile("{{PROJECT_NAME}}", "{{PROJECT_DESC}}") },
  ]
};

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  PORTFOLIO_TEMPLATE,
  BLOG_TEMPLATE,
  GALERIE_PHOTO_TEMPLATE,
  JEU_WEB_TEMPLATE,
  PLAYLIST_TEMPLATE,
  BOUTIQUE_TEMPLATE,
  ART_DESIGN_TEMPLATE,
  REACT_VITE_TEMPLATE,
  EMPTY_TEMPLATE,
];

export function getTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find(t => t.id === id);
}

export function renderTemplateFiles(template: ProjectTemplate, projectName: string, description: string): Array<{ path: string; content: string }> {
  return template.files.map(f => ({
    path: f.path,
    content: f.content
      .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
      .replace(/\{\{PROJECT_DESC\}\}/g, description || "Created by Ulysse DevOps Bridge")
  }));
}
