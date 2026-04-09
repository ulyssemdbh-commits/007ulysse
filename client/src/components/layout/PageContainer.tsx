import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";

interface PageContainerProps {
  children: ReactNode;
  title: string;
  action?: ReactNode;
}

export function PageContainer({ children, title, action }: PageContainerProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <main
        aria-label="Contenu principal"
        className={`flex-1 p-8 overflow-y-auto transition-all duration-300 ${collapsed ? "ml-16" : "ml-64"}`}
      >
        <div className="max-w-7xl mx-auto space-y-8">
          <motion.header 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between"
          >
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">{title}</h1>
              <div className="h-1 w-20 bg-gradient-to-r from-primary to-transparent mt-2 rounded-full" />
            </div>
            {action && (
              <div className="flex items-center space-x-4">
                {action}
              </div>
            )}
          </motion.header>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
