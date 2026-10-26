import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.BERSERK_API_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const server = new McpServer({ name: "berserk-chess", version: "1.0.0" });

server.tool(
  "get_best_move",
  "Ask the Berserk chess engine for its best move in a FEN position.",
  {
    fen: z.string().min(1).max(200).describe("Chess position in FEN notation"),
    movetime: z.number().positive().optional().describe("Search time in milliseconds; API caps this at 5000")
  },
  async ({ fen, movetime }) => {
    const response = await fetch(API_URL + "/bestmove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, movetime: Math.min(5000, movetime ?? 1000) }),
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Berserk API returned ${response.status}: ${body}`);
    return { content: [{ type: "text", text: body }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
