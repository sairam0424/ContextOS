import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createConnection,
  initializeSchema,
  migrateSchema,
  CapabilityTokenService,
  PolicyEngine,
  TrustEngine,
  WorkspaceEventBus,
  type RawDB,
} from "@context-os/core";
import { captureToolRegistrations } from "../tool-integrity.js";
import { callTool } from "./dispatch-harness.js";
import {
  installEnforcement,
  createGovernanceGate,
  currentMode,
  currentPrincipal,
  toolResourceId,
  TOOL_ACTIONS,
  RESOURCE_ACTIONS,
  ANONYMOUS_PRINCIPAL,
  ENFORCE_ENV_VAR,
  PRINCIPAL_ENV_VAR,
  type Denial,
  type DenialSink,
  type PolicyGate,
  type ToolAction,
} from "../enforcement.js";

// Every register* function, so the tool list under test is derived from the
// CODE rather than from `mcp.json` (stale at 17) or a hand-copied literal.
import { registerReadTool } from "../tools/read.js";
import { registerWriteTool } from "../tools/write.js";
import { registerSearchTool } from "../tools/search.js";
import { registerContextTool } from "../tools/context.js";
import { registerDecisionTool } from "../tools/decision.js";
import { registerMemoryTool } from "../tools/memory.js";
import { registerDailyTool } from "../tools/daily.js";
import { registerSamplingTool } from "../tools/sampling.js";
import { registerValidateTool } from "../tools/validate.js";
import { registerLockTools } from "../tools/lock.js";
import { registerPruneTool } from "../tools/prune.js";
import { registerPulseTool } from "../tools/pulse.js";
import { registerMissionTool } from "../tools/mission.js";
import { registerGraphQueryTool } from "../tools/graph-query.js";
import { registerWorkspaceNotifyTool } from "../tools/workspace-notify.js";
import { registerCognitiveTools } from "../tools/cognitive.js";
import { registerTemporalGraphTools } from "../tools/temporal-graph.js";
import { registerSwarmTools } from "../tools/swarm.js";
import { registerGovernanceTools } from "../tools/governance.js";
import { registerIntelligenceStreamTools } from "../tools/intelligence-stream.js";
import { registerPredictiveTools } from "../tools/predictive.js";
import { registerBrowseTool } from "../tools/browse.js";
import { registerResources } from "../resources.js";

/**
 * Trust-boundary tests (Phase 2 Task 2.1).
 *
 * The defect these pin: no capability token or policy verdict was consulted
 * before ANY tool ran. A live stdio session with no credentials could
 * `workspace_write`, while `governance_evaluate_policy` — asked separately —
 * correctly answered `{"allowed":false,"effect":"deny"}`. The verdict was
 * discarded because nothing asked for it.
 */

/** All 22 register* entry points, exactly as `server.ts` calls them. */
const REGISTRARS: ReadonlyArray<(server: McpServer) => void> = Object.freeze([
  registerReadTool,
  registerWriteTool,
  registerSearchTool,
  registerContextTool,
  registerDecisionTool,
  registerMemoryTool,
  registerDailyTool,
  registerSamplingTool,
  registerValidateTool,
  registerLockTools,
  registerPruneTool,
  registerPulseTool,
  registerMissionTool,
  registerGraphQueryTool,
  registerWorkspaceNotifyTool,
  registerCognitiveTools,
  registerTemporalGraphTools,
  registerSwarmTools,
  registerGovernanceTools,
  registerIntelligenceStreamTools,
  registerPredictiveTools,
  registerBrowseTool,
]);

function newServer(): McpServer {
  return new McpServer({ name: "enforcement-test", version: "0.0.0" });
}

/** Names actually registered on the SDK server, read from its own registry. */
function liveToolNames(): readonly string[] {
  const server = newServer();
  for (const register of REGISTRARS) register(server);
  const registry = (
    server as unknown as { _registeredTools: Record<string, unknown> }
  )._registeredTools;
  return Object.keys(registry).sort();
}

/**
 * Resource names actually registered by `registerResources()`, read from the
 * SDK's own registries — the static ones are keyed by URI with the name inside,
 * the templates are keyed by name.
 */
function liveResourceNames(): readonly string[] {
  const server = newServer();
  registerResources(server);
  const registries = server as unknown as {
    _registeredResources: Record<string, { name: string }>;
    _registeredResourceTemplates: Record<string, unknown>;
  };
  return [
    ...Object.values(registries._registeredResources).map((r) => r.name),
    ...Object.keys(registries._registeredResourceTemplates),
  ].sort();
}

/**
 * Invoke a tool the way a CLIENT does: through the dispatch layer.
 *
 * Deliberately NOT `_registeredTools[name].handler(...)`. The gate now lives on
 * JSON-RPC dispatch, so calling a registered handler directly tests in-process
 * code — which was never inside the trust boundary, since in-process code can
 * write files itself. See `dispatch-harness.ts`.
 */
async function invoke(
  server: McpServer,
  name: string,
  args: unknown = {},
): Promise<any> {
  const registry = (
    server as unknown as { _registeredTools: Record<string, unknown> }
  )._registeredTools;
  assert.ok(registry[name] !== undefined, `tool '${name}' is not registered`);
  return await callTool(server, name, args);
}

/** A sink that only collects, so no test writes to the workspace audit log. */
function collectingSink(): { sink: DenialSink; recorded: Denial[] } {
  const recorded: Denial[] = [];
  return {
    sink: {
      record: (d) => {
        recorded.push(d);
      },
    },
    recorded,
  };
}

const ALLOW_ALL: PolicyGate = {
  evaluate: () => ({ allowed: true, reason: "test allow" }),
};
const DENY_ALL: PolicyGate = {
  evaluate: () => ({ allowed: false, reason: "no policy" }),
};

describe("MCP enforcement gate", function () {
  this.timeout(20000);

  // The mode and principal are read from the environment on every call, so the
  // surrounding value must be restored or later suites inherit it.
  let savedMode: string | undefined;
  let savedPrincipal: string | undefined;

  beforeEach(() => {
    savedMode = process.env[ENFORCE_ENV_VAR];
    savedPrincipal = process.env[PRINCIPAL_ENV_VAR];
  });

  afterEach(() => {
    if (savedMode === undefined) delete process.env[ENFORCE_ENV_VAR];
    else process.env[ENFORCE_ENV_VAR] = savedMode;
    if (savedPrincipal === undefined) delete process.env[PRINCIPAL_ENV_VAR];
    else process.env[PRINCIPAL_ENV_VAR] = savedPrincipal;
  });

  describe("tool classification", () => {
    it("classifies every live tool as read or write, with no stale entries", () => {
      const live = liveToolNames();
      const mapped = Object.keys(TOOL_ACTIONS).sort();

      const unclassified = live.filter((n) => !(n in TOOL_ACTIONS));
      assert.deepStrictEqual(
        unclassified,
        [],
        `these registered tools are missing from TOOL_ACTIONS (they would default to 'write'): ${unclassified.join(", ")}`,
      );

      const stale = mapped.filter((n) => !live.includes(n));
      assert.deepStrictEqual(
        stale,
        [],
        `TOOL_ACTIONS names tools that are not registered anywhere: ${stale.join(", ")}`,
      );
    });

    it("pins the live tool count at 39 (mcp.json's 17 is stale)", () => {
      assert.strictEqual(liveToolNames().length, 39);
      assert.strictEqual(Object.keys(TOOL_ACTIONS).length, 39);
    });

    it("uses only 'read' or 'write' as the action, and is frozen", () => {
      for (const [name, action] of Object.entries(TOOL_ACTIONS)) {
        assert.ok(
          action === "read" || action === "write",
          `${name} has action '${action}'`,
        );
      }
      assert.ok(Object.isFrozen(TOOL_ACTIONS));
    });

    it("classifies the obviously-mutating tools as write", () => {
      const mustBeWrite = [
        "workspace_write",
        "workspace_prune",
        "workspace_memory_update",
        "workspace_log_decision",
        "governance_issue_token",
        "swarm_spawn",
      ];
      for (const name of mustBeWrite) {
        assert.strictEqual(
          TOOL_ACTIONS[name],
          "write",
          `${name} must be classified write`,
        );
      }
    });
  });

  describe("resource classification", () => {
    /**
     * The counterpart `TOOL_ACTIONS` has had since Phase 2 and `RESOURCE_ACTIONS`
     * did not. Without it, adding a resource to `registerResources()` silently
     * fails closed to `write` — correct but invisible — and DELETING one leaves a
     * stale entry that reads as coverage the server no longer has. Both
     * directions, derived from the live registrations, exactly like tools.
     */
    it("classifies every live resource, with no stale entries", () => {
      const live = liveResourceNames();
      assert.ok(
        live.length > 0,
        "registerResources() registered nothing — the derivation has gone stale",
      );

      const unclassified = live.filter((n) => !(n in RESOURCE_ACTIONS));
      assert.deepStrictEqual(
        unclassified,
        [],
        `these registered resources are missing from RESOURCE_ACTIONS (they would default to 'write'): ${unclassified.join(", ")}`,
      );

      const stale = Object.keys(RESOURCE_ACTIONS)
        .sort()
        .filter((n) => !live.includes(n));
      assert.deepStrictEqual(
        stale,
        [],
        `RESOURCE_ACTIONS names resources that are not registered anywhere: ${stale.join(", ")}`,
      );
    });

    it("pins the live resource count at 2 (one static, one template)", () => {
      assert.strictEqual(liveResourceNames().length, 2);
      assert.strictEqual(Object.keys(RESOURCE_ACTIONS).length, 2);
    });

    it("uses only 'read' or 'write' as the action, and is frozen", () => {
      for (const [name, action] of Object.entries(RESOURCE_ACTIONS)) {
        assert.ok(
          action === "read" || action === "write",
          `${name} has action '${action}'`,
        );
      }
      assert.ok(Object.isFrozen(RESOURCE_ACTIONS));
    });

    it("keys the map by registered NAME, never by URI", () => {
      // `resources/read` arrives with a URI, and the gate resolves it back to the
      // name. A URI key would never match and every read would fail closed.
      for (const name of Object.keys(RESOURCE_ACTIONS)) {
        assert.ok(
          !name.includes("://"),
          `${name} looks like a URI; RESOURCE_ACTIONS is keyed by name`,
        );
      }
    });
  });

  describe("mode and principal resolution", () => {
    it("defaults to warn when unset, and only the literal 'deny' enables blocking", () => {
      delete process.env[ENFORCE_ENV_VAR];
      assert.strictEqual(currentMode(), "warn");
      process.env[ENFORCE_ENV_VAR] = "warn";
      assert.strictEqual(currentMode(), "warn");
      process.env[ENFORCE_ENV_VAR] = "deny";
      assert.strictEqual(currentMode(), "deny");
      // A typo must not silently become enforcement (nor be treated as 'off').
      process.env[ENFORCE_ENV_VAR] = "DENY";
      assert.strictEqual(currentMode(), "warn");
    });

    it("treats an unnamed caller as the anonymous principal", () => {
      delete process.env[PRINCIPAL_ENV_VAR];
      assert.strictEqual(currentPrincipal(), ANONYMOUS_PRINCIPAL);
      process.env[PRINCIPAL_ENV_VAR] = "   ";
      assert.strictEqual(currentPrincipal(), ANONYMOUS_PRINCIPAL);
      process.env[PRINCIPAL_ENV_VAR] = " agent-7 ";
      assert.strictEqual(currentPrincipal(), "agent-7");
    });
  });

  describe("warn mode (audit-only)", () => {
    it("allows a denied call to proceed but records the denial", async () => {
      process.env[ENFORCE_ENV_VAR] = "warn";
      const server = newServer();
      const { sink, recorded } = collectingSink();
      const denials = installEnforcement(server, DENY_ALL, sink);

      let ran = false;
      server.tool("workspace_write", {}, async () => {
        ran = true;
        return { content: [] };
      });
      const res = await invoke(server, "workspace_write");

      assert.strictEqual(ran, true, "warn mode must not block the call");
      assert.notStrictEqual(
        res.isError,
        true,
        "warn mode must not report an error",
      );
      assert.strictEqual(denials.length, 1);
      assert.strictEqual(denials[0].enforced, false);
      assert.strictEqual(denials[0].mode, "warn");
      assert.strictEqual(denials[0].tool, "workspace_write");
      assert.strictEqual(denials[0].action, "write");
      assert.match(denials[0].reason, /no policy/);
      // The whole value of warn mode is the record surviving somewhere durable.
      assert.deepStrictEqual(
        recorded,
        denials,
        "the denial must reach the sink, not just the array",
      );
    });

    it("records a denial per call, not just the first", async () => {
      process.env[ENFORCE_ENV_VAR] = "warn";
      const server = newServer();
      const { sink, recorded } = collectingSink();
      installEnforcement(server, DENY_ALL, sink);
      server.tool("workspace_write", {}, async () => ({ content: [] }));

      await invoke(server, "workspace_write");
      await invoke(server, "workspace_write");
      assert.strictEqual(recorded.length, 2);
    });
  });

  describe("deny mode", () => {
    it("blocks the call and returns isError without running the handler", async () => {
      process.env[ENFORCE_ENV_VAR] = "deny";
      const server = newServer();
      const { sink, recorded } = collectingSink();
      const denials = installEnforcement(server, DENY_ALL, sink);

      let ran = false;
      server.tool("workspace_write", {}, async () => {
        ran = true;
        return { content: [] };
      });
      const res = await invoke(server, "workspace_write");

      assert.strictEqual(ran, false, "deny mode must not run the handler");
      assert.strictEqual(res.isError, true);
      assert.match(res.content[0].text, /PERMISSION_DENIED/);
      assert.match(res.content[0].text, /Denied by policy/);
      assert.strictEqual(denials.length, 1);
      assert.strictEqual(denials[0].enforced, true);
      assert.strictEqual(recorded.length, 1);
    });

    it("is the SAME tool and args that warn mode let through (the mode is the only variable)", async () => {
      const build = () => {
        const server = newServer();
        const { sink, recorded } = collectingSink();
        installEnforcement(server, DENY_ALL, sink);
        let ran = false;
        server.tool("workspace_write", {}, async () => {
          ran = true;
          return { content: [{ type: "text" as const, text: "wrote" }] };
        });
        return { server, recorded, ranRef: () => ran };
      };

      process.env[ENFORCE_ENV_VAR] = "warn";
      const warned = build();
      const warnRes = await invoke(warned.server, "workspace_write", {
        path: "projects/x.md",
      });
      assert.strictEqual(warned.ranRef(), true);
      assert.notStrictEqual(warnRes.isError, true);

      process.env[ENFORCE_ENV_VAR] = "deny";
      const denied = build();
      const denyRes = await invoke(denied.server, "workspace_write", {
        path: "projects/x.md",
      });
      assert.strictEqual(denied.ranRef(), false);
      assert.strictEqual(denyRes.isError, true);
    });
  });

  describe("allowed calls", () => {
    it("passes args and extra through untouched and records nothing", async () => {
      process.env[ENFORCE_ENV_VAR] = "deny";
      const server = newServer();
      const { sink, recorded } = collectingSink();
      const denials = installEnforcement(server, ALLOW_ALL, sink);

      let seenArgs: unknown = null;
      let sawExtra = false;
      // The schema is declared because the args now travel the real dispatch
      // path, where `validateToolInput` strips anything the tool did not declare
      // — an argument the gate "passed through" but the SDK dropped would be a
      // false pass.
      server.tool(
        "workspace_read",
        { path: z.string() },
        async (args: unknown, extra: unknown) => {
          seenArgs = args;
          sawExtra = extra !== undefined;
          return { content: [{ type: "text" as const, text: "ok" }] };
        },
      );

      const res = await invoke(server, "workspace_read", {
        path: "projects/a.md",
      });
      assert.deepStrictEqual(seenArgs, { path: "projects/a.md" });
      assert.strictEqual(
        sawExtra,
        true,
        "the SDK's `extra` argument must survive the wrapper",
      );
      assert.strictEqual(res.content[0].text, "ok");
      assert.strictEqual(denials.length, 0);
      assert.strictEqual(recorded.length, 0);
    });
  });

  describe("fail-closed defaults", () => {
    it("treats an unclassified tool as write", async () => {
      process.env[ENFORCE_ENV_VAR] = "warn";
      const server = newServer();
      const { sink } = collectingSink();
      const seen: ToolAction[] = [];
      const spy: PolicyGate = {
        evaluate: (_name, action) => {
          seen.push(action);
          return { allowed: false, reason: "spy" };
        },
      };
      installEnforcement(server, spy, sink);

      assert.ok(
        !("brand_new_untriaged_tool" in TOOL_ACTIONS),
        "fixture must be genuinely unmapped",
      );
      server.tool("brand_new_untriaged_tool", {}, async () => ({
        content: [],
      }));
      await invoke(server, "brand_new_untriaged_tool");

      assert.deepStrictEqual(
        seen,
        ["write"],
        "an unlisted tool must default to write, not read",
      );
    });

    it("delegates a registration with no handler to the SDK instead of swallowing it", () => {
      const server = newServer();
      installEnforcement(server, ALLOW_ALL, collectingSink().sink);
      // `tool(name)` with no callback has nothing to gate. The wrapper must
      // still delegate verbatim — dropping the registration would silently
      // remove a tool, which is a worse failure than leaving it ungated.
      (server.tool as (n: string) => unknown)("handlerless_tool");
      const registry = (
        server as unknown as { _registeredTools: Record<string, unknown> }
      )._registeredTools;
      assert.ok(
        "handlerless_tool" in registry,
        "registration must reach the SDK",
      );
    });
  });

  describe("coexistence with the tool-integrity capture", () => {
    it("survives restore(), so a tool registered afterwards is still gated", async () => {
      process.env[ENFORCE_ENV_VAR] = "deny";
      const server = newServer();
      const { sink } = collectingSink();

      // The production order from server.ts: enforcement first, capture second.
      installEnforcement(server, DENY_ALL, sink);
      const { restore } = captureToolRegistrations(server);
      server.tool("workspace_read", {}, async () => ({ content: [] }));
      restore();

      // Registered AFTER restore() — the gate must still be in place.
      let ran = false;
      server.tool("workspace_write", {}, async () => {
        ran = true;
        return { content: [] };
      });
      const res = await invoke(server, "workspace_write");

      assert.strictEqual(
        ran,
        false,
        "restore() must not have uninstalled the gate",
      );
      assert.strictEqual(res.isError, true);
    });

    it("survives even the REVERSED order, because the anchor is the dispatch layer", async () => {
      process.env[ENFORCE_ENV_VAR] = "deny";
      const server = newServer();
      const { sink } = collectingSink();

      // Capture first, enforcement second. When the gate replaced `server.tool`
      // this order was fatal — `restore()` put back the pre-enforcement method
      // and silently uninstalled the trust boundary. The gate now lives on the
      // underlying Server's request-dispatch table, which
      // `captureToolRegistrations` neither sees nor restores, so the ordering is
      // no longer load-bearing. This test is what would catch a regression back
      // to wrapping a registration API.
      const { restore } = captureToolRegistrations(server);
      installEnforcement(server, DENY_ALL, sink);
      restore();

      let ran = false;
      server.tool("workspace_write", {}, async () => {
        ran = true;
        return { content: [] };
      });
      const res = await invoke(server, "workspace_write");

      assert.strictEqual(
        ran,
        false,
        "restore() must not be able to uninstall the gate in ANY order",
      );
      assert.strictEqual(res.isError, true);
    });
  });

  describe("server.ts wiring", () => {
    /**
     * A source-text guard, deliberately. The behavioural version would have to
     * call `createMcpServer()`, and that runs the boot-time tool-integrity check
     * which appends to the LIVE workspace audit log — test pollution this repo
     * is already trying to get rid of. So the end-to-end proof is a live stdio
     * probe run by hand, and what the suite pins is the three wiring properties
     * that probe cannot regression-test: the gate is installed, it is installed
     * BEFORE the integrity capture, and `restore()` therefore cannot remove it.
     */
    let source: string;

    before(async () => {
      const serverJs = new URL("../server.js", import.meta.url);
      const raw = await fs.promises.readFile(serverJs, "utf-8");
      // Strip `//` comments: tsc preserves them, and the comments here discuss
      // `restore()` and `captureToolRegistrations` by name, which would make an
      // ordering assertion match prose instead of code.
      source = raw
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
    });

    it("installs the enforcement gate exactly once", () => {
      const matches = source.match(/installEnforcement\(/g) ?? [];
      assert.strictEqual(
        matches.length,
        1,
        "server.ts must install the gate exactly once",
      );
      assert.match(
        source,
        /installEnforcement\(server,\s*createGovernanceGate\(\)\)/,
      );
    });

    it("installs the gate BEFORE captureToolRegistrations so restore() cannot remove it", () => {
      const installAt = source.indexOf("installEnforcement(");
      const captureAt = source.indexOf("captureToolRegistrations(");
      const restoreAt = source.indexOf("restore()");
      assert.ok(
        installAt >= 0 && captureAt >= 0 && restoreAt >= 0,
        "all three call sites must exist",
      );
      assert.ok(
        installAt < captureAt,
        "enforcement should still be installed first so the capture is the OUTERMOST wrapper and " +
          "restore() tears down only itself. The gate no longer depends on this (it anchors at the " +
          "SDK's _createRegistered* chokepoint), but the layering is the reviewable order",
      );
      assert.ok(
        restoreAt > captureAt,
        "restore() must come after the capture it undoes",
      );
    });

    it("advertises the logging capability so denial records can reach a client", () => {
      assert.match(source, /capabilities:\s*\{\s*logging:\s*\{\s*\}\s*\}/);
    });

    it("runs the boot-time classification audit AFTER every registrar", () => {
      // The audit answers "is anything unclassified?" from the SDK's registries,
      // so running it before the last registrar would report a partial answer as
      // a clean bill of health.
      const auditAt = source.indexOf("auditClassificationCoverage(server)");
      const lastRegistrar = Math.max(
        source.lastIndexOf("registerPredictiveTools(server)"),
        source.lastIndexOf("registerResources(server)"),
        source.lastIndexOf("registerPrompts(server)"),
      );
      assert.ok(
        auditAt >= 0,
        "server.ts must run the boot-time classification audit",
      );
      assert.ok(lastRegistrar >= 0, "the registrar call sites must exist");
      assert.ok(
        auditAt > lastRegistrar,
        "the audit must run after the last registrar, or it sees a partial server",
      );
    });

    it("no longer registers the dead roots/list handler", () => {
      assert.ok(
        !source.includes("registerRoots"),
        "roots.ts was deleted; server.ts must not reference it",
      );
    });
  });

  describe("createGovernanceGate (policy AND capability)", () => {
    let db: RawDB;
    let dir: string;
    let gate: PolicyGate;
    let tokens: CapabilityTokenService;

    beforeEach(() => {
      process.env.CONTEXTOS_TOKEN_HMAC_KEY = "enforcement-test-key";
      dir = fs.mkdtempSync(
        path.join(os.tmpdir(), "contextos-mcp-enforcement-"),
      );
      db = createConnection(path.join(dir, "test.db"));
      initializeSchema(db);
      migrateSchema(db);
      const bus = new WorkspaceEventBus();
      tokens = new CapabilityTokenService(db, bus);
      gate = createGovernanceGate({
        policy: new PolicyEngine(db, new TrustEngine(db, bus)),
        tokens,
      });
    });

    afterEach(() => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("denies an anonymous caller with no policy and no token (default-DENY)", () => {
      delete process.env[PRINCIPAL_ENV_VAR];
      const verdict = gate.evaluate("workspace_write", "write", {});
      assert.strictEqual(verdict.allowed, false);
      assert.match(
        verdict.reason,
        /^policy\(deny\)/,
        "the policy layer must be what rejects first",
      );
    });

    it("still denies when policy allows but no capability token grants the action", () => {
      process.env[PRINCIPAL_ENV_VAR] = "agent-alpha";
      const policy = new PolicyEngine(
        db,
        new TrustEngine(db, new WorkspaceEventBus()),
      );
      policy.addPolicy({
        name: "allow-all-mcp-tools",
        rules: [
          {
            condition: { type: "resource_matches", pattern: "mcp:tool:*" },
            effect: "allow",
          },
        ],
      });
      const bothRequired = createGovernanceGate({ policy, tokens });

      const verdict = bothRequired.evaluate("workspace_write", "write", {});
      assert.strictEqual(
        verdict.allowed,
        false,
        "policy alone must not be sufficient",
      );
      assert.match(
        verdict.reason,
        /^capability:/,
        "the capability layer must be what rejects",
      );
    });

    it("allows only when policy AND a capability token both permit", () => {
      process.env[PRINCIPAL_ENV_VAR] = "agent-alpha";
      const policy = new PolicyEngine(
        db,
        new TrustEngine(db, new WorkspaceEventBus()),
      );
      policy.addPolicy({
        name: "allow-all-mcp-tools",
        rules: [
          {
            condition: { type: "resource_matches", pattern: "mcp:tool:*" },
            effect: "allow",
          },
        ],
      });
      tokens.issue({
        agentId: "agent-alpha",
        issuedBy: "test-operator",
        capabilities: [
          { resource: toolResourceId("workspace_write"), actions: ["write"] },
        ],
      });
      const bothRequired = createGovernanceGate({ policy, tokens });

      assert.strictEqual(
        bothRequired.evaluate("workspace_write", "write", {}).allowed,
        true,
      );
      // Same principal, same policy, but the token grants no 'read' on this
      // resource — so the capability layer is genuinely being consulted.
      assert.strictEqual(
        bothRequired.evaluate("workspace_write", "read", {}).allowed,
        false,
      );
      // And a different tool is outside the grant.
      assert.strictEqual(
        bothRequired.evaluate("workspace_prune", "write", {}).allowed,
        false,
      );
    });

    it("denies (never allows) when the decision point itself throws", () => {
      db.close();
      const verdict = gate.evaluate("workspace_write", "write", {});
      assert.strictEqual(verdict.allowed, false);
      assert.match(verdict.reason, /fail-closed/);
    });
  });
});
