import * as fs from 'fs';
import * as path from 'path';

async function runAgent() {
  const role = process.argv[2];
  if (!role) {
    console.error("No role provided to dispatcher.");
    return;
  }

  console.log(`[DISPATCHER] Waking up ${role}...`);

  const envPath = path.join(process.cwd(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  envContent.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val) env[key.trim()] = val.join('=').trim();
  });

  const apiKey = env['XAI_API_KEY'];
  const baseUrl = env['PROVIDER_BASE_URL'] || 'https://api.x.ai/v1';
  const model = env['PROVIDER_MODEL'] || 'grok-4-fast-reasoning';

  const activeStatePath = path.join(process.cwd(), 'ACTIVE_STATE.md');
  const stateContent = fs.readFileSync(activeStatePath, 'utf-8');
  
  let roleFile = role.toLowerCase().replace(/_/g, '-');
  if (role === 'RECRUITER_NEW_ROLE') roleFile = 'recruiter';
  if (role === 'ARCHITECT_PLANNING') roleFile = 'architect';

  const skillPath = path.join(process.cwd(), 'core-skills', `${roleFile}.skill.md`);
  let systemInstruction = "You are an EVAIX Agent.";
  try {
    systemInstruction = fs.readFileSync(skillPath, 'utf-8');
  } catch {
    console.error(`Skill file missing for ${roleFile}`);
  }

  console.log(`[DISPATCHER] Routing task to ${model} at ${baseUrl}...`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `Current State:\n${stateContent}\n\nExecute your primary directive based on the INTENT.` }
      ]
    })
  });

  const data = await response.json() as any;
  if (data.error) {
    console.error("\n[DISPATCHER] API ERROR ->", data.error);
  }
  
  const agentOutput = data.choices?.[0]?.message?.content || ">KERNEL_INTERCEPT: API Error. Check terminal logs.";

  const backupPath = path.join(process.cwd(), `LAST_OUTPUT_${roleFile.toUpperCase()}.md`);
  fs.writeFileSync(backupPath, `${agentOutput}\n`);
  fs.writeFileSync(activeStatePath, `${agentOutput}\n`);
  console.log(`[DISPATCHER] ${role} execution complete. Backup saved to ${backupPath}`);
}

runAgent().catch(console.error);
