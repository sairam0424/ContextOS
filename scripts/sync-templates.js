import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const CLI_TEMPLATES = path.resolve(ROOT, 'workspace-cli', 'templates');

const SOUCE_ROOT = path.resolve(ROOT, 'root');
const SOUCE_SCHEMAS = path.resolve(ROOT, 'packages', 'core', 'schemas');

const TARGET_ROOT = path.resolve(CLI_TEMPLATES, 'root');
const TARGET_SCHEMAS = path.resolve(CLI_TEMPLATES, 'schemas');

async function sync() {
    try {
        console.log('🔄 Syncing ContextOS assets to CLI templates (native node:fs)...');

        // Ensure targets exist
        await fs.mkdir(TARGET_ROOT, { recursive: true });
        await fs.mkdir(TARGET_SCHEMAS, { recursive: true });

        // Copy directories natively (Node 16.7+ has fs.cp)
        await fs.cp(SOUCE_ROOT, TARGET_ROOT, { recursive: true, force: true });
        await fs.cp(SOUCE_SCHEMAS, TARGET_SCHEMAS, { recursive: true, force: true });

        console.log('✅ Sync complete: root/ and schemas/ are mirrored in workspace-cli/templates/');
    } catch (err) {
        console.error('❌ Sync failed:', err);
        process.exit(1);
    }
}

sync();
