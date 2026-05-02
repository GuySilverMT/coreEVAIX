import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------
export interface TaskPayload {
    intent: string;
    tags: string[];
}

export interface RoutingDecision {
    providerName: string;
    modelName: string;
}

// ---------------------------------------------------------
// Proxies & Stubs
// ---------------------------------------------------------
export async function initiateJulesSession(task: string): Promise<string> {
    console.log(`[MACRO_AGENT] Bypassing fleet... Triggering Jules for task: ${task.substring(0, 30)}...`);
    return "JULES_PROXY_TRIGGERED";
}

// ---------------------------------------------------------
// Core Arbitrage Engine (GOVERNOR OFF)
// ---------------------------------------------------------
export class ArbitrageEngine {
    
    public async route(task: TaskPayload): Promise<RoutingDecision> {
        // 1. MACRO_AGENT Bypass
        if (task.tags.includes('MACRO_FEATURE')) {
            await initiateJulesSession(task.intent);
            return { providerName: 'ZERO_SPEND_PROXY', modelName: 'JULES' };
        }

        // 2. Query available providers (Governor OFF: Ignore all exhaustedUntil limits)
        const providers = await prisma.provider.findMany({
            include: { models: true }
        });

        // 3. Route to the primary provider without pacing or sprint limits
        for (const p of providers) {
            if (p.name === 'LOCAL_MACRO') continue; // Skip local proxy for standard tasks
            
            return this.selectOptimalModel(p);
        }

        // 4. Ultimate Fallback
        return { providerName: 'ZERO_SPEND_PROXY', modelName: 'FALLBACK' };
    }

    private selectOptimalModel(provider: any): RoutingDecision {
        // Simplified selection: grab the first attached model, or default
        const model = provider.models && provider.models.length > 0 ? provider.models[0] : null;
        return {
            providerName: provider.name,
            modelName: model?.name ?? 'DEFAULT'
        };
    }

    // Safely drain the promo budget using a Prisma Transaction (Kept for logging)
    public async recordCost(providerId: string, costInUsd: number): Promise<void> {
        await prisma.$transaction(async (tx) => {
            const p = await tx.provider.findUnique({ where: { id: providerId } });
            if (!p) return;
            
            const currentTotal = p.totalSpent ?? 0;
            const currentPromo = p.promoBalance ?? 0;

            await tx.provider.update({
                where: { id: providerId },
                data: {
                    totalSpent: currentTotal + costInUsd,
                    promoBalance: Math.max(0, currentPromo - costInUsd)
                }
            });
        });
    }
}
