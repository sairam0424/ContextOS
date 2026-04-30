import assert from "node:assert";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTool } from "../tools/search.js";
import { registerWriteTool } from "../tools/write.js";

describe("MCP Interface Layer (Registration Tests)", () => {
    let server: McpServer;

    beforeEach(() => {
        server = new McpServer({
            name: "test-server",
            version: "1.0.0"
        });
    });

    it("should register search tools without error", () => {
        assert.doesNotThrow(() => {
            registerSearchTool(server);
        });
    });

    it("should register write tools without error", () => {
        assert.doesNotThrow(() => {
            registerWriteTool(server);
        });
    });
});
