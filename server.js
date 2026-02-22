// ─────────────────────────────────────────────────────────────────────────────
// Import the libraries we installed
// ─────────────────────────────────────────────────────────────────────────────
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Create the Express web server (handles HTTP connections)
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json()); // This lets Express read JSON request bodies

// ─────────────────────────────────────────────────────────────────────────────
// Create the MCP Server (this is what exposes "tools" to Mule agents)
// ─────────────────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "support-mcp-server",
  version: "1.0.0"
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1: search_knowledge_base
// When a Mule agent sends a category, this returns a pre-written answer
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "search_knowledge_base",           // Tool name (Mule will call it by this name)
  { query: z.string() },             // Input: expects a string called "query"
  async ({ query }) => {
    console.log(`[Tool Called] search_knowledge_base | Query: ${query}`);

    // Mock answers — in a real system, this would query a database
    const mockAnswers = {
      billing:   "For billing issues, please visit billing.company.com or call 1-800-BILLING. Our billing team is available Mon-Fri 9am-5pm EST.",
      technical: "For technical issues: (1) Restart the application. (2) Clear your browser cache. (3) If the issue persists, uninstall and reinstall the app.",
      account:   "To reset your account: Go to Settings → Security → Reset Account. You will receive an email within 5 minutes.",
      general:   "For general inquiries, please contact support@company.com. We aim to respond within 24 hours.",
    };

    // Check which category the query matches
    const matchedKey = Object.keys(mockAnswers).find(
      key => query.toLowerCase().includes(key)
    );

    const answer = matchedKey ? mockAnswers[matchedKey] : mockAnswers.general;

    // MCP tools must return this specific format
    return {
      content: [{ type: "text", text: answer }]
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2: get_customer_data
// Returns mock customer info given a customer ID
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "get_customer_data",
  { customerId: z.string() },        // Input: expects a string called "customerId"
  async ({ customerId }) => {
    console.log(`[Tool Called] get_customer_data | Customer: ${customerId}`);

    // Mock customer database
    const customers = {
      "C001": { name: "Alice Johnson", plan: "Premium", memberSince: "2021-03-15", openTickets: 2 },
      "C002": { name: "Bob Smith",     plan: "Basic",   memberSince: "2023-07-01", openTickets: 0 },
      "C003": { name: "Carol White",   plan: "Premium", memberSince: "2020-01-10", openTickets: 1 },
    };

    const customer = customers[customerId] || {
      name: "Unknown Customer",
      plan: "N/A",
      memberSince: "N/A",
      openTickets: 0
    };

    return {
      content: [{ type: "text", text: JSON.stringify(customer) }]
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 3: log_interaction
// Pretends to save the ticket to a database and returns a ticket ID
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  "log_interaction",
  {
    customerId: z.string(),
    category:   z.string(),
    resolution: z.string()
  },
  async ({ customerId, category, resolution }) => {
    const ticketId = `TKT-${Date.now()}`; // Simple unique ID using timestamp
    const timestamp = new Date().toISOString();

    // In a real system, you'd insert into a database here
    console.log(`[Ticket Created] ${ticketId}`);
    console.log(`  Customer : ${customerId}`);
    console.log(`  Category : ${category}`);
    console.log(`  Time     : ${timestamp}`);
    console.log(`  Resolution Preview: ${resolution.substring(0, 80)}...`);

    return {
      content: [{
        type: "text",
        text: `Interaction logged successfully. Ticket ID: ${ticketId}. Timestamp: ${timestamp}`
      }]
    };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SSE TRANSPORT SETUP
// SSE = Server-Sent Events. This is how Mule connects to MCP.
// Think of it as a persistent channel between Mule and this server.
// ─────────────────────────────────────────────────────────────────────────────
const transports = {}; // Stores active sessions

// When a Mule agent first connects, it hits /sse to open a session
app.get("/sse", async (req, res) => {
  console.log("[SSE] New connection established");
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  
  // Clean up when the connection closes
  res.on("close", () => {
    console.log(`[SSE] Session closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

// When a Mule agent sends a tool call, it posts to /messages
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
// HEALTH CHECK ENDPOINT
// Use this to verify the server is running
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "support-mcp-server",
    version: "1.0.0",
    tools: ["search_knowledge_base", "get_customer_data", "log_interaction"],
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
  console.log(`  Health check: http://localhost:${PORT}/health`);
  console.log(`  SSE endpoint: http://localhost:${PORT}/sse`);
  console.log("════════════════════════════════════════");
});