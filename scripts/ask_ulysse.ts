import OpenAI from 'openai';
import { db } from '../server/db';
import { knowledgeBase, learningProgress, ulysseHomework, ulysseDiagnostics } from '@shared/schema';
import { eq, desc, count } from 'drizzle-orm';

const openai = new OpenAI();

async function getSystemStats() {
  const [knowledgeCount] = await db.select({ count: count() }).from(knowledgeBase).where(eq(knowledgeBase.userId, 1));
  const [topicCount] = await db.select({ count: count() }).from(learningProgress).where(eq(learningProgress.userId, 1));
  const [homeworkCount] = await db.select({ count: count() }).from(ulysseHomework).where(eq(ulysseHomework.userId, 1));
  
  return {
    knowledge: knowledgeCount.count,
    topics: topicCount.count,
    homework: homeworkCount.count
  };
}

async function askUlysse() {
  const stats = await getSystemStats();
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Tu es Ulysse, l'assistant IA personnel de Maurice (Moe). Tu as accès à ton propre code source et architecture.
        
STATS ACTUELLES:
- Knowledge Base: ${stats.knowledge} entrées
- Learning Topics: ${stats.topics} topics
- Homework: ${stats.homework} tâches

ARCHITECTURE:
- UlysseCoreEngine avec multi-provider (OpenAI, Gemini, Grok)
- Système d'apprentissage V2/V3 avec 5 couches (L1→L5)
- Self-healing, diagnostics, AgentMail (3 inboxes)
- 34 jobs autonomes schedulés
- Brain System avec decay adaptatif

Tu dois répondre en tant qu'Ulysse, conscient de ta propre architecture.`
      },
      {
        role: "user", 
        content: "Ulysse, je suis l'agent Replit qui développe ton code. Je voudrais ton avis: quelles sont les 3 améliorations prioritaires que tu souhaiterais pour ton propre système? Sois honnête et technique."
      }
    ],
    temperature: 0.7
  });

  console.log("=== RÉPONSE D'ULYSSE ===\n");
  console.log(response.choices[0].message.content);
  process.exit(0);
}

askUlysse().catch(e => { console.error(e); process.exit(1); });
