>WRITE: src/arbitrage.ts
```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function initiateJulesSession(task: string) {
  return "JULES_PROXY_TRIGGERED";
}

interface ArbitrageDecision {
  phase: 1 | 2;
  allowedSpend: number;
  route: 'SPEND_PROXY' | 'ZERO_SPEND_PROXY';
  updates?: Record<string, any>;
}

export async function getArbitrageDecision(providerId: string): Promise<ArbitrageDecision> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId }
  });

  if (!provider) {
    return { phase: 2, allowedSpend: 0, route: 'ZERO_SPEND_PROXY' };
  }

  const now = new Date();

  if (provider.exhaustedUntil && provider.exhaustedUntil > now) {
    return { phase: 2, allowedSpend: 0, route: 'ZERO_SPEND_PROXY' };
  }

  // MACRO_AGENT bypass
  await initiateJulesSession('arbitrage macro agent bypass');

  if (provider.totalSpent < 5) {
    const target = 5 - provider.totalSpent;
    return {
      phase: 1,
      allowedSpend: target,
      route: 'SPEND_PROXY'
    };
  } else {
    // Phase 2
    if (provider.promoBalance <= 0) {
      return { phase: 2, allowedSpend: 0, route: 'ZERO_SPEND_PROXY' };
    }

    const cycleEnd = new Date(provider.billingCycleEnd);
    if (cycleEnd <= now) {
      return { phase: 2, allowedSpend: 0, route: 'ZERO_SPEND_PROXY' };
    }

    const timeLeftMs = cycleEnd.getTime() - now.getTime();
    const daysLeft = Math.max(1, Math.ceil(timeLeftMs / (1000 * 60 * 60 * 24)));
    const dailyTarget = Math.floor(provider.promoBalance / daysLeft);

    return {
      phase: 2,
      allowedSpend: dailyTarget,
      route: 'SPEND_PROXY'
    };
  }
}

export async function reportSpend(providerId: string, spent: number, decision: ArbitrageDecision) {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Update totalSpent
    await tx.provider.update({
      where: { id: providerId },
      data: {
        totalSpent: {
          increment: spent
        }
      }
    });

    // Fetch updated provider
    const updatedProvider = await tx.provider.findUnique({
      where: { id: providerId }
    });

    if (!updatedProvider) return;

    const additionalUpdates: Record<string, any> = { ... (decision.updates || {}) };

    // Unlock promos if threshold reached (assuming promoBalance starts at 0 and needs setting; value arbitrary as not specified)
    if (updatedProvider.totalSpent >= 5 && updatedProvider.promoBalance === 0) {
      additionalUpdates.promoBalance = 100; // Placeholder value for unlocked promo balance
    }

    // For Phase 2, if daily target reached, exhaust until next midnight
    if (decision.phase === 2 && spent >= decision.allowedSpend) {
      const tomorrowMidnight = new Date(now);
      tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
      tomorrowMidnight.setHours(0, 0, 0, 0);
      additionalUpdates.exhaustedUntil = tomorrowMidnight;
    }

    if (Object.keys(additionalUpdates).length > 0) {
      await tx.provider.update({
        where: { id: providerId },
        data: additionalUpdates
      });
    }
  });
}
```
