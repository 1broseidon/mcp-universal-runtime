#!/usr/bin/env node

/**
 * Simple test MCP server for stdio transport
 * This is a minimal MCP server to test our universal runtime
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create MCP server
const server = new McpServer({
  name: "test-server",
  version: "1.0.0"
});

// Add a simple tool
server.registerTool("echo", {
  title: "Echo Tool",
  description: "Echoes back the input message",
  inputSchema: {
    message: z.string().describe("Message to echo back")
  }
}, async ({ message }) => {
  return {
    content: [
      {
        type: "text",
        text: `Echo: ${message}`
      }
    ]
  };
});

// Add a resource
server.registerResource("info://test", {
  title: "Test Resource",
  description: "A test resource for MCP runtime testing"
}, async () => ({
  contents: [{
    uri: "info://test",
    mimeType: "text/plain", 
    text: "This is a test resource from the MCP test server"
  }]
}));

// Run the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Test MCP Server running on stdio");
}