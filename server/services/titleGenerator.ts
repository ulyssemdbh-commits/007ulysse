import OpenAI from "openai";

const openai = new OpenAI();

export async function generateChatTitle(userMessage: string): Promise<string> {
  const truncated = userMessage.slice(0, 300);
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Generate a short, descriptive title (max 50 chars) for a conversation that starts with the user message below. The title should capture the main topic. Reply ONLY with the title, no quotes, no punctuation at the end. Use the same language as the user message."
        },
        { role: "user", content: truncated }
      ],
      max_tokens: 30,
      temperature: 0.3,
    });

    const title = response.choices[0]?.message?.content?.trim();
    if (!title || title.length < 2) {
      return fallbackTitle(userMessage);
    }
    return title.slice(0, 80);
  } catch (err) {
    console.error("[TitleGenerator] AI title generation failed:", err);
    return fallbackTitle(userMessage);
  }
}

function fallbackTitle(message: string): string {
  const clean = message.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean;
  return clean.slice(0, 57) + "...";
}
