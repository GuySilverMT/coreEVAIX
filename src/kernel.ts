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

  static async validateTypeScript(content: string): Promise<void> {
    const tempFile = 'temp_validation.ts';
    try {
      await fs.writeFile(tempFile, content, 'utf-8');
      await execAsync(`npx tsc --noEmit ${tempFile}`);
    } catch (error: any) {
      throw new ValidationFault(`TypeScript compilation failed:\n${error.stdout || error.message}`);
    } finally {
      await fs.unlink(tempFile).catch(() => {});
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

  while (i < lines.length) {
    const line = lines[i] as string;

    if (line.startsWith('>CMD:')) {
      const cmd = line.substring('>CMD:'.length).trim();
      blocks.push({ type: BlockType.CMD, content: cmd });
      i++;
    } else if (line.startsWith('```typescript')) {
      let tsContent = '';
      i++; 
      while (i < lines.length && !(lines[i] as string).startsWith('```')) {
        tsContent += (lines[i] as string) + '\n';
        i++;
      }
      blocks.push({ type: BlockType.TS, content: tsContent });
      i++; 
    } else if (line.startsWith('>PATCH:')) {
      const filepath = line.substring('>PATCH:'.length).trim();
      i++;

      let search = '';
      let replace = '';
      let inSearch = false;
      let inReplace = false;

      while (i < lines.length) {
        const pLine = lines[i] as string;
        if (pLine.startsWith('>SEARCH:')) {
          inSearch = true;
          inReplace = false;
          i++;
        } else if (pLine.startsWith('>REPLACE:')) {
          inSearch = false;
          inReplace = true;
          i++;
        } else if (
          pLine.startsWith('>CMD:') || pLine.startsWith('```') || 
          pLine.startsWith('>PATCH:') || pLine.startsWith('>WRITE:') || 
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

      blocks.push({
        type: BlockType.PATCH,
        content: '',
        patchDetails: { filepath, search, replace }
      });
    } else if (line.startsWith('>WRITE:')) {
      const filepath = line.substring('>WRITE:'.length).trim();
      i++; 

      let writeContent = '';
      if (i < lines.length && (lines[i] as string).startsWith('```')) {
        i++; 
        while (i < lines.length && !(lines[i] as string).startsWith('```')) {
          writeContent += (lines[i] as string) + '\n';
          i++;
        }
        if (i < lines.length && (lines[i] as string).startsWith('```')) i++;
      }

      blocks.push({
        type: BlockType.WRITE,
        content: writeContent,
        writeDetails: { filepath }
      });
    } else {
      i++;
    }
  }

  return blocks;
}

export async function executeBlocks(blocks: CommandBlock[]) {
  for (const block of blocks) {
    // Check global blocklist first
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
          await CodeValidator.validateTypeScript(proposedContent);
        } else if (filepath.endsWith('.prisma')) {
          await CodeValidator.validatePrismaSchema(filepath, proposedContent);
        }

        // 3. Commit the change if all validations pass
        await fs.mkdir(path.dirname(filepath), { recursive: true });
        await fs.writeFile(filepath, proposedContent, 'utf-8');
        console.log(`>KERNEL: Successfully committed and validated ${filepath}`);
        
      } else if (block.type === BlockType.CMD) {
        console.log(`>KERNEL: Executing CMD: ${block.content}`);
        const { stdout, stderr } = await execAsync(block.content);
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
      } else if (block.type === BlockType.TS) {
        console.log(`>KERNEL: Executing TS block...`);
        await fs.writeFile(TEMP_TS_FILE, block.content, 'utf-8');
        try {
          const { stdout, stderr } = await execAsync(`npx tsx ${TEMP_TS_FILE}`);
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
        } finally {
          await fs.unlink(TEMP_TS_FILE).catch(() => {});
        }
      }

    } catch (err: any) {
      // CRITICAL: Graceful degradation and feedback loop
      console.error(`>KERNEL_INTERCEPT: ${err.message}`);
      
      // Write the error back to the active state or an error log so the Auditor reads it on the next tick
      const errorReport = `\n>AUDIT_ALERT: Operation on ${block.writeDetails?.filepath || block.patchDetails?.filepath || 'Command'} failed.\n\`\`\`text\n${err.message}\n\`\`\`\n`;
      await fs.appendFile('ACTIVE_STATE.md', errorReport, 'utf-8');
      
      return; // Halt this batch, let the swarm read the error and try again
    }
  }
}

// Main Entry Point
async function main() {
  console.log(`Starting Resilient EVAIX Kernel. Watching ${ACTIVE_STATE_FILE}...`);

  const watcher = chokidar.watch(ACTIVE_STATE_FILE, { 
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000, // Wait 1 second after the last write to ensure the LLM is done
      pollInterval: 250
    }
  });

  watcher.on('change', async () => {
    try {
      const content = await fs.readFile(ACTIVE_STATE_FILE, 'utf-8');
      if (!content.trim()) return;

      const blocks = await parseActiveState(content);
      if (blocks.length > 0) {
        console.log(`>KERNEL: Detected ${blocks.length} blocks. Executing...`);
        await executeBlocks(blocks);
      }
    } catch (err) {
      console.error(`>KERNEL_WATCH_ERROR: ${err}`);
    }
  });
}

main().catch(console.error);