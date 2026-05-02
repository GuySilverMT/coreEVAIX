import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("[SEED] Initializing EVAIX Fleet with updated pricing tiers...");

  // 1. Create the primary xAI Provider
  const xaiProvider = await prisma.provider.upsert({
    where: { name: 'xAI' },
    update: {},
    create: {
      name: 'xAI',
      baseUrl: 'https://api.x.ai/v1',
      authEnvKey: 'XAI_API_KEY',
      riskProfile: 'MEDIUM',
      promoBalance: 10.00, // Starting promo burn budget
      totalSpent: 0.07,    // Logging your existing $0.07 spend
      billingCycleEnd: new Date(new Date().setMonth(new Date().getMonth() + 1)),
    }
  });

  // 2. Create the ZERO_SPEND_PROXY Provider
  const proxyProvider = await prisma.provider.upsert({
    where: { name: 'LOCAL_MACRO' },
    update: {},
    create: {
      name: 'LOCAL_MACRO',
      baseUrl: 'localhost',
      authEnvKey: 'NONE',
      riskProfile: 'LOW',
      promoBalance: 999.00, 
    }
  });

  // 3. Define the Fleet (Text/Reasoning Models)
  const models = [
    { providerId: proxyProvider.id, name: 'JULES_SESSION', contextSize: 128000, inputCost: 0.00, outputCost: 0.00, startElo: 1500 },
    
    // Tier 1: The Vanguard (Fast & Cheap)
    { providerId: xaiProvider.id, name: 'grok-4-1-fast-non-reasoning', contextSize: 2000000, inputCost: 0.20, outputCost: 0.50, startElo: 1200 },
    { providerId: xaiProvider.id, name: 'grok-4-1-fast-reasoning', contextSize: 2000000, inputCost: 0.20, outputCost: 0.50, startElo: 1100 },
    
    // Tier 2: The Heavy Artillery (Expensive)
    { providerId: xaiProvider.id, name: 'grok-4.3', contextSize: 1000000, inputCost: 1.25, outputCost: 2.50, startElo: 800 },
    { providerId: xaiProvider.id, name: 'grok-4.20-0309-reasoning', contextSize: 2000000, inputCost: 1.25, outputCost: 2.50, startElo: 850 },
    { providerId: xaiProvider.id, name: 'grok-4.20-multi-agent-0309', contextSize: 2000000, inputCost: 1.25, outputCost: 2.50, startElo: 850 },
    { providerId: xaiProvider.id, name: 'grok-4.20-0309-non-reasoning', contextSize: 2000000, inputCost: 1.25, outputCost: 2.50, startElo: 800 }
  ];

  // 4. Insert Models and their starting Elo
  for (const m of models) {
    const modelRecord = await prisma.model.upsert({
      where: {
        name_providerId: {
          name: m.name,
          providerId: m.providerId
        }
      },
      update: {
        contextSize: m.contextSize,
      },
      create: {
        providerId: m.providerId,
        name: m.name,
        contextSize: m.contextSize,
      }
    });

    // We start the cheaper models with a higher Elo rating so the Arbitrage Engine picks them first.
    // If they fail, the Dispatcher will slash their Elo, promoting grok-4.3 to the top spot.
    await prisma.arbitrageScore.upsert({
      where: {
        modelId_taskTag: {
          modelId: modelRecord.id,
          taskTag: 'GENERAL',
        }
      },
      update: {
        eloRating: m.startElo,
      },
      create: {
        modelId: modelRecord.id,
        taskTag: 'GENERAL',
        eloRating: m.startElo,
      }
    });
    
    console.log(`[SEED] Deployed: ${m.name} (Input: $${m.inputCost}/M, Output: $${m.outputCost}/M)`);
  }

  console.log("[SEED] EVAIX Fleet roster successfully initialized.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
