# Implementation: Generalized Arbitrage Engine with Daily Pacing

## Step 1: Prisma Schema Updates

Update the Prisma schema to include enhancements for Provider, add new models if needed for arbitrage sessions, and ensure relational structure for models and pacing.

>WRITE: prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Provider {
  id                  String   @id @default(cuid())
  name                String   @unique
  apiEndpoint         String?
  authEnvVar          String?  // e.g., "XAI_API_KEY"
  riskProfile         String   @default("low") // low, medium, high
  promoBalance        Float    @default(0.0)
  billingCycleEnd     DateTime @default(now() + 30 days) // Default to monthly
  isExhausted         Boolean  @default(false)
  cooldownUntil       DateTime?
  dailySpendTarget    Float?   // Computed per cycle
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  models              Model[]
  sessions            ArbitrageSession[]
}

model Model {
  id                  String   @id @default(cuid())
  name                String   @unique // e.g., "grok-3"
  providerId          String
  provider            Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  inputCostPerMillion Float    @default(0.0)
  outputCostPerMillion Float   @default(0.0)
  isBeta              Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([providerId])
}

model ArbitrageSession {
  id             String   @id @default(cuid())
  providerId     String
  provider       Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)
  sessionId      String   // External session reference
  spendSoFar     Float    @default(0.0)
  cooldownUntil  DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([providerId])
  @@index([cooldownUntil])
}

// Existing models assumed; add indexes for timestamps
```

>CMD: npx prisma generate

>CMD: npx prisma db push

## Step 2: 2-Phase Governor in Arbitrage Engine

Implement the modular routing system in src/arbitrage.ts with the 2-phase governor, including pacing calculator, exhaustion handling, and MACRO_AGENT bypass.

>PATCH: src/arbitrage.ts
```typescript
import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express'; // Assuming Express setup

const prisma = new PrismaClient();

interface ProviderState {
  id: string;
  name: string;
  promoBalance: number;
  billingCycleEnd: Date;
  isExhausted: boolean;
  cooldownUntil?: Date;
  dailySpendTarget?: number;
  riskProfile: string;
}

interface ModelInfo {
  name: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

interface RoutingDecision {
  providerId: string;
  modelName: string;
  phase: 'sprint' | 'pace';
  reason: string;
}

class ArbitrageGovernor {
  private promoThreshold = 0.8; // 80% to unlock sprint phase
  private zeroSpendProxy = 'ZERO_SPEND_PROXY'; // Fallback

  async getProviderStates(): Promise<ProviderState[]> {
    return prisma.provider.findMany({
      select: {
        id: true,
        name: true,
        promoBalance: true,
        billingCycleEnd: true,
        isExhausted: true,
        cooldownUntil: true,
        dailySpendTarget: true,
        riskProfile: true,
      },
    });
  }

  async getModelsForProvider(providerId: string): Promise<ModelInfo[]> {
    return prisma.model.findMany({
      where: { providerId },
      select: { name: true, inputCostPerMillion: true, outputCostPerMillion: true },
    });
  }

  private calculateDailyTarget(remainingBalance: number, daysLeft: number): number {
    return daysLeft > 0 ? remainingBalance / daysLeft : 0;
  }

  private isMidnightReset(cooldownUntil?: Date): boolean {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    return cooldownUntil && cooldownUntil <= midnight;
  }

  private async updateExhaustion(providerId: string, exhausted: boolean, cooldownUntil?: Date) {
    await prisma.provider.update({
      where: { id: providerId },
      data: { isExhausted: exhausted, cooldownUntil },
    });
  }

  private async logSpend(sessionId: string, providerId: string, cost: number) {
    await prisma.arbitrageSession.upsert({
      where: { sessionId_providerId: { sessionId, providerId } },
      update: { spendSoFar: { increment: cost } },
      create: { sessionId, providerId, spendSoFar: cost },
    });

    // Update provider promo balance (simplified; in reality, query actual API)
    await prisma.provider.update({
      where: { id: providerId },
      data: { promoBalance: { decrement: cost } },
    });
  }

  async decideRoute(request: Request): Promise<RoutingDecision | null> {
    const { sessionId, inputTokens, outputTokens, isMacroAgent } = request.body; // Assumed payload

    if (isMacroAgent && sessionId === 'initiateJulesSession') {
      // Bypass for MACRO_AGENT
      return { providerId: 'macro-agent-provider', modelName: 'jules', phase: 'bypass', reason: 'MACRO_AGENT override' };
    }

    const states = await this.getProviderStates();
    const now = new Date();
    const eligibleProviders = states.filter(state => 
      !state.isExhausted || this.isMidnightReset(state.cooldownUntil)
    );

    if (eligibleProviders.length === 0) {
      return { providerId: this.zeroSpendProxy, modelName: 'fallback', phase: 'exhausted', reason: 'All providers exhausted' };
    }

    // Determine phase: Sprint if under threshold, else pace
    let phase: 'sprint' | 'pace' = 'pace';
    for (const state of eligibleProviders) {
      const utilized = 1 - (state.promoBalance / /* initial balance from config */ 100); // Assume initial 100 for demo
      if (utilized < this.promoThreshold && state.riskProfile === 'low') {
        phase = 'sprint';
        break;
      }
    }

    // For sprint phase: Route to lowest risk, highest promo
    if (phase === 'sprint') {
      const sprintProvider = eligibleProviders
        .filter(p => p.riskProfile === 'low')
        .sort((a, b) => b.promoBalance - a.promoBalance)[0];
      if (sprintProvider) {
        const models = await this.getModelsForProvider(sprintProvider.id);
        const optimalModel = models[0]; // Simplest: first model
        const cost = (inputTokens / 1e6 * optimalModel.inputCostPerMillion) + (outputTokens / 1e6 * optimalModel.outputCostPerMillion);
        await this.logSpend(sessionId, sprintProvider.id, cost);
        return { providerId: sprintProvider.id, modelName: optimalModel.name, phase, reason: 'Sprint to promo' };
      }
    }

    // For pace phase: Check daily target
    for (const state of eligibleProviders) {
      const daysLeft = Math.max(0, (state.billingCycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const target = this.calculateDailyTarget(state.promoBalance, daysLeft);
      state.dailySpendTarget = target;

      // Simplified daily usage check; in prod, query actual daily spend
      const currentDailyUsage = /* fetch from logs */ 0; // Placeholder
      if (currentDailyUsage < target) {
        const models = await this.getModelsForProvider(state.id);
        const optimalModel = models.sort((a, b) => a.inputCostPerMillion + a.outputCostPerMillion - (b.inputCostPerMillion + b.outputCostPerMillion))[0];
        const cost = (inputTokens / 1e6 * optimalModel.inputCostPerMillion) + (outputTokens / 1e6 * optimalModel.outputCostPerMillion);
        if (state.promoBalance - cost > 0) {
          await this.logSpend(sessionId, state.id, cost);
          return { providerId: state.id, modelName: optimalModel.name, phase, reason: 'Within daily pace' };
        }
      } else {
        // Exhausted for day
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        await this.updateExhaustion(state.id, true, midnight);
      }
    }

    // Fallback to zero spend
    await this.updateExhaustion(eligibleProviders[0].id, true, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0));
    return { providerId: this.zeroSpendProxy, modelName: 'fallback', phase: 'exhausted', reason: 'Daily target hit' };
  }
}

// Export for use in handlers
export const arbitrator = new ArbitrageGovernor();

// Scheduled reset (integrate with cron or similar)
export async function dailyReset() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  await prisma.provider.updateMany({
    where: { cooldownUntil: { lte: midnight } },
    data: { isExhausted: false, cooldownUntil: null },
  });
  // Recalculate targets for active providers
  const providers = await prisma.provider.findMany({ where: { promoBalance: { gt: 0 } } });
  for (const p of providers) {
    const daysLeft = Math.max(0, (p.billingCycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const target = p.promoBalance / daysLeft;
    await prisma.provider.update({
      where: { id: p.id },
      data: { dailySpendTarget: target },
    });
  }
}
```

## Step 3: Seed Script for xAI Fleet

Create the seed script to populate providers and models, focusing on xAI, with pricing data.

>WRITE: src/seed-models.ts
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed xAI Provider
  const xaiProvider = await prisma.provider.upsert({
    where: { name: 'xAI' },
    update: {},
    create: {
      name: 'xAI',
      apiEndpoint: 'https://api.x.ai/v1',
      authEnvVar: 'XAI_API_KEY',
      riskProfile: 'low',
      promoBalance: 100.0, // Initial promo
      billingCycleEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1), // Monthly end
    },
  });

  // Seed xAI Models with pricing (sourced from research; approximate)
  const modelsData = [
    {
      name: 'grok-3',
      inputCostPerMillion: 5.0,
      outputCostPerMillion: 15.0,
      isBeta: false,
    },
    {
      name: 'grok-4-fast',
      inputCostPerMillion: 10.0,
      outputCostPerMillion: 30.0,
      isBeta: false,
    },
    {
      name: 'grok-beta',
      inputCostPerMillion: 3.0,
      outputCostPerMillion: 9.0,
      isBeta: true,
    },
  ];

  for (const modelData of modelsData) {
    await prisma.model.upsert({
      where: { name: modelData.name },
      update: {},
      create: {
        name: modelData.name,
        providerId: xaiProvider.id,
        inputCostPerMillion: modelData.inputCostPerMillion,
        outputCostPerMillion: modelData.outputCostPerMillion,
        isBeta: modelData.isBeta,
      },
    });
  }

  console.log('xAI fleet seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

>CMD: npx ts-node src/seed-models.ts

## Step 4: MACRO_AGENT Bypass Preservation

The bypass is already integrated in the arbitrator's decideRoute method (see Step 2). No additional changes needed; it checks for isMacroAgent and sessionId === 'initiateJulesSession' to route directly.

## Integration Notes

- **Request Handling**: Update any upstream Express routes to call arbitrator.decideRoute(req) before forwarding to providers.
- **Cron for Resets**: Integrate dailyReset() with a scheduler like node-cron: `>npm install node-cron` then in main app: `cron.schedule('0 0 * * *', dailyReset);`.
- **ZERO_SPEND_PROXY**: Implement as a simple passthrough or halt in a separate handler.

>CMD: npm install @types/node-cron  # If using TypeScript cron
