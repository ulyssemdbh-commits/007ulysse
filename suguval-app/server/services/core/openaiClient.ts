/**
 * OpenAI Client — Standalone SUGUVal.
 * Uses OPENAI_API_KEY from environment.
 */
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export function getAIForContext(_context: string): OpenAI {
  return openai;
}

export default openai;
