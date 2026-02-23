// ─────────────────────────────────────────────────────────────────────────────
// Import the libraries we installed
// ─────────────────────────────────────────────────────────────────────────────
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Create the Express web server
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// Create the MCP Server
// ─────────────────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "support-mcp-server",
  version: "1.0.0"
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared mock data — used by both MCP tools and the direct /tool endpoint
// ─────────────────────────────────────────────────────────────────────────────
const mockAnswers = {
  billing:   "For billing issues, please visit billing.company.com or call 1-800-BILLING. Our billing team is available Mon-Fri 9am-5pm EST.",
  technical: "For technical issues: (1) Restart the application. (2) Clear your browser cache. (3) If the issue persists, uninstall and reinstall the app.",
  account:   "To reset your account: Go to Settings → Security → Reset Account. You will receive an email within 5 minutes.",
  general:   "For general inquiries, please contact support@company.com. We aim to respond within 24 hours.",
};

const mockCustomers = {
  "C001": { name: "Alice Johnson", plan: "Premium", memberSince: "2021-03-15", openTickets: 2 },
  "C002": { name: "Bob Smith",     plan: "Basic",   memberSince: "2023-07-01", openTickets: 0 },
  "C003": { name: "Carol White",   plan: "Premium", memberSince: "2020-01-10", openTickets: 1 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper function — shared by both MCP tools and /tool endpoint
// ─────────────────────────────────────────────────────────────────────────────
function searchKnowledgeBase(query) {
  const matchedKey = Object.keys(mockAnswers).find(
    key => query.toLowerCase().includes(key)
  );
  return matchedKey ? mockAnswers[matchedKey] : mockAnswers.general;
}

function getCustomerData(customerId) {
  return mockCustomers[customerId] || {
    name: "Unknown Customer",
    plan: "N/A",
    memberSince: "N/A",
    openTickets: 0
  };
}

function logInteraction(customerId, category, resolution) {
  const ticketId = `TKT-${Date.now()}`;
  const timestamp = new Date().toISOString();
  console.log(`[Ticket Created] ${ticketId}`);
  console.log(`  Customer   : ${customerId}`);
  console.log(`  Category   : ${category}`);
  console.log(`  Time       : ${timestamp}`);
  console.log(`  Resolution : ${resolution.substring(0, 80)}...`);
  return `Interaction logged successfully. Ticket ID: ${ticketId}. Timestamp: ${timestamp}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP TOOL 1: search_knowledge_base
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "search_knowledge_base",
  { query: z.string() },
  async ({ query }) => {
    console.log(`[MCP Tool] search_knowledge_base | Query: ${query}`);
    const answer = searchKnowledgeBase(query);
    return { content: [{ type: "text", text: answer }] };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MCP TOOL 2: get_customer_data
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "get_customer_data",
  { customerId: z.string() },
  async ({ customerId }) => {
    console.log(`[MCP Tool] get_customer_data | Customer: ${customerId}`);
    const customer = getCustomerData(customerId);
    return { content: [{ type: "text", text: JSON.stringify(customer) }] };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MCP TOOL 3: log_interaction
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "log_interaction",
  {
    customerId: z.string(),
    category:   z.string(),
    resolution: z.string()
  },
  async ({ customerId, category, resolution }) => {
    console.log(`[MCP Tool] log_interaction | Customer: ${customerId}`);
    const result = logInteraction(customerId, category, resolution);
    return { content: [{ type: "text", text: result }] };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SSE TRANSPORT SETUP (original MCP protocol — kept for completeness)
// ─────────────────────────────────────────────────────────────────────────────
const transports = {};

app.get("/sse", async (req, res) => {
  console.log("[SSE] New connection established");
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => {
    console.log(`[SSE] Session closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const { sessionId } = req.query;
  console.log(`[Message] Received for session: ${sessionId}`);
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "Unknown session ID. Please reconnect via /sse first." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DIRECT /tool ENDPOINT — for Mule (avoids SSE timeout issues)
// Mule calls POST /tool with { "name": "tool_name", "arguments": { ... } }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/tool", async (req, res) => {
  const { name, arguments: args } = req.body;

  console.log(`[Direct Tool] name: ${name} | args: ${JSON.stringify(args)}`);

  try {
    if (name === "search_knowledge_base") {
      const query = args.query || "";
      const answer = searchKnowledgeBase(query);
      return res.json({ success: true, result: answer });
    }

    if (name === "get_customer_data") {
      const customerId = args.customerId || "";
      const customer = getCustomerData(customerId);
      return res.json({ success: true, result: customer });
    }

    if (name === "log_interaction") {
      const { customerId = "", category = "", resolution = "" } = args;
      const result = logInteraction(customerId, category, resolution);
      return res.json({ success: true, result });
    }

    // Tool not recognised
    return res.status(400).json({
      success: false,
      error: `Unknown tool: ${name}. Available tools: search_knowledge_base, get_customer_data, log_interaction`
    });

  } catch (err) {
    console.error(`[Tool Error] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "support-mcp-server",
    version: "1.0.0",
    tools: ["search_knowledge_base", "get_customer_data", "log_interaction"],
    endpoints: {
      mcp_sse:    "/sse + /messages (MCP protocol)",
      direct:     "/tool (for Mule HTTP calls)",
      health:     "/health"
    },
    activeSessions: Object.keys(transports).length
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// START THE SERVER
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("════════════════════════════════════════");
  console.log(`  MCP Server running on port ${PORT}`);
  console.log(`  Health : http://localhost:${PORT}/health`);
  console.log(`  SSE    : http://localhost:${PORT}/sse`);
  console.log(`  Tool   : http://localhost:${PORT}/tool`);
  console.log("════════════════════════════════════════");
});