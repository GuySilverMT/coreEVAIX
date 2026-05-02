import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as chokidar from 'chokidar';

const execAsync = promisify(exec);

const ACTIVE_STATE_FILE = 'ACTIVE_STATE.md';
const TEMP_TS_FILE = 'temp_kernel_exec.ts';
const BLOCKLIST_REGEX = /(rm\s+-rf|mkfs|chmod\s+777|chown)/;

// 1. STRICT SANDBOXING
const ALLOWED_DIRECTORIES = ['src', 'prisma', 'tests'];
const FORBIDDEN_FILES = ['.env', '.gitignore', 'package.json', 'kernel.ts', 'agent-runner.ts'];

class SecurityFault extends Error {
  constructor(message: string) { super(`[SECURITY FAULT] ${message}`); }
}

class ValidationFault extends Error {
  constructor(message: string) { super(`[VALIDATION FAULT] ${message}`); }
}

export enum BlockType {
  WRITE = 'WRITE',
  PATCH = 'PATCH',
  CMD = 'CMD',
  TS = 'TS'
}

export interface CommandBlock {
  type: BlockType;
  content: string;
  writeDetails?: { filepath: string };
  patchDetails?: { filepath: string; search: string; replace: string };
}

export class CodeValidator {
  static assertSafePath(filepath: string) {
    const normalized = path.normalize(filepath);
    const filename = path.basename(normalized);
    if (FORBIDDEN_FILES.includes(filename) || normalized.includes('.skill.md')) {
      throw new SecurityFault(`Agents are strictly forbidden from modifying ${filename}.`);
    }
    const isAllowedDir = ALLOWED_DIRECTORIES.some(dir => normalized.startsWith(dir));
    if (!isAllowedDir) {
      throw new SecurityFault(`Path ${filepath} is outside allowed working directories: ${ALLOWED_DIRECTORIES.join(', ')}`);
    }
  }

  static async validateTypeScript(filepath: string, newContent: string): Promise<void> {
    const backupContent = await fs.readFile(filepath, 'utf-8').catch(() => null);
    try {
      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, newContent, 'utf-8');
      // Validate the whole project using tsconfig.json
      await execAsync(`npx tsc --noEmit`);
    } catch (error: any) {
      // Rollback
      if (backupContent !== null) {
        await fs.writeFile(filepath, backupContent, 'utf-8');
      } else {
        await fs.unlink(filepath).catch(() => {});
      }
      throw new ValidationFault(`TypeScript compilation failed:\n${error.stdout || error.message}`);
    }
  }

  static async validatePrismaSchema(filepath: string, newContent: string): Promise<void> {
    const backupContent = await fs.readFile(filepath, 'utf-8').catch(() => '');
    try {
      await fs.writeFile(filepath, newContent, 'utf-8');
      await execAsync(`npx prisma validate`);
    } catch (error: any) {
      await fs.writeFile(filepath, backupContent, 'utf-8');
      throw new ValidationFault(`Prisma schema validation failed:\n${error.stderr || error.stdout || error.message}`);
    }
  }
}

async function parseActiveState(content: string): Promise<CommandBlock[]> {
  const blocks: CommandBlock[] = [];
  const lines = content.split('\n');
  let i = 0;

  console.log(`[DEBUG-PARSER] Analyzing ${lines.length} lines of ACTIVE_STATE.md...`);

  while (i < lines.length) {
    const rawLine = lines[i] as string;
    const line = rawLine.trim();

    if (line.startsWith('>CMD:')) {
      console.log(`[DEBUG-PARSER] MATCH: Found >CMD:`);
      const cmd = rawLine.substring(rawLine.indexOf('>CMD:') + 5).trim();
      blocks.push({ type: BlockType.CMD, content: cmd });
      i++;
    } else if (line.startsWith('```typescript')) {
      console.log(`[DEBUG-PARSER] MATCH: Found TypeScript block`);
      let tsContent = '';
      i++; 
      while (i < lines.length && !(lines[i] as string).trim().startsWith('```')) {
        tsContent += (lines[i] as string) + '\n';
        i++;
      }
      blocks.push({ type: BlockType.TS, content: tsContent });
      i++; 
    } else if (line.startsWith('>PATCH:')) {
      console.log(`[DEBUG-PARSER] MATCH: Found >PATCH:`);
      const filepath = rawLine.substring(rawLine.indexOf('>PATCH:') + 7).trim();
      i++;
      let search = ''; let replace = ''; let inSearch = false; let inReplace = false;

      while (i < lines.length) {
        const pLine = lines[i] as string;
        if (pLine.trim().startsWith('>SEARCH:')) {
          inSearch = true; inReplace = false; i++;
        } else if (pLine.trim().startsWith('>REPLACE:')) {
          inSearch = false; inReplace = true; i++;
        } else if (
          pLine.trim().startsWith('>CMD:') || pLine.trim().startsWith('```') || 
          pLine.trim().startsWith('>PATCH:') || pLine.trim().startsWith('>WRITE:') || 
          (!inSearch && !inReplace && pLine.trim() !== '')
        ) {
          break;
        } else {
          if (inSearch) search += pLine + '\n';
          else if (inReplace) replace += pLine + '\n';
          i++;
        }
      }
      if (search.endsWith('\n')) search = search.slice(0, -1);
      if (replace.endsWith('\n')) replace = replace.slice(0, -1);
      blocks.push({ type: BlockType.PATCH, content: '', patchDetails: { filepath, search, replace } });
    } else if (line.startsWith('>WRITE:')) {
      console.log(`[DEBUG-PARSER] MATCH: Found >WRITE:`);
      const filepath = rawLine.substring(rawLine.indexOf('>WRITE:') + 7).trim();
      i++; 
      let writeContent = '';
      if (i < lines.length && (lines[i] as string).trim().startsWith('```')) {
        i++; 
        while (i < lines.length && !(lines[i] as string).trim().startsWith('```')) {
          writeContent += (lines[i] as string) + '\n';
          i++;
        }
        if (i < lines.length && (lines[i] as string).trim().startsWith('```')) i++;
      }
      blocks.push({ type: BlockType.WRITE, content: writeContent, writeDetails: { filepath } });
    } else if (line.startsWith('>ROUTED_TO:')) {
      console.log(`[DEBUG-PARSER] MATCH: Found >ROUTED_TO:`);
      const role = rawLine.substring(rawLine.indexOf('>ROUTED_TO:') + 11).trim();
      console.log(`[DEBUG-PARSER] Extracting role: [${role}]`);
      blocks.push({ type: BlockType.CMD, content: `npx tsx src/agent-runner.ts ${role}` });
      i++;
    } else {
      if (line.length > 0) {
        console.log(`[DEBUG-PARSER] IGNORING: ${line.substring(0, 50)}...`);
      }
      i++;
    }
  }
  return blocks;
}

export async function executeBlocks(blocks: CommandBlock[]) {
  console.log(`\n[DEBUG-EXEC] Preparing to execute ${blocks.length} blocks...`);
  for (const block of blocks) {
    const contentToCheck = block.content || block.writeDetails?.filepath || block.patchDetails?.filepath || '';
    if (BLOCKLIST_REGEX.test(contentToCheck)) {
      console.log(`>KERNEL_INTERCEPT: Blocklist violation detected.`);
      return; 
    }

    try {
      if (block.type === BlockType.WRITE || block.type === BlockType.PATCH) {
        const filepath = block.writeDetails?.filepath || block.patchDetails!.filepath;
        CodeValidator.assertSafePath(filepath);
        let proposedContent = block.content;

        if (block.type === BlockType.PATCH) {
           const currentContent = await fs.readFile(filepath, 'utf-8');
           const { search, replace } = block.patchDetails!;
           if (!currentContent.includes(search)) {
             throw new ValidationFault(`PATCH failed: >SEARCH string not found in ${filepath}`);
           }
           proposedContent = currentContent.replace(search, replace);
        }

        if (filepath.endsWith('.ts')) {
          await CodeValidator.validateTypeScript(filepath, proposedContent);
        } else if (filepath.endsWith('.prisma')) {
          await CodeValidator.validatePrismaSchema(filepath, proposedContent);
        } else {
          // Normal files (like markdown or JSON)
          await fs.mkdir(path.dirname(filepath), { recursive: true });
          await fs.writeFile(filepath, proposedContent, 'utf-8');
        }

        console.log(`>KERNEL: Successfully committed and validated ${filepath}`);
        
      } else if (block.type === BlockType.CMD) {
        console.log(`>KERNEL: Executing CMD: ${block.content}`);
        const { stdout, stderr } = await execAsync(block.content);
        if (stdout) console.log(`[STDOUT]\n${stdout}`);
        if (stderr) console.error(`[STDERR]\n${stderr}`);
      } else if (block.type === BlockType.TS) {
        console.log(`>KERNEL: Executing TS block...`);
        await fs.writeFile(TEMP_TS_FILE, block.content, 'utf-8');
        try {
          const { stdout, stderr } = await execAsync(`npx tsx ${TEMP_TS_FILE}`);
          if (stdout) console.log(`[STDOUT]\n${stdout}`);
          if (stderr) console.error(`[STDERR]\n${stderr}`);
        } finally {
          await fs.unlink(TEMP_TS_FILE).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error(`>KERNEL_INTERCEPT: ${err.message}`);
      const errorReport = `\n>AUDIT_ALERT: Operation failed.\n\`\`\`text\n${err.message}\n\`\`\`\n`;
      await fs.writeFile('ACTIVE_STATE.md', errorReport, 'utf-8'); // Keeps the buffer clear!
      return; 
    }
  }
  console.log(`[DEBUG-EXEC] Execution batch complete.\n`);
}

async function main() {
  console.log(`[SYSTEM] Starting Resilient EVAIX Kernel with enhanced telemetry...`);
  console.log(`[SYSTEM] Watching ${ACTIVE_STATE_FILE} for changes...`);

  const watcher = chokidar.watch(ACTIVE_STATE_FILE, { 
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000, 
      pollInterval: 250
    }
  });

  watcher.on('change', async () => {
    console.log(`\n==================================================`);
    console.log(`[DEBUG-WATCHER] File change detected on ${ACTIVE_STATE_FILE}`);
    try {
      const content = await fs.readFile(ACTIVE_STATE_FILE, 'utf-8');
      if (!content.trim()) {
        console.log(`[DEBUG-WATCHER] File is empty. Ignoring.`);
        return;
      }
      console.log(`[DEBUG-WATCHER] Raw content length: ${content.length} bytes`);

      const blocks = await parseActiveState(content);
      if (blocks.length > 0) {
        await executeBlocks(blocks);
      } else {
        console.log(`[DEBUG-WATCHER] No actionable blocks found. Sleeping.`);
      }
    } catch (err) {
      console.error(`>KERNEL_WATCH_ERROR: ${err}`);
    }
  });
}

main().catch(console.error);
