export type Platform = "iPhone" | "iPad" | "Apple Watch" | "Mac";

export type App = {
  name: string;
  platforms: Platform[];
  tagline?: string;
  blurb: string;
  url: string; // "#" until a website exists
  status?: string;
};

export const apps: App[] = [
  {
    name: "ChessMates",
    platforms: ["iPhone", "iPad"],
    tagline: "Less chess app, more friend app.",
    blurb:
      "Chess for playing the people you actually like: Game Center turns, live on FaceTime with SharePlay, in Messages, or pass one phone across the table. No ads, no ranked ladder.",
    url: "https://getchessmates.app",
    status: "Coming soon to the App Store",
  },
  {
    name: "Top Score",
    platforms: ["iPhone", "Apple Watch"],
    blurb:
      "The sideline score and match clock for amateur games, so coaches and parents can keep score and time from the touchline on their phone or wrist.",
    url: "#", // TODO: website
  },
  {
    name: "Switchboard",
    platforms: ["Mac"],
    blurb:
      "Switch audio instantly. Every speaker, headset and mic is one click or keystroke away in the menu bar, and Auto-Switch rules pick the right device as things connect.",
    url: "#", // TODO: website
  },
  {
    name: "Disco",
    platforms: ["Mac"],
    blurb:
      "A disk-space visualizer that maps what's filling your Mac with an interactive sunburst, plus Smart Clean suggestions for caches and logs that are safe to clear.",
    url: "#", // TODO: website
  },
];
