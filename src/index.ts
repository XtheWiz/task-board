#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

const server = new McpServer({
  name: "task-board",
  version: "0.3.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
