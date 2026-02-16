# Claude Code Gemini API Proxy 🚀

**Unlock free, unlimited usage of Claude Code CLI using Google's Gemini 3 models.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macos-lightgrey.svg)

This proxy bridges the [Claude Code CLI](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) to Google's Cloud Code API. It allows you to use the latest Claude model names while routing them to **Gemini 3 Pro** (High Reasoning) and **Gemini 3 Flash** for free execution.

## ✨ Key Features

### 🧠 Advanced Model Support
Supports the latest "Thinking" models by mapping them to Gemini 3 Pro High Reasoning:
- **Claude 3.7 Sonnet** (`claude-thinking-3-7`)
- **Claude 4.6 Opus** (`claude-opus-4-6`)
- **Gemini 3 Pro** (`gemini-3-pro`)

### 🔄 Smart Fallback & Reliability
- **Auto-Switching**: If `Gemini 3 Pro` hits a rate limit (429), the proxy automatically retries the request using **Gemini 3 Flash**.
- **No Interruptions**: You never get stuck with "Overloaded" errors; the work continues seamlessly.

### 🛠️ Enhanced Tool Use
- **Thought Signatures**: Includes proprietary handling for Gemini's `thought_signature`, ensuring complex tool-use chains working perfectly where other proxies fail.
- **Streaming**: Full real-time streaming support.

## 📦 Installation

### 1. Clone Repository
```bash
git clone https://github.com/SovranAMR/claude-code-gemini-api.git
cd claude-code-gemini-api
```

### 2. Authenticate
You need to be logged in to Google Cloud. If you have `gcloud` installed:
```bash
gcloud auth application-default login
```
*Alternatively, place your valid `application_default_credentials.json` at `~/.claude-code-google-credentials.json`.*

### 3. Install Claude Code
If you haven't already:
```bash
npm install -g @anthropic-ai/claude-code
```

## 🚀 Usage

Simply run the start script. It handles everything:

```bash
bash start.sh
```

### What it does:
1.  **Starts Proxy**: Launches the local bridge on port `51200`.
2.  **Configures CLI**: Points Claude Code to `http://localhost:51200`.
3.  **Launches Interface**: Starts Claude Code with **Gemini 3 Pro** selected.

## ⚙️ Configuration

You can request different models in Claude Code, and they will be mapped automatically:

| Claude Model Name Requested | Mapped To (Google) | Description |
| :--- | :--- | :--- |
| `claude-opus-4-6-thinking` | **Gemini 3 Pro** | High Reasoning / Thinking Mode |
| `claude-sonnet-3-7` | **Gemini 3 Pro** | Fast / Balanced |
| `claude-3-5-haiku` | **Gemini 3 Flash** | Ultra-Fast / Fallback |

## 🤝 Contributing

Contributions are welcome! Please submit a Pull Request.

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
