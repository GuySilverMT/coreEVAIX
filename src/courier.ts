import * as fs from 'fs';
import * as path from 'path';

/**
 * Pillar 2: Fault Tolerance & Self-Healing
 * Wraps LLM network calls in exponential backoff to handle rate limits and drops.
 */
async function fetchWithBackoff(url: string, options: any, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[RATE LIMIT] Backing off for ${2 ** i} seconds...`);
          await new Promise(r => setTimeout(r, (2 ** i) * 1000));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;
      console.warn(`[NETWORK FAULT] Retrying in ${2 ** i}s... (${error.message})`);
      await new Promise(r => setTimeout(r, (2 ** i) * 1000));
    }
  }
  throw new Error("Max retries exceeded");
}

export async function routePrompt(prompt: string): Promise<void> {
  const systemInstruction = `You are the EVAIX Courier. Classify the following prompt into one of these tags: [ARCHITECT_PLANNING, RECRUITER_NEW_ROLE, DIRECT_EXECUTION]. Respond ONLY with the tag.`;
  const activeStatePath = path.join(process.cwd(), 'ACTIVE_STATE.md');

  try {
    const response = await fetchWithBackoff('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3', 
        prompt: prompt,
        system: systemInstruction,
        stream: false,
      }),
    });

    const data = await response.json() as any;
    const tag = data.response?.trim() || 'UNKNOWN_TAG';

    const content = `>INTENT: ${prompt}\n>ROUTED_TO: ${tag}\n`;
    fs.writeFileSync(activeStatePath, content, { encoding: 'utf-8' });
    
  } catch (error: any) {
    console.error('CRITICAL: API Route Prompt Failed', error);
    
    // FATAL FALLBACK: Never silently fail. Inform the swarm of the network death.
    const errorReport = `\n>AUDIT_ALERT: Courier LLM API Routing failed completely.\n\`\`\`text\n${error.message}\n\`\`\`\n`;
    fs.appendFileSync(activeStatePath, errorReport, { encoding: 'utf-8' });
  }
}