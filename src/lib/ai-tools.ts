import { writeAndProposeCode } from "@/services/github";
import { sendTelegramMessage } from "./telegram";

export const ULTRON_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "read_source_code",
        description: "Reads the content of a specific file from the GitHub repository to understand the current implementation.",
        parameters: {
          type: "OBJECT",
          properties: {
            filePath: {
              type: "STRING",
              description: "The path of the file to read, e.g., 'src/app/page.tsx' or 'package.json'."
            }
          },
          required: ["filePath"]
        }
      },
      {
        name: "list_directory",
        description: "Lists the files and folders inside a specific directory in the GitHub repository. Use this to explore the project structure.",
        parameters: {
          type: "OBJECT",
          properties: {
            dirPath: {
              type: "STRING",
              description: "The path of the directory to list. Leave empty or use '.' for the root directory, or e.g., 'src/app'."
            }
          },
          required: ["dirPath"]
        }
      },
      {
        name: "search_codebase",
        description: "Searches the entire GitHub repository for a specific string, function, or keyword (like grep). Returns the top file paths that match the query.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "The exact search query to look for in the code."
            }
          },
          required: ["query"]
        }
      },
      {
        name: "analyze_market",
        description: "Fetches live OHLCV market data and calculates Gann targets for a specific asset over a requested time horizon.",
        parameters: {
          type: "OBJECT",
          properties: {
            asset: { type: "STRING", description: "The trading pair, e.g., 'BTC/USDT'" },
            time_horizon_days: { type: "NUMBER", description: "The user's requested investment horizon in days (e.g., 4 for a few days, 180 for 6 months)." }
          },
          required: ["asset", "time_horizon_days"]
        }
      },
      {
        name: "write_and_propose_code",
        description: "Generates or modifies a file and submits a Pull Request to the GitHub repository. Use this to deploy your code.",
        parameters: {
          type: "OBJECT",
          properties: {
            filePath: {
              type: "STRING",
              description: "The path of the file to modify or create, e.g., 'src/app/api/new-feature/route.ts'."
            },
            content: {
              type: "STRING",
              description: "The complete, production-ready TypeScript code to write into the file."
            },
            description: {
              type: "STRING",
              description: "A brief description of the changes you made, which will be used as the commit message and PR description."
            }
          },
          required: ["filePath", "content", "description"]
        }
      }
    ]
  }
];

export async function executeWriteAndProposeCode(filePath: string, content: string, description: string): Promise<string> {
  try {
    const prUrl = await writeAndProposeCode(filePath, content, description);
    return JSON.stringify({ status: "success", pr_url: prUrl });
  } catch (error: any) {
    console.error("[Ultron] write_and_propose_code error:", error);
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (chatId) {
      await sendTelegramMessage(chatId, `#TOOL_ERROR write_and_propose_code failed:\n\n${error.message}`);
    }
    return JSON.stringify({ status: "error", details: error.message });
  }
}
