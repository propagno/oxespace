<div align="center">
  <img src="docs/assets/banner.png" alt="OXESpace Banner" width="800" style="border-radius: 8px; margin-bottom: 20px;" />

  <h1>OXESpace</h1>
  
  <p><strong>An open-source, AI-native workspace for agentic development on Windows.</strong></p>

  <p>
    <a href="https://github.com/propagno/oxespace/releases/latest"><img src="https://img.shields.io/github/v/release/propagno/oxespace?color=00d6c9&label=version&style=flat-square" alt="Version"></a>
    <a href="https://github.com/propagno/oxespace/blob/main/LICENSE"><img src="https://img.shields.io/github/license/propagno/oxespace?color=1e3d31&style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/platform-Windows_x64-5297ff?style=flat-square" alt="Platform">
    <img src="https://img.shields.io/badge/tech-Electron_|_React_|_TypeScript-31364a?style=flat-square" alt="Tech Stack">
  </p>
</div>

<br />

OXESpace is a next-generation desktop workspace designed from the ground up for agentic development. It unifies high-performance terminal panes, a built-in file editor, deep GitHub integration, background job execution, and Model Context Protocol (MCP) servers into a single, cohesive Electron application. 

Every workspace maps to a local Windows project folder, giving you total control over your environment while dramatically reducing the friction between your code and AI agents.

---

## ✨ Core Features

### 🖥️ Multi-Pane Terminal
A robust, GPU-accelerated (WebGL) terminal grid powered by `xterm.js`. Keep Claude, Copilot, standard shells, and custom agents running side-by-side. Layouts, density, and shell profiles are completely customizable per workspace.

### 🧠 Local Semantic Brain (CodeGraph)
Forget blind code searches. OXESpace features an on-device, multilingual vector index using `transformers.js` (`multilingual-e5-small`) and `web-tree-sitter`. It processes structural and semantic queries locally—working offline and on locked-down networks—exposing highly relevant, chunked file context to agents via the `oxespace_semantic_search` MCP tool. 

### ⚡ Agent Integrations & MCP
Model Context Protocol is deeply integrated. OXESpace auto-discovers, manages, and seamlessly exposes your workspace tools to CLIs like **Claude Code** and **Copilot CLI** out of the box, keeping ports fresh and eliminating manual setup friction.

### 🦴 Caveman & RTK Modes
- **Caveman Mode**: A built-in, zero-setup output compression layer. Shrinks terminal output text by ~75% without compromising technical accuracy, drastically saving LLM input tokens.
- **RTK Native Integration**: Automatic, silent zero-setup download of RTK (`rtk-ai/rtk`) for lightning-fast token savings on CLI execution.

### 🐙 Integrated GitHub Hub
Automate without context switching. The GitHub Hub works natively with the GitHub CLI (`gh`) to handle local Git status, branch management, checkpoints (backed by Git patches), Pull Requests, and Releases all inside the app.

### 📝 Integrated Monaco Editor
A built-in editor that uses the active workspace root as a lazy-loaded file browser. Features language detection, dirty state indicators, `Ctrl+S` saving, and external file watching—perfect for quick tweaks without opening a heavy IDE.

---

## 🚀 Quick Start

**1. Download the latest release**  
[**Download OXESpace for Windows x64**](https://github.com/propagno/oxespace/releases/latest) — grab the `OXESpace-<version>-x64.exe` asset from the latest release. The app then keeps itself up to date automatically (auto-update from GitHub Releases).

> The build is currently unsigned, so Windows SmartScreen may show a warning on first install — choose *More info → Run anyway*.

**2. Prerequisites**  
- Windows x64
- [GitHub CLI](https://cli.github.com/) (Authenticate via `gh auth login`)
- Node.js 22 & npm (for script execution and MCP)

**3. Launch**  
Open OXESpace, select a local folder to serve as your workspace, and start building.

---

## 🛠️ For Developers

Want to build OXESpace from source or contribute? 

```powershell
# Clone the repository
git clone https://github.com/propagno/oxespace.git
cd oxespace

# Install dependencies
npm ci

# Rebuild native modules (SQLite, node-pty)
npm run rebuild:native

# Start the dev server
npm run dev
```

### Verification & Testing
```powershell
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

### Building the Installer Locally
```powershell
npm run dist
```
*The installer will be emitted to `dist/OXESpace-<version>-x64.exe`.*

---

## 🏗️ Tech Stack

- **Framework**: Electron + Electron Vite
- **Frontend**: React, TypeScript, Zustand
- **Terminal**: `node-pty`, xterm.js (WebGL)
- **Editor**: Monaco Editor
- **Database**: SQLite (`better-sqlite3`)
- **Semantic Engine**: `transformers.js`, `web-tree-sitter`

---

<div align="center">
  <sub>Built for the agentic future.</sub>
</div>
