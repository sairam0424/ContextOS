import { execSync } from "node:child_process";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const indexPath = path.join(workspaceRoot, ".context-index.json");
const cliPath = path.join(workspaceRoot, "workspace-cli", "dist", "index.js");

async function runBenchmark() {
    console.log("🚀 Starting Performance Benchmark: Smart Incremental Indexing");

    // 1. Initial State: Full Sync (Force)
    console.log("⏳ Running Full Sync (--force)...");
    const startFull = Date.now();
    execSync(`node ${cliPath} sync --force`, { cwd: workspaceRoot });
    const fullDuration = Date.now() - startFull;
    console.log(`✅ Full Sync Complete: ${fullDuration}ms`);

    // 2. Incremental State: No changes
    console.log("⏳ Running Incremental Sync (No changes)...");
    const startIncr = Date.now();
    execSync(`node ${cliPath} sync`, { cwd: workspaceRoot });
    const incrDuration = Date.now() - startIncr;
    console.log(`✅ Incremental Sync Complete: ${incrDuration}ms`);

    // 3. Analysis
    const ratio = (incrDuration / fullDuration) * 100;
    console.log(`\n📊 Performance Gain: ${ratio.toFixed(2)}% of full sync time`);

    if (incrDuration < fullDuration * 0.5) {
        console.log("✨ SUCCESS: Incremental indexing is significantly faster!");
    } else {
        console.warn("⚠️  WARNING: Incremental indexing speedup is lower than expected.");
    }

    if (incrDuration > 1000) {
       console.warn("⚠️  WARNING: Incremental sync took > 1s. This might be a regression.");
    }
}

runBenchmark().catch(console.error);
