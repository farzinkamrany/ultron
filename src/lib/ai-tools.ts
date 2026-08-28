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
