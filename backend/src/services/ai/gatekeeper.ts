import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function validateShiftPlan(slackUserId: string, planText: string): Promise<{ valid: boolean; reason?: string; normalizedPlan?: string; score?: number }> {
  const prompt = `You are a strict validator. Output JSON exactly: {"valid": true|false, "reason":"...", "normalized_plan":"...", "score":<0-1>}\n\nPlan:\n${planText}`;
  const resp = await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: prompt }], max_tokens: 200, temperature: 0.0 });
  const raw = resp.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(raw);
    return { valid: !!parsed.valid, reason: parsed.reason, normalizedPlan: parsed.normalized_plan, score: parsed.score };
  } catch (err) {
    return { valid: false, reason: 'gatekeeper-parse-failure' };
  }
}
