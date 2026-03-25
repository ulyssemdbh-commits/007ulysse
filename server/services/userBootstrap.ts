import { db } from "../db";
import { users, approvedUsers, projects } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const APPROVED_USERS_CONFIG = [
  {
    username: "KellyIris001",
    displayName: "Kelly Djedou",
    password: "$2b$12$Df5d7Qfrk22ir4y0u5v7Q.j1RRE1NFA3.4bhHpL.uGvWoNUNgWwwK",
    role: "approved",
    note: "Kelly Djedou - Maurice's 1st daughter - Iris access",
    oldUsername: "userulysse001"
  },
  {
    username: "LennyIris002",
    displayName: "Lenny Djedou",
    password: "$2b$12$3.Cg5TkL8wDqWfk6YKPkeeN68adBgkuArs0omLOxLjTkzwvPxWV9O",
    role: "approved",
    note: "Lenny Djedou - Maurice's 2nd daughter - Iris access",
    oldUsername: "userulysse002"
  },
  {
    username: "MickyIris003",
    displayName: "Micky Djedou",
    password: "$2b$12$hmGM04LhYFHzXkEWXD7ffOCqBKHWRERrW/g1ENwr.Rx3Zt1WDREy2",
    role: "approved",
    note: "Micky Djedou - Maurice's 3rd daughter - Iris access",
    oldUsername: "userulysse003"
  },
  {
    username: "Sugugestion13011",
    displayName: "Sugugestion Valentine",
    password: "$2b$12$Ay2Y6z2vc5KSYpfYV2x6LOQUeQS5IXb7FimicHVnzoOJsMLK3iyOW",
    role: "suguval_only",
    note: "Sugugestion - Accountant - SUGU Valentine access only",
    oldUsername: "SEE-Sugu13011"
  },
  {
    username: "Sugugestion13008",
    displayName: "Sugugestion Maillane",
    password: "$2b$12$Ay2Y6z2vc5KSYpfYV2x6LOQUeQS5IXb7FimicHVnzoOJsMLK3iyOW",
    role: "sugumaillane_only",
    note: "Sugugestion - Accountant - SUGU Maillane access only",
    oldUsername: "SEE-Sugu13008"
  }
];

export async function ensureApprovedUsers(): Promise<void> {
  try {
    const owner = await db.select().from(users).where(eq(users.isOwner, true)).limit(1);
    
    if (owner.length === 0) {
      console.log("[Bootstrap] Owner not found, skipping approved users setup");
      return;
    }
    
    const ownerId = owner[0].id;
    
    console.log("[Bootstrap] Ensuring approved users exist...");
    
    for (const config of APPROVED_USERS_CONFIG) {
      const userRole = config.role || "approved";
      
      if (config.oldUsername) {
        const existingOldUser = await db.select().from(users).where(eq(users.username, config.oldUsername)).limit(1);
        if (existingOldUser.length > 0) {
          await db.update(users)
            .set({ 
              username: config.username, 
              displayName: config.displayName,
              password: config.password, 
              role: userRole 
            })
            .where(eq(users.username, config.oldUsername));
          console.log(`[Bootstrap] Migrated user: ${config.oldUsername} -> ${config.username}`);
          continue;
        }
      }
      
      const existingUser = await db.select().from(users).where(eq(users.username, config.username)).limit(1);
      
      if (existingUser.length === 0) {
        const [newUser] = await db.insert(users).values({
          username: config.username,
          displayName: config.displayName,
          password: config.password,
          role: userRole,
          isOwner: false
        }).returning();
        
        const accessLevel = userRole === "suguval_only" ? "suguval" : userRole === "sugumaillane_only" ? "sugumaillane" : "full";
        await db.insert(approvedUsers).values({
          userId: newUser.id,
          approvedBy: ownerId,
          accessLevel,
          note: config.note
        }).onConflictDoNothing();
        
        console.log(`[Bootstrap] Created user: ${config.username} (${config.displayName})`);
      } else {
        await db.update(users)
          .set({ 
            password: config.password, 
            displayName: config.displayName,
            role: userRole 
          })
          .where(eq(users.username, config.username));
        
        const approvalExists = await db.select().from(approvedUsers)
          .where(eq(approvedUsers.userId, existingUser[0].id)).limit(1);
        
        if (approvalExists.length === 0) {
          await db.insert(approvedUsers).values({
            userId: existingUser[0].id,
            approvedBy: ownerId,
            accessLevel: "full",
            note: config.note
          }).onConflictDoNothing();
        }
        
        console.log(`[Bootstrap] Updated user: ${config.username} (${config.displayName})`);
      }
    }
    
    console.log("[Bootstrap] Approved users setup complete");
  } catch (error) {
    console.error("[Bootstrap] Error setting up approved users:", error);
  }
}

export function getApprovedUserGreeting(username: string): string | null {
  const greetings: Record<string, string> = {
    "KellyIris001": "Hi Kelly!",
    "LennyIris002": "Hi Lenny!",
    "MickyIris003": "Hi Micky!"
  };
  return greetings[username] || null;
}

const CONTEXTUAL_PROJECTS_CONFIG = [
  {
    name: "SUGU Maillane",
    description: "Gestion du restaurant SUGU Maillane - taches operationnelles",
    color: "#FF6B35",
    context: "sugu"
  },
  {
    name: "Suguval",
    description: "Gestion Suguval - taches administratives et logistiques",
    color: "#4ECDC4",
    context: "suguval"
  },
  {
    name: "Football & Pronos",
    description: "Predictions sportives et suivi des paris",
    color: "#2ECC71",
    context: "foot"
  },
  {
    name: "Personnel",
    description: "Taches personnelles et vie quotidienne",
    color: "#9B59B6",
    context: "perso"
  },
  {
    name: "Developpement",
    description: "Projets de developpement logiciel et technique",
    color: "#3498DB",
    context: "dev"
  },
  {
    name: "Travail",
    description: "Taches professionnelles generales",
    color: "#E74C3C",
    context: "travail"
  },
  {
    name: "Famille",
    description: "Taches familiales et organisation domestique",
    color: "#F39C12",
    context: "famille"
  }
];

export async function ensureContextualProjects(): Promise<void> {
  try {
    const owner = await db.select().from(users).where(eq(users.isOwner, true)).limit(1);
    
    if (owner.length === 0) {
      console.log("[Bootstrap] Owner not found, skipping contextual projects setup");
      return;
    }
    
    const ownerId = owner[0].id;
    console.log("[Bootstrap] Ensuring contextual projects exist...");
    
    for (const config of CONTEXTUAL_PROJECTS_CONFIG) {
      const existingProject = await db.select().from(projects)
        .where(and(eq(projects.userId, ownerId), eq(projects.name, config.name)))
        .limit(1);
      
      if (existingProject.length === 0) {
        await db.insert(projects).values({
          userId: ownerId,
          name: config.name,
          description: config.description,
          color: config.color,
          status: "active"
        });
        console.log(`[Bootstrap] Created project: ${config.name} (context: ${config.context})`);
      }
    }
    
    console.log("[Bootstrap] Contextual projects setup complete");
  } catch (error) {
    console.error("[Bootstrap] Error setting up contextual projects:", error);
  }
}
