import { storage } from "../server/storage";
import { db } from "../server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function getOwnerId(): Promise<number> {
  const [owner] = await db.select().from(users).where(eq(users.isOwner, true));
  if (!owner) {
    throw new Error("No owner user found, cannot seed");
  }
  return owner.id;
}

async function run() {
  console.log("Seeding...");

  const ownerId = await getOwnerId();
  console.log(`Found owner with id: ${ownerId}`);

  const projects = await storage.getProjects(ownerId);
  if (projects.length === 0) {
    const p1 = await storage.createProject({
      name: "AI Personal Assistant App",
      description: "Building a personal app for project management with AI.",
      status: "active",
      userId: ownerId,
    });

    console.log("Created project:", p1.name);

    await storage.createTask({
      projectId: p1.id,
      title: "Setup Database",
      status: "done",
      priority: "high",
      userId: ownerId,
    });
    await storage.createTask({
      projectId: p1.id,
      title: "Implement Frontend",
      status: "in_progress",
      priority: "high",
      userId: ownerId,
    });

    console.log("Created tasks");

    await storage.createNote({
      projectId: p1.id,
      title: "Tech Stack",
      content: "# Tech Stack\n- React\n- Node.js\n- Postgres\n- OpenAI",
      userId: ownerId,
    });

    console.log("Created notes");
  } else {
    console.log("Projects already exist, skipping seed.");
  }

  console.log("Seeding complete.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
