import * as chokidar from 'chokidar';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);
const ACTIVE_STATE_FILE = 'ACTIVE_STATE.md';
const TEMP_TS_FILE = 'temp_kernel_exec.ts';

const BLOCKLIST_REGEX = /(rm\s+-rf|mkfs|chmod\s+777|chown)/;

enum BlockType {
  CMD,
  TS,
  PATCH,
  WRITE
}

interface CommandBlock {
  type: BlockType;
  content: string;
  patchDetails?: {
    filepath: string;
    search: string;
    replace: string;
  };
  writeDetails?: {
    filepath: string;
  };
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
      i++; // skip ```typescript line
      while (i < lines.length && !(lines[i] as string).startsWith('```')) {
        tsContent += (lines[i] as string) + '\n';
        i++;
      }
      blocks.push({ type: BlockType.TS, content: tsContent });
      i++; // skip ``` line
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
          pLine.startsWith('>CMD:') ||
          pLine.startsWith('```') ||
          pLine.startsWith('>PATCH:') ||
          pLine.startsWith('>WRITE:') ||
          (!inSearch && !inReplace && pLine.trim() !== '')
        ) {
          // Break if next block started or if we encounter non-empty lines outside search/replace bounds
          break;
        } else {
          if (inSearch) {
            search += pLine + '\n';
          } else if (inReplace) {
            replace += pLine + '\n';
          }
          i++;
        }
      }

      // Trim trailing newline from search/replace to avoid exact match issues with extra blank lines,
      // but only if it matches how the block is structured.
      // Usually, exact match should include newlines as specified, but a single trailing newline
      // from the iteration loop might need to be stripped. Let's strip the last newline added.
      if (search.endsWith('\n')) search = search.slice(0, -1);
      if (replace.endsWith('\n')) replace = replace.slice(0, -1);

      blocks.push({
        type: BlockType.PATCH,
        content: '',
        patchDetails: { filepath, search, replace }
      });
    } else if (line.startsWith('>WRITE:')) {
      const filepath = line.substring('>WRITE:'.length).trim();
      i++; // skip >WRITE: line

      let writeContent = '';
      if (i < lines.length && (lines[i] as string).startsWith('```')) {
        i++; // skip ```lang line
        while (i < lines.length && !(lines[i] as string).startsWith('```')) {
          writeContent += (lines[i] as string) + '\n';
          i++;
        }
        if (i < lines.length && (lines[i] as string).startsWith('```')) {
            i++; // skip closing ```
        }
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

async function executeBlocks(blocks: CommandBlock[]) {
  for (const block of blocks) {
    // 1. Padded cell check
    if (block.type === BlockType.CMD) {
      if (BLOCKLIST_REGEX.test(block.content)) {
        console.log(`>KERNEL_INTERCEPT: Blocklist violation detected in command: ${block.content}`);
        return; // Halt execution of remaining batch
      }
    } else if (block.type === BlockType.TS) {
      if (BLOCKLIST_REGEX.test(block.content)) {
        console.log(`>KERNEL_INTERCEPT: Blocklist violation detected in TypeScript block`);
        return;
      }
    } else if (block.type === BlockType.PATCH) {
      if (BLOCKLIST_REGEX.test(block.patchDetails!.filepath) ||
          BLOCKLIST_REGEX.test(block.patchDetails!.search) ||
          BLOCKLIST_REGEX.test(block.patchDetails!.replace)) {
        console.log(`>KERNEL_INTERCEPT: Blocklist violation detected in PATCH block`);
        return;
      }
    } else if (block.type === BlockType.WRITE) {
      if (BLOCKLIST_REGEX.test(block.writeDetails!.filepath) ||
          BLOCKLIST_REGEX.test(block.content)) {
        console.log(`>KERNEL_INTERCEPT: Blocklist violation detected in WRITE block`);
        return;
      }
    }

    // 2. Execute block
    try {
      if (block.type === BlockType.CMD) {
        console.log(`Executing CMD: ${block.content}`);
        const { stdout, stderr } = await execAsync(block.content);
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
      } else if (block.type === BlockType.TS) {
        console.log(`Executing TypeScript block...`);
        await fs.writeFile(TEMP_TS_FILE, block.content);
        const { stdout, stderr } = await execAsync(`npx tsx ${TEMP_TS_FILE}`);
        if (stdout) console.log(stdout);
        if (stderr) console.error(stderr);
        await fs.unlink(TEMP_TS_FILE).catch(() => {});
      } else if (block.type === BlockType.PATCH) {
        console.log(`Executing PATCH on ${block.patchDetails!.filepath}...`);
        const { filepath, search, replace } = block.patchDetails!;

        try {
          const fileContent = await fs.readFile(filepath, 'utf-8');
          if (!fileContent.includes(search)) {
            console.log(`>KERNEL_INTERCEPT: Patch failed. Target string not found.`);
            return; // Halt
          }

          const updatedContent = fileContent.replace(search, replace);
          await fs.writeFile(filepath, updatedContent, 'utf-8');
          console.log(`Patch applied to ${filepath}.`);
        } catch (err: any) {
          console.log(`>KERNEL_INTERCEPT: Patch failed. Could not read/write file ${filepath}. Error: ${err.message}`);
          return; // Halt
        }
      } else if (block.type === BlockType.WRITE) {
        console.log(`Executing WRITE on ${block.writeDetails!.filepath}...`);
        const { filepath } = block.writeDetails!;

        try {
          const dir = path.dirname(filepath);
          await fs.mkdir(dir, { recursive: true });

          await fs.writeFile(filepath, block.content, 'utf-8');
          console.log(`Successfully wrote to ${filepath}.`);
        } catch (err: any) {
          console.log(`>KERNEL_INTERCEPT: Write failed. Could not write file ${filepath}. Error: ${err.message}`);
          return; // Halt
        }
      }
    } catch (err: any) {
      console.log(`>KERNEL_INTERCEPT: Execution failed. Error: ${err.message}`);
      return; // Halt execution of remaining batch
    }
  }
}

async function startKernel() {
  console.log(`Starting EVAIX Kernel. Watching ${ACTIVE_STATE_FILE} for changes...`);

  // Create file if it doesn't exist
  try {
    await fs.access(ACTIVE_STATE_FILE);
  } catch {
    await fs.writeFile(ACTIVE_STATE_FILE, '# EVAIX ACTIVE STATE\n');
  }

  const watcher = chokidar.watch(ACTIVE_STATE_FILE, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher.on('change', async (path) => {
    console.log(`\nDetected change in ${path}. Parsing...`);
    try {
      const content = await fs.readFile(path, 'utf-8');
      const blocks = await parseActiveState(content);
      if (blocks.length > 0) {
        console.log(`Found ${blocks.length} blocks to execute. Sequential execution started...`);
        await executeBlocks(blocks);
        console.log(`Batch execution complete.`);
      }
    } catch (error: any) {
      console.error(`>KERNEL_INTERCEPT: Failed to process file change: ${error.message}`);
    }
  });
}

startKernel().catch(console.error);
