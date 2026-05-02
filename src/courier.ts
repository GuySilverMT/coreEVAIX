import * as fs from 'fs';
import * as path from 'path';

export async function routePrompt(prompt: string): Promise<void> {
  const systemInstruction = `You are the EVAIX Courier. Classify the following prompt into one of these tags: [ARCHITECT_PLANNING, RECRUITER_NEW_ROLE, DIRECT_EXECUTION]. Respond ONLY with the tag.`;

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3', // Note: Using llama3 as a default, though this might need configuration if a specific model is intended.
        prompt: prompt,
        system: systemInstruction,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status: ${response.status}`);
    }

    const data = await response.json() as any;
    const tag = data.response?.trim() || 'UNKNOWN_TAG';

    const activeStatePath = path.join(process.cwd(), 'ACTIVE_STATE.md');
    const content = `>INTENT: ${prompt}\n>ROUTED_TO: ${tag}\n`;

    fs.writeFileSync(activeStatePath, content, { encoding: 'utf-8' });
  } catch (error) {
    console.error('Error in routePrompt:', error);
    // In a real scenario we might want to propagate this error or handle it differently.
    // For now, we will just log it.
  }
}
