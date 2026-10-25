export type ExperienceRole = {
  role: string;
  start: string;
  end: string;
  summary?: string;
};

export type ExperienceCompany = {
  company: string;
  location: string;
  start: string;
  end: string;
  tenure?: string; // e.g. "9 yrs"
  summary?: string; // company blurb
  roles: ExperienceRole[];
};

// Roles are grouped by company, newest role first.
export const experience: ExperienceCompany[] = [
  {
    company: "Workday",
    location: "Dublin, Ireland",
    start: "Jun 2017",
    end: "Present",
    tenure: "9 yrs",
    summary:
      "Leading engineering teams on Workday Orchestrate, Workday's integration platform. Hands-on with enabling Orchestrate for AI agents and MCP, and bringing agentic development practices to the team.",
    roles: [
      {
        role: "Sr Software Engineering Manager",
        start: "May 2026",
        end: "Present",
        summary:
          "Enabling Orchestrate for agents (tools for MCP servers), involvement in Orchestrate's Copilot, and driving agentic SDLC practices across the team.",
      },
      { role: "Software Engineering Manager", start: "Jun 2022", end: "May 2026" },
      { role: "Principal Software Engineer", start: "May 2021", end: "Jun 2022" },
      { role: "Senior Software Development Engineer", start: "May 2019", end: "May 2021" },
      { role: "Software Development Engineer", start: "Jun 2017", end: "May 2019" },
    ],
  },
  {
    company: "Mastercard",
    location: "Dublin, Ireland",
    start: "Mar 2014",
    end: "Jun 2017",
    summary: "Built integration tooling and managed the enterprise web service platform.",
    roles: [
      {
        role: "Technical Consultant",
        start: "Feb 2016",
        end: "Jun 2017",
        summary:
          "Built SDKs for microservice development, providing dynamic service discovery and publication, client-side load balancing, dynamic configuration and centralised administration.",
      },
      {
        role: "Senior Engineer",
        start: "Mar 2014",
        end: "Feb 2016",
        summary:
          "Built tools to monitor and automate the enterprise web service integration environment, and managed the Enterprise Service Bus platform stack (IBM DataPower and more).",
      },
    ],
  },
  {
    company: "AIB",
    location: "Dublin, Ireland",
    start: "Feb 2006",
    end: "Mar 2014",
    tenure: "8 yrs",
    summary: "Systems programming and administration for business-critical mainframe platforms.",
    roles: [
      {
        role: "WebSphere Administrator",
        start: "Aug 2012",
        end: "Mar 2014",
        summary:
          "Managed multiple WebSphere cells on IBM mainframe running business-critical applications.",
      },
      {
        role: "Mainframe Systems Programmer",
        start: "Sep 2009",
        end: "Mar 2014",
        summary:
          "Supported System Automation for z/OS, TCP/IP and z/OS UNIX on IBM mainframe systems.",
      },
      {
        role: "HP NonStop Systems Programmer",
        start: "Feb 2006",
        end: "Mar 2014",
        summary:
          "Level 2 support, capacity and performance management for HP NonStop servers.",
      },
    ],
  },
];

export const education = {
  school: "University College Dublin",
  degree: "MSc Computer Science",
};
