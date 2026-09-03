import { createMachine, assign, fromPromise } from "xstate";
import { sendTelegramMessage } from "@/lib/telegram";
import { createCTOPullRequest } from "./github-pr";
import { readFileContent } from "./ast-surgeon";

export interface CTOContext {
  chatId: string;
  request: string;
  files: { path: string; content: string }[];
  typeErrors: string[];
  prUrl: string;
  iteration: number;
  error: string;
}

export type CTOEvent =
  | { type: "START"; chatId: string; request: string }
  | { type: "FILES_READY"; files: { path: string; content: string }[] }
  | { type: "TYPE_CHECK_PASS" }
  | { type: "TYPE_CHECK_FAIL"; errors: string[] }
  | { type: "PR_DONE"; prUrl: string }
  | { type: "ERROR"; message: string };

export const ctoMachine = createMachine(
  {
    id: "cto",
    types: {} as { context: CTOContext; events: CTOEvent },
    initial: "idle",
    context: {
      chatId: "",
      request: "",
      files: [],
      typeErrors: [],
      prUrl: "",
      iteration: 0,
      error: "",
    },
    states: {
      idle: {
        on: {
          START: {
            target: "analyzing",
            actions: assign({
              chatId: ({ event }) => event.chatId,
              request: ({ event }) => event.request,
              iteration: () => 0,
            }),
          },
        },
      },

      analyzing: {
        entry: [
          ({ context }) =>
            sendTelegramMessage(
              context.chatId,
              "?? [CTO] ?? ??? ????? ???????? ? ?????? ???????? ?????..."
            ),
        ],
        on: {
          FILES_READY: {
            target: "type_checking",
            actions: assign({ files: ({ event }) => event.files }),
          },
          ERROR: { target: "failed", actions: assign({ error: ({ event }) => event.message }) },
        },
      },

      type_checking: {
        entry: [
          ({ context }) =>
            sendTelegramMessage(
              context.chatId,
              `?? [CTO] ?? ??? ????? Type Checker (???? ${context.iteration + 1}/3)...`
            ),
        ],
        on: {
          TYPE_CHECK_PASS: { target: "creating_pr" },
          TYPE_CHECK_FAIL: [
            {
              guard: ({ context }) => context.iteration < 3,
              target: "self_healing",
              actions: assign({
                typeErrors: ({ event }) => event.errors,
                iteration: ({ context }) => context.iteration + 1,
              }),
            },
            {
              target: "failed",
              actions: assign({
                error: ({ context }) =>
                  `? ??? ?? ? ???? ???????? ??????? TypeScript ?? ????? ???:\n${context.typeErrors.join("\n")}`,
              }),
            },
          ],
          ERROR: { target: "failed", actions: assign({ error: ({ event }) => event.message }) },
        },
      },

      self_healing: {
        entry: [
          ({ context }) =>
            sendTelegramMessage(
              context.chatId,
              `?? [CTO] ???? TypeScript ???? ??. ?? ??? ????????? (Auto-Fix)...\n\n\`\`\`\n${context.typeErrors.slice(0, 3).join("\n")}\n\`\`\``
            ),
        ],
        on: {
          FILES_READY: {
            target: "type_checking",
            actions: assign({ files: ({ event }) => event.files }),
          },
          ERROR: { target: "failed", actions: assign({ error: ({ event }) => event.message }) },
        },
      },

      creating_pr: {
        entry: [
          ({ context }) =>
            sendTelegramMessage(context.chatId, "?? [CTO] Type Check ??? ??! ?? ??? ????? Pull Request..."),
        ],
        on: {
          PR_DONE: {
            target: "done",
            actions: assign({ prUrl: ({ event }) => event.prUrl }),
          },
          ERROR: { target: "failed", actions: assign({ error: ({ event }) => event.message }) },
        },
      },

      done: {
        entry: [
          ({ context }) =>
            sendTelegramMessage(
              context.chatId,
              `? [CTO] Pull Request ????? ???!\n\n????? ?? ?? ????? ? Merge ????:\n${context.prUrl}`
            ),
        ],
        type: "final",
      },

      failed: {
        entry: [
          ({ context }) =>
            sendTelegramMessage(context.chatId, `?? [CTO] ??? ?? ???:\n${context.error}`),
        ],
        type: "final",
      },
    },
  }
);
