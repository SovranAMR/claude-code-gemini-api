# Claude Code Gemini API Proxy 🚀

**Unlock free, unlimited usage of Claude Code CLI using Google's Gemini 3 Pro / Flash models.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macos-lightgrey.svg)

This proxy bridges the [Claude Code CLI](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) to Google's Cloud Code API, allowing you to use **Gemini 3 Pro** (High Reasoning) and **Gemini 3 Flash** for free, without an Anthropic subscription.

## ✨ Key Features

- **💸 Free Access**: Leverages Google Cloud Code's currently free internal API.
- **🧠 Thinking Mode**: Full support for "thinking" blocks, just like Claude 3.7 Sonnet.
- **🔄 Smart Fallback**: Automatically switches to **Gemini 3 Flash** if the Pro model is rate-limited (429). Never get stuck!
- **🛠️ Tool Use Fixed**: Includes proprietary `thought_signature` handling to ensure complex tool use works perfectly.
- **⚡ High Performance**: Streaming support with direct mapping to `gemini-3-pro` and `gemini-3-flash`.

## 📦 Installation

1.  **Clone this repository**:
    ```bash
    git clone https://github.com/SovranAMR/claude-code-gemini-api.git
    cd claude-code-gemini-api
    ```

2.  **Authenticate with Google**:
    You need to be logged in to Google Cloud. If you have `gcloud` installed:
    ```bash
    gcloud auth application-default login
    ```
    *Alternatively, copy your existing `.antigravity-claude-bridge.json` or similar credentials to `~/.claude-code-google-credentials.json`.*

3.  **Install Claude Code** (if you haven't):
    ```bash
    npm install -g @anthropic-ai/claude-code
    ```

## 🚀 Usage

Simply run the start script:

```bash
bash start.sh
```

This will:
1.  Start the local proxy on port `51200`.
2.  Configure Claude Code to use `http://localhost:51200`.
3.  Launch the CLI with `gemini-3-pro` selected.

### Troubleshooting

- **Rate Limits**: If you see "Rate limit detected", the proxy automatically retries with Flash. You don't need to do anything!
- **Permissions**: The script uses `--dangerously-skip-permissions` for a smoother experience. Remove it from `start.sh` if you prefer manual approval.

## 🤝 Contributing

Contributions are welcome! Please submit a Pull Request.

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
