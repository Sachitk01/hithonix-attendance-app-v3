import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY is not set');
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export async function validateShiftPlan(slackUserId: string, planText: string): Promise<{ valid: boolean; reason?: string; normalizedPlan?: string; score?: number }> {
  const prompt = `
You are a strict attendance gatekeeper.
Decide if the user's plan describes real, concrete work or is gibberish / nonsense.

Rules (very important):
- If it looks like a real work plan (tasks, meetings, deliverables, focus areas), return: { "valid": true }.
- If it is empty, random characters, emojis, or obviously non-work gibberish, return: { "valid": false }.
- Only return a single JSON object and nothing else.

User's plan:
"""${planText}"""
  `.trim();

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Model might wrap JSON in markdown code fences; strip them if present
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (typeof parsed.valid === 'boolean') {
      return { valid: parsed.valid, reason: parsed.reason, normalizedPlan: parsed.normalized_plan, score: parsed.score };
    }
    // Fallback: treat as invalid if schema is wrong
    return { valid: false, reason: 'invalid-schema' };
  } catch (err) {
    // On error, be safe and force re-entry
    return { valid: false, reason: 'gatekeeper-error' };
  }
}
