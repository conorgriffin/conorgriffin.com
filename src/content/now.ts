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
      "Orchestrate is being opened up to AI agents, with integrations exposed as tools that MCP servers can call. The engineers own that implementation; my part is leading the team and the runtime it all executes on.",
  },
  {
    title: "Agentic ways of working",
    blurb:
      "I use LLMs, coding assistants and agentic tooling myself every day, and I'm bringing agentic software-development practices to my team: improving our observability platforms and eliminating toil.",
  },
];
