import { db } from "../../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface PersonaInfo {
  name: string;
  ownerName: string;
  userName?: string;
  isExternal: boolean;
}

export async function getPersonaInfo(userId: number): Promise<PersonaInfo> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      return {
        name: userId === 1 ? "Ulysse" : "Iris",
        ownerName: "Maurice Djedou",
        userName: undefined,
        isExternal: false,
      };
    }

    const isOwner = user.isOwner || user.role === "admin";
    const isExternal = user.role === "external";

    let personaName: string;
    if (isOwner) {
      personaName = "Ulysse";
    } else if (isExternal) {
      personaName = "Max";
    } else {
      personaName = "Iris";
    }

    return {
      name: personaName,
      ownerName: "Maurice Djedou",
      userName: user.displayName || undefined,
      isExternal,
    };
  } catch (error) {
    console.error("[HomeworkExecution] Failed to get persona info:", error);
    return {
      name: userId === 1 ? "Ulysse" : "Iris",
      ownerName: "Maurice Djedou",
      userName: undefined,
      isExternal: false,
    };
  }
}
