export default {
  title: "Opilot 🦙",
  titleTemplate: "Opilot — Ollama for GitHub Copilot",
  description:
    "Run Ollama models with full tool and vision support in GitHub Copilot Chat",
  base: "/",
  srcDir: "docs",
  outDir: "./.gh-pages",
  themeConfig: {
    logo: "/logo.png",
    nav: [
      { text: "Home", link: "/" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "Users", link: "/users/" },
      { text: "Developers", link: "/developers/" },
      {
        text: "Install",
        link: "https://marketplace.visualstudio.com/items?itemName=selfagency.opilot",
      },
      { text: "GitHub", link: "https://github.com/selfagency/opilot" },
    ],
    sidebar: {
      "/users/": [
        { text: "Overview", link: "/users/" },
        { text: "Sidebar & Model Management", link: "/users/sidebar" },
        { text: "@ollama Chat Participant", link: "/users/chat-participant" },
        { text: "Inline Completions", link: "/users/completions" },
        { text: "Modelfile Manager", link: "/users/modelfiles" },
        { text: "Commands Reference", link: "/users/commands" },
        { text: "Settings", link: "/users/settings" },
        { text: "Troubleshooting", link: "/users/troubleshooting" },
      ],
      "/developers/": [
        { text: "Getting Started", link: "/developers/" },
        { text: "Architecture", link: "/developers/architecture" },
        { text: "Contributing", link: "/developers/contributing" },
        { text: "Testing", link: "/developers/testing" },
      ],
    },
    footer: {
      message: "Released under the MIT License",
      copyright: "©2026 The Self Agency, LLC",
    },
  },
};
