export type NowItem = {
  title: string;
  blurb: string;
};

// Short, easy-to-edit snapshots of what I'm focused on right now.
export const now: NowItem[] = [
  {
    title: "The Orchestrate runtime",
    blurb:
      "My main objective: owning the runtime that handles customer integrations on Workday Orchestrate and executes some of the most critical workloads for some of the world's biggest companies.",
  },
  {
    title: "Orchestrate for agents",
    blurb:
      "Helping my team open Workday Orchestrate up to AI agents, so integrations are exposed as tools that MCP servers and agents can call.",
  },
  {
    title: "Agentic ways of working",
    blurb:
      "I use LLMs, coding assistants and agentic tooling myself every day, and I'm bringing agentic software-development practices to my team: improving our observability platforms and eliminating toil.",
  },
];
