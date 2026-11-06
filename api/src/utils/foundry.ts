import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import OpenAI from "openai";

export interface FoundryConfig {
  endpoint: string;
  agentName: string;
  // When set, sent as the api-key header instead of signing in with DefaultAzureCredential.
  apiKey?: string;
}

export interface AgentReply {
  agent: string;
  conversationId: string;
  // The agent's reply, parsed as JSON when it is JSON, otherwise the raw text.
  output: unknown;
}

// What the email agent service needs from an agent; Foundry in production, a fake in tests.
export interface EmailAgent {
  ask(message: string): Promise<AgentReply>;
}

// Talks to an existing Foundry agent, with the API key if given, otherwise DefaultAzureCredential
// (`az login` locally, managed identity on Azure).
export function createFoundryAgent({ endpoint, agentName, apiKey }: FoundryConfig): EmailAgent {
  const openai = apiKey
    ? // Same agent URL and api-version that AIProjectClient.getOpenAIClient builds, which only takes a token credential.
      new OpenAI({
        apiKey,
        baseURL: `${endpoint.replace(/\/+$/, "")}/agents/${agentName}/endpoint/protocols/openai`,
        defaultQuery: { "api-version": "v1" },
        defaultHeaders: { "api-key": apiKey },
      })
    : new AIProjectClient(endpoint, new DefaultAzureCredential()).getOpenAIClient({
        azureConfig: { allowPreview: true, agentName },
      });

  return {
    async ask(message) {
      const conversation = await openai.conversations.create({
        items: [{ type: "message", role: "user", content: message }],
      });
      const response = await openai.responses.create({ conversation: conversation.id });
      return { agent: agentName, conversationId: conversation.id, output: parseMaybeJson(response.output_text) };
    },
  };
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
