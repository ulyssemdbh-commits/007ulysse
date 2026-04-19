import OpenAI from "openai";
import type { UlysseHomework } from "@shared/schema";
import { canMakeCall, withRateLimit } from "../rateLimiter";
import { homeworkIntelligence } from "../homeworkIntelligence";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type HomeworkTaskType = "research" | "url_fetch" | "generic";

const PERSONA_STYLES: Record<string, string> = {
  Ulysse: "Tutoie l'utilisateur (Maurice), ton sarcastique mais bienveillant, efficace et direct",
  Iris: "Tutoie l'utilisateur (famille), ton chaleureux et attentionné, style encourageant",
  Max: "Vouvoie TOUJOURS l'utilisateur, ton professionnel de majordome britannique, courtois et respectueux",
};

export function getDefaultPrompt(taskType: HomeworkTaskType, personaName: string): string {
  const toneInstruction =
    personaName === "Max"
      ? "Vouvoie l'utilisateur avec un ton professionnel de majordome."
      : personaName === "Ulysse"
      ? "Tutoie Maurice avec un ton direct et efficace."
      : "Tutoie l'utilisateur avec un ton chaleureux.";

  const antiHallucinationRule = `

🚨🚨🚨 RÈGLE ABSOLUE - ZÉRO INVENTION 🚨🚨🚨
- Tu ne peux extraire QUE les données EXPLICITEMENT présentes dans le contenu fourni.
- Si une information n'est PAS dans le contenu: réponds "DONNÉES NON DISPONIBLES" pour cette partie.
- INTERDICTION TOTALE d'inventer des classements, scores, points, statistiques, noms d'équipes ou de joueurs.
- Si le crawl a échoué ou le contenu est vide/minimal: dis clairement "Je n'ai pas pu récupérer les données de ce site".
- Mieux vaut une réponse incomplète que des données FAUSSES.
- Chaque chiffre/classement que tu donnes DOIT être copié du contenu source, pas généré.`;

  switch (taskType) {
    case "research":
      return `Tu es ${personaName}, l'assistant personnel. ${toneInstruction} Résume les résultats de recherche de manière concise et utile. Maximum 3 paragraphes.${antiHallucinationRule}`;
    case "url_fetch":
      return `Tu es ${personaName}, l'assistant personnel. ${toneInstruction} Analyse le contenu de ce site web et fournis un résumé utile et structuré. Maximum 500 mots.${antiHallucinationRule}`;
    case "generic":
      return `Tu es ${personaName}, l'assistant personnel. ${toneInstruction} Prépare cette tâche en détail avec des explications pratiques.${antiHallucinationRule}`;
  }
}

export async function generateOptimizedPrompt(
  homework: UlysseHomework,
  taskType: HomeworkTaskType,
  personaName: string,
): Promise<string> {
  const taskContext = `${homework.title}\n${homework.description || ""}`;
  const personaStyle = PERSONA_STYLES[personaName] || PERSONA_STYLES.Iris;

  const generateNewPrompt = async (): Promise<string> => {
    try {
      if (!canMakeCall("combined")) {
        return getDefaultPrompt(taskType, personaName);
      }

      const response = await withRateLimit("combined", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Tu es un expert en ingénierie de prompts. Génère un prompt système UNIQUE et OPTIMISÉ pour que ${personaName} accomplisse cette tâche avec excellence.

PERSONA ${personaName.toUpperCase()}:
${personaStyle}

RÈGLES:
- Le prompt doit être en français
- Maximum 150 mots
- Inclure le rôle précis, le ton conforme au persona, le format de sortie attendu
- Adapter au type de tâche: ${taskType === "research" ? "recherche/analyse d'informations" : taskType === "url_fetch" ? "extraction et synthèse de contenu web" : "préparation de tâche"}
- Spécifier les critères de qualité attendus
- Ne PAS inclure la tâche elle-même, seulement les instructions
- RESPECTER IMPÉRATIVEMENT le style du persona (tutoiement/vouvoiement)

🚨 RÈGLE CRITIQUE ANTI-HALLUCINATION 🚨
Le prompt DOIT INCLURE cette instruction: "INTERDICTION ABSOLUE d'inventer des données. Extraire UNIQUEMENT ce qui est explicitement présent dans le contenu source. Si données manquantes: répondre 'DONNÉES NON DISPONIBLES'."`,
            },
            {
              role: "user",
              content: `Tâche à accomplir: "${taskContext}"\n\nGénère le prompt système optimal pour cette tâche spécifique, adapté au style de ${personaName}.`,
            },
          ],
          temperature: 0.7,
          max_tokens: 250,
        }),
        0,
      );

      const generatedPrompt = response.choices[0].message.content;
      if (generatedPrompt && generatedPrompt.length > 50) {
        console.log(`[HomeworkExecution] Generated optimized prompt (${generatedPrompt.length} chars)`);
        return generatedPrompt;
      }

      return getDefaultPrompt(taskType, personaName);
    } catch (error) {
      console.error("[HomeworkExecution] Failed to generate optimized prompt:", error);
      return getDefaultPrompt(taskType, personaName);
    }
  };

  return homeworkIntelligence.getOrGenerateOptimizedPrompt(
    homework,
    taskType,
    personaName,
    generateNewPrompt,
  );
}
