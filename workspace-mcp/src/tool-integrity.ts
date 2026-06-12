import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getSharedDatabase, AuditLog } from "@context-os/core";
import type { AuditEntry } from "@context-os/core";
import { logToClient } from "./logging.js";

/**
 * Tool-definition hash pinning + boot-time drift detection (OWASP MCP03 —
 * "rug-pull" / tool-poisoning). Defense-in-depth, opportunity #40.
 *
 * A compromised dependency can silently register new tools or rewrite the
 * description / input schema of an existing tool to redirect agent behavior.
 * We pin a SHA-256 over each tool's (name + description + input schema) and a
 * combined tool-set hash, record it in the Merkle audit log at startup, and
 * compare against the last recorded snapshot. Drift is ALERTED, never crashed —
 * a wrong drift signal must not be able to take the server down.
 */

const AUDIT_AGENT_ID = "mcp-server";
const AUDIT_ACTION = "tool_integrity.snapshot";

/** Metadata captured for a single registered tool. */
export interface CapturedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

/** Per-tool and combined hashes for an immutable snapshot of the tool set. */
export interface ToolIntegritySnapshot {
  readonly toolSetHash: string;
  readonly toolCount: number;
  /** Map of tool name -> per-tool SHA-256, sorted by name. */
  readonly toolHashes: Readonly<Record<string, string>>;
}

/** Result of the boot-time drift comparison. */
export interface DriftReport {
  readonly drift: boolean;
  readonly current: ToolIntegritySnapshot;
  readonly previousHash: string | null;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

/**
 * Recursively sort object keys so semantically-identical schemas serialize to
 * an identical string regardless of property insertion order. Pure — every
 * branch returns a freshly-built value and never mutates the input.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Wrap `server.tool` so every registration is captured (name + description +
 * input schema) without reaching into SDK-private state. Returns the live
 * capture array plus a `restore()` that puts the original method back.
 *
 * Immutability: the original method is preserved and re-bound; the wrapper only
 * appends a frozen record to a local array and otherwise delegates verbatim.
 */
export function captureToolRegistrations(server: McpServer): {
  captured: CapturedTool[];
  restore: () => void;
} {
  const captured: CapturedTool[] = [];
  const original = server.tool.bind(server);

  // The SDK `tool()` is heavily overloaded: (name, cb) | (name, desc, cb) |
  // (name, schemaOrAnnotations, cb) | (name, desc, schema, cb) | ... . We sniff
  // positionally for the description string and the Zod raw-shape schema, then
  // always delegate the untouched args to the real implementation.
  const wrapped = (name: string, ...rest: unknown[]): unknown => {
    let description = "";
    let schemaShape: Record<string, unknown> | undefined;

    for (const arg of rest) {
      if (typeof arg === "string" && description === "") {
        description = arg;
        continue;
      }
      // A Zod raw shape is a plain object whose values are ZodType instances
      // (they expose a `safeParse` method). Annotations objects do not.
      if (
        schemaShape === undefined &&
        arg !== null &&
        typeof arg === "object" &&
        !Array.isArray(arg) &&
        typeof arg !== "function"
      ) {
        const values = Object.values(arg as Record<string, unknown>);
        const looksLikeZodShape =
          values.length > 0 &&
          values.every(
            (v) => v !== null && typeof v === "object" && typeof (v as { safeParse?: unknown }).safeParse === "function",
          );
        if (looksLikeZodShape) {
          schemaShape = arg as Record<string, unknown>;
        }
      }
    }

    captured.push(
      Object.freeze({
        name,
        description,
        inputSchema: schemaShape ? serializeShape(schemaShape) : null,
      }),
    );

    return (original as (...a: unknown[]) => unknown)(name, ...rest);
  };

  // Replace the bound method on the instance only; the prototype is untouched.
  (server as unknown as { tool: unknown }).tool = wrapped;

  const restore = () => {
    (server as unknown as { tool: unknown }).tool = original;
  };

  return { captured, restore };
}

/**
 * Convert a Zod raw shape into a stable JSON-schema-ish representation. Failures
 * degrade to the sorted key list rather than throwing — a serialization quirk
 * must never block the integrity check.
 */
function serializeShape(shape: Record<string, unknown>): unknown {
  try {
    const properties: Record<string, unknown> = {};
    for (const key of Object.keys(shape).sort()) {
      // Each value is a ZodType; zodToJsonSchema gives a deterministic shape.
      properties[key] = zodToJsonSchema(shape[key] as never, { $refStrategy: "none" });
    }
    return { type: "object", properties };
  } catch {
    return { type: "object", keys: Object.keys(shape).sort() };
  }
}

/** Compute the immutable per-tool and combined tool-set hashes. */
export function computeSnapshot(tools: readonly CapturedTool[]): ToolIntegritySnapshot {
  const toolHashes: Record<string, string> = {};
  for (const tool of tools) {
    const material = [tool.name, tool.description ?? "", stableStringify(tool.inputSchema)].join("\n");
    toolHashes[tool.name] = sha256(material);
  }

  // Combined hash is order-independent: sort by name before folding.
  const sortedNames = Object.keys(toolHashes).sort();
  const combinedMaterial = sortedNames.map((n) => `${n}:${toolHashes[n]}`).join("\n");
  const sortedHashes = sortedNames.reduce<Record<string, string>>((acc, n) => {
    acc[n] = toolHashes[n];
    return acc;
  }, {});

  return {
    toolSetHash: sha256(combinedMaterial),
    toolCount: sortedNames.length,
    toolHashes: Object.freeze(sortedHashes),
  };
}

/** Read the most recent prior snapshot's per-tool hashes from the audit log. */
function loadPreviousHashes(auditLog: AuditLog): { toolSetHash: string; toolHashes: Record<string, string> } | null {
  const prior: AuditEntry[] = auditLog.getForAgent(AUDIT_AGENT_ID, 50);
  const lastSnapshot = prior.find((e) => e.action === AUDIT_ACTION);
  if (!lastSnapshot) return null;

  const detail = lastSnapshot.detail as Record<string, unknown>;
  const toolSetHash = typeof detail.toolSetHash === "string" ? detail.toolSetHash : "";
  const rawHashes = detail.toolHashes;
  const toolHashes: Record<string, string> = {};
  if (rawHashes && typeof rawHashes === "object") {
    for (const [name, hash] of Object.entries(rawHashes as Record<string, unknown>)) {
      if (typeof hash === "string") toolHashes[name] = hash;
    }
  }
  return { toolSetHash, toolHashes };
}

/** Diff current vs previous per-tool hashes into added/removed/changed names. */
function diffTools(
  current: Readonly<Record<string, string>>,
  previous: Record<string, string>,
): { added: string[]; removed: string[]; changed: string[] } {
  const added = Object.keys(current).filter((n) => !(n in previous)).sort();
  const removed = Object.keys(previous).filter((n) => !(n in current)).sort();
  const changed = Object.keys(current)
    .filter((n) => n in previous && current[n] !== previous[n])
    .sort();
  return { added, removed, changed };
}

/**
 * Run the full boot-time integrity check: compute the current snapshot, append
 * it to the Merkle audit log, compare against the last recorded snapshot, and
 * emit a structured alert on drift. Always resolves — any failure is logged and
 * swallowed so this defense-in-depth check can never block server startup.
 */
export function runToolIntegrityCheck(tools: readonly CapturedTool[]): DriftReport | null {
  const current = computeSnapshot(tools);

  try {
    const db = getSharedDatabase();
    const auditLog = new AuditLog(db.getRawDb());

    const previous = loadPreviousHashes(auditLog);
    const diff = previous
      ? diffTools(current.toolHashes, previous.toolHashes)
      : { added: [], removed: [], changed: [] };
    const drift = previous !== null && previous.toolSetHash !== current.toolSetHash;

    // Record this boot's snapshot into the Merkle chain regardless of drift, so
    // the next boot has a fresh, tamper-evident baseline to compare against.
    auditLog.append(AUDIT_AGENT_ID, AUDIT_ACTION, {
      toolSetHash: current.toolSetHash,
      toolCount: current.toolCount,
      toolHashes: current.toolHashes,
      driftDetected: drift,
    });

    const report: DriftReport = Object.freeze({
      drift,
      current,
      previousHash: previous?.toolSetHash ?? null,
      added: Object.freeze(diff.added),
      removed: Object.freeze(diff.removed),
      changed: Object.freeze(diff.changed),
    });

    emitReport(report);
    return report;
  } catch (error: unknown) {
    // Audit-log unreachable (e.g. DB not provisioned). Persisting failed, but we
    // still warn with a structured record so the drift surface is observable.
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      event: "tool_integrity.audit_unavailable",
      toolSetHash: current.toolSetHash,
      toolCount: current.toolCount,
      reason: message,
    };
    console.error(`[tool-integrity] ${JSON.stringify(payload)}`);
    logToClient("warning", payload);
    return null;
  }
}

/** Emit a structured boot record (info on baseline/clean, warning on drift). */
function emitReport(report: DriftReport): void {
  if (report.drift) {
    const payload = {
      event: "tool_integrity.drift_detected",
      severity: "alert",
      owasp: "MCP03",
      message:
        "Tool-set definition hash changed since last startup. A dependency may have registered or rewritten tools (rug-pull).",
      toolSetHash: report.current.toolSetHash,
      previousHash: report.previousHash,
      toolCount: report.current.toolCount,
      added: report.added,
      removed: report.removed,
      changed: report.changed,
    };
    console.error(`[tool-integrity] ALERT ${JSON.stringify(payload)}`);
    logToClient("warning", payload);
    return;
  }

  const payload = {
    event: report.previousHash === null ? "tool_integrity.baseline_recorded" : "tool_integrity.verified",
    toolSetHash: report.current.toolSetHash,
    toolCount: report.current.toolCount,
  };
  console.error(`[tool-integrity] ${JSON.stringify(payload)}`);
  logToClient("info", payload);
}
