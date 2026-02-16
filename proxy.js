/**
 * Claude Code Free — Local Proxy
 * 
 * Bridges Claude Code CLI ↔ Google Cloud Code Assist API.
 * Translates Anthropic Messages API requests to Google's streamGenerateContent format.
 *
 * Features:
 * - Free access via Google Cloud Code API
 * - Verification of "Thinking" models
 * - Smart Fallback: Downgrades to Flash model on Rate Limit (429) errors
 * - Automatic thought_signature management for tool use
 */

import http from "node:http";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Configuration
const PORT = parseInt(process.env.PROXY_PORT || "51200", 10);
// Store credentials in user's home directory
const CRED_PATH = join(homedir(), ".claude-code-google-credentials.json");

// API Endpoints
const PROD_EP = "https://cloudcode-pa.googleapis.com";
const SANDBOX_EP = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const ENDPOINTS = [PROD_EP, SANDBOX_EP];
const ANTIGRAVITY_VERSION = "1.15.8";

// Logging
const LOG_PATH = join(homedir(), ".claude-code-proxy.log");
function log(...args) {
    const line = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    try { appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`); } catch { }
}

// ── Credentials ─────────────────────────────────────────────────────────
let creds;
try {
    creds = JSON.parse(readFileSync(CRED_PATH, "utf-8"));
} catch {
    console.error("❌ Credentials file not found:", CRED_PATH);
    console.error("Please ensure you have authenticated properly.");
    process.exit(1);
}

async function refreshToken() {
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: creds.client_id,
            client_secret: creds.client_secret,
            refresh_token: creds.refresh_token,
            grant_type: "refresh_token",
        }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error("Token refresh failed: " + JSON.stringify(data));
    creds.access_token = data.access_token;
    creds.expires_at = Date.now() + (data.expires_in || 3600) * 1000 - 300000;
    writeFileSync(CRED_PATH, JSON.stringify(creds, null, 2));
    return data.access_token;
}

async function getToken() {
    if (Date.now() >= (creds.expires_at || 0)) await refreshToken();
    return creds.access_token;
}

// ── Model Mapping ───────────────────────────────────────────────────────
const MODEL_MAP = {
    // Direct matches
    "claude-sonnet-4-5-20250514": "claude-sonnet-4-5",
    "claude-sonnet-4-5": "claude-sonnet-4-5",
    "claude-opus-4-5-20250414": "claude-opus-4-6-thinking",
    "claude-opus-4-5": "claude-opus-4-6-thinking",
    "claude-sonnet-4-20250514": "claude-sonnet-4-5",
    // Thinking variants
    "claude-sonnet-4-5-thinking": "claude-sonnet-4-5-thinking",
    "claude-opus-4-5-thinking": "claude-opus-4-6-thinking",
    "claude-opus-4-6-thinking": "claude-opus-4-6-thinking",
    "claude-opus-4-6": "claude-opus-4-6-thinking",
    // Gemini models
    "gemini-2.5-pro": "gemini-2.5-pro",
    "gemini-2.5-flash": "gemini-2.5-flash",
    "gemini-3-pro": "gemini-3-pro-high",
    "gemini-3-pro-preview": "gemini-3-pro-high",
    "gemini-3-flash": "gemini-3-flash",
    "gemini-3-flash-preview": "gemini-3-flash",
    // Fallbacks
    "claude-haiku-4-5-20251001": "gemini-3-flash",
    "claude-haiku-3-5-20241022": "gemini-3-flash",
    "claude-3-5-haiku-20241022": "gemini-3-flash",
};

function mapModel(anthropicModel) {
    if (MODEL_MAP[anthropicModel]) return MODEL_MAP[anthropicModel];
    if (anthropicModel.includes("opus")) return "claude-opus-4-6-thinking";
    if (anthropicModel.includes("sonnet")) return "claude-sonnet-4-5-thinking";
    if (anthropicModel.includes("haiku")) return "gemini-3-flash";
    if (anthropicModel.includes("gemini")) return "gemini-3-pro-high";
    return "claude-opus-4-6-thinking";
}

function isThinkingModel(modelId) {
    return modelId.includes("thinking");
}

// ── Thought Signature Cache ─────────────────────────────────────────────
// Google requires `thought_signature` to be echoed back for tools to work.
const TOOL_SIGS = new Map();

// ── Anthropic → Google Conversion ───────────────────────────────────────
function extractText(content) {
    if (content == null) return "(no output)";
    if (typeof content === "string") return content || "(empty)";
    if (Array.isArray(content)) {
        const texts = content.filter(b => b?.type === "text").map(b => b.text);
        return texts.join("\n") || "(empty)";
    }
    return JSON.stringify(content);
}

function convertAnthropicToGoogle(anthropicReq) {
    const googleModel = mapModel(anthropicReq.model);
    const rawContents = [];

    for (const msg of (anthropicReq.messages || [])) {
        if (!msg) continue;
        const role = msg.role === "assistant" ? "model" : "user";

        // Handle tool results (user with tool_result blocks)
        if (Array.isArray(msg.content)) {
            const toolResults = msg.content.filter(b => b?.type === "tool_result");
            if (toolResults.length > 0) {
                const toolParts = toolResults.map(tr => ({
                    functionResponse: {
                        name: tr.tool_use_id || "unknown",
                        id: tr.tool_use_id,
                        response: { output: extractText(tr.content) },
                    },
                }));
                rawContents.push({ role: "user", parts: toolParts });

                const textBlocks = msg.content.filter(b => b?.type === "text" && b.text);
                if (textBlocks.length > 0) {
                    rawContents.push({ role: "user", parts: textBlocks.map(b => ({ text: String(b.text) })) });
                }
                continue;
            }
        }

        // Regular messages
        const parts = [];
        if (typeof msg.content === "string") {
            if (msg.content) parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (!block) continue;
                switch (block.type) {
                    case "text":
                        if (block.text) parts.push({ text: String(block.text) });
                        break;
                    case "thinking": break; // Drop internal thinking blocks
                    case "image":
                        parts.push({
                            inlineData: {
                                mimeType: block.source?.media_type || "image/png",
                                data: block.source?.data || "",
                            },
                        });
                        break;
                    case "tool_use":
                        // Inject cached thought_signature
                        const sig = TOOL_SIGS.get(block.id);
                        const funcCallPart = {
                            functionCall: {
                                name: block.name,
                                args: block.input || {},
                                id: block.id,
                            }
                        };
                        if (sig) funcCallPart.thoughtSignature = sig;
                        parts.push(funcCallPart);
                        break;
                    default:
                        const txt = block.text || block.content;
                        if (txt) parts.push({ text: String(typeof txt === "string" ? txt : JSON.stringify(txt)) });
                }
            }
        }

        const sanitizedParts = parts.filter(p => p.text || p.functionCall || p.functionResponse || p.inlineData);
        if (sanitizedParts.length === 0) sanitizedParts.push({ text: "..." });
        rawContents.push({ role, parts: sanitizedParts });
    }

    // Merge consecutive messages of same role
    const contents = [];
    for (const entry of rawContents) {
        const prev = contents[contents.length - 1];
        if (prev && prev.role === entry.role) {
            prev.parts.push(...entry.parts);
        } else {
            contents.push({ ...entry });
        }
    }

    const request = { contents };

    // System prompt
    const systemParts = [];
    if (anthropicReq.system) {
        const sys = anthropicReq.system;
        if (typeof sys === "string") systemParts.push({ text: sys });
        else if (Array.isArray(sys)) {
            for (const block of sys) if (block.type === "text") systemParts.push({ text: block.text });
        }
    }
    request.systemInstruction = { role: "user", parts: systemParts };

    // Generation Config
    const generationConfig = {};
    const rawMaxTokens = anthropicReq.max_tokens || 16384;

    if (isThinkingModel(googleModel)) {
        const clientBudget = anthropicReq.thinking?.budget_tokens;
        const dynamicBudget = Math.min(10240, Math.max(1024, Math.floor(rawMaxTokens * 0.25)));
        const thinkingBudget = clientBudget || dynamicBudget;
        const maxOutputTokens = Math.max(rawMaxTokens, thinkingBudget + 1024);

        generationConfig.maxOutputTokens = maxOutputTokens;
        generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget };
    } else {
        generationConfig.maxOutputTokens = rawMaxTokens;
    }
    if (anthropicReq.temperature !== undefined) generationConfig.temperature = anthropicReq.temperature;
    if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;

    // Tools
    if (anthropicReq.tools?.length > 0) {
        const isClaude = googleModel.startsWith("claude-");
        request.tools = [{
            functionDeclarations: anthropicReq.tools.map(tool => {
                const cleaned = ensureSchemaType(sanitizeSchema(stripDollarSchema(tool.input_schema || {})));
                return {
                    name: tool.name,
                    description: tool.description || "",
                    ...(isClaude ? { parameters: cleaned } : { parametersJsonSchema: cleaned }),
                };
            }),
        }];
    }

    return {
        project: creds.project_id,
        model: googleModel,
        request,
        requestType: "agent",
        userAgent: "antigravity",
        requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    };
}

// ── Schema Utilities ────────────────────────────────────────────────────
function stripDollarSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (Array.isArray(schema)) return schema.map(stripDollarSchema);
    const clean = {};
    for (const [key, value] of Object.entries(schema)) {
        if (key.startsWith("$")) continue;
        clean[key] = (typeof value === "object" && value !== null) ? stripDollarSchema(value) : value;
    }
    return clean;
}

const ALLOWED_SCHEMA_FIELDS = new Set(["type", "description", "properties", "required", "items", "enum", "nullable"]);
function sanitizeSchema(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (Array.isArray(schema)) return schema.map(sanitizeSchema);

    let working = schema;
    if (working.anyOf || working.oneOf) {
        const variants = (working.anyOf || working.oneOf).filter(v => v && typeof v === "object");
        working = { ...variants[0], ...(working.description ? { description: working.description } : {}) };
    }

    const clean = {};
    for (const [key, value] of Object.entries(working)) {
        if (!ALLOWED_SCHEMA_FIELDS.has(key)) continue;
        if (key === "properties" && typeof value === "object") {
            clean.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeSchema(v)]));
        } else if (key === "items") {
            clean.items = sanitizeSchema(value);
        } else {
            clean[key] = value;
        }
    }
    return clean;
}

function ensureSchemaType(schema) {
    if (!schema || typeof schema !== "object") return schema;
    if (Array.isArray(schema)) return schema.map(ensureSchemaType);
    const s = { ...schema };
    if (!s.type) s.type = s.properties ? "object" : (s.items ? "array" : (s.enum ? "string" : "object"));
    if (s.properties) s.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, ensureSchemaType(v)]));
    if (s.items) s.items = ensureSchemaType(s.items);
    return s;
}

// ── Response Conversion ─────────────────────────────────────────────────
function convertGoogleSSEToAnthropicStream(googleSSE, anthropicModel) {
    const events = [];
    googleSSE.split("\n").forEach(line => {
        if (line.startsWith("data:")) {
            try { events.push(JSON.parse(line.slice(5).trim())); } catch { }
        }
    });

    const content = [];
    let inputTokens = 0, outputTokens = 0;
    let stopReason = "end_turn";

    for (const event of events) {
        const resp = event.response;
        if (!resp) continue;
        const candidate = resp.candidates?.[0];
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.text && !part.thoughtSignature) {
                    const existing = content.find(b => b.type === "text");
                    if (existing) existing.text += part.text;
                    else content.push({ type: "text", text: part.text });
                }
                if (part.functionCall) {
                    const toolId = `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    if (part.thoughtSignature) TOOL_SIGS.set(toolId, part.thoughtSignature);
                    content.push({
                        type: "tool_use",
                        id: toolId,
                        name: part.functionCall.name,
                        input: part.functionCall.args || {},
                    });
                }
            }
            if (candidate.finishReason === "STOP") stopReason = "end_turn";
        }
        if (resp.usageMetadata) {
            inputTokens = resp.usageMetadata.promptTokenCount || 0;
            outputTokens = (resp.usageMetadata.candidatesTokenCount || 0) + (resp.usageMetadata.thoughtsTokenCount || 0);
        }
    }

    if (content.some(b => b.type === "tool_use")) stopReason = "tool_use";
    if (content.length === 0) content.push({ type: "text", text: "" });

    return {
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: anthropicModel,
        content,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    };
}

async function streamGoogleToAnthropic(googleResp, res, anthropicModel) {
    const reader = googleResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let contentIndex = 0;
    let started = false;
    let inputTokens = 0, outputTokens = 0;

    const msgStart = {
        type: "message_start",
        message: {
            id: `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            model: anthropicModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
        },
    };
    res.write(`event: message_start\ndata: ${JSON.stringify(msgStart)}\n\n`);

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                try {
                    const chunk = JSON.parse(line.slice(5).trim());
                    const resp = chunk.response;
                    if (!resp) continue;

                    const candidate = resp.candidates?.[0];
                    if (candidate?.content?.parts) {
                        for (const part of candidate.content.parts) {
                            if (part.thoughtSignature && !part.text && !part.functionCall) continue;

                            if (part.text !== undefined) {
                                if (part.thought) continue; // Skip thinking
                                if (!started) {
                                    res.write(`event: content_block_start\ndata: ${JSON.stringify({
                                        type: "content_block_start", index: contentIndex, content_block: { type: "text", text: "" },
                                    })}\n\n`);
                                    started = true;
                                }
                                res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                    type: "content_block_delta", index: contentIndex, delta: { type: "text_delta", text: part.text },
                                })}\n\n`);
                            }
                            if (part.functionCall) {
                                if (started) {
                                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                        type: "content_block_stop", index: contentIndex,
                                    })}\n\n`);
                                    contentIndex++;
                                    started = false;
                                }
                                const toolId = `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                                if (part.thoughtSignature) TOOL_SIGS.set(toolId, part.thoughtSignature);

                                res.write(`event: content_block_start\ndata: ${JSON.stringify({
                                    type: "content_block_start", index: contentIndex, content_block: { type: "tool_use", id: toolId, name: part.functionCall.name, input: {} },
                                })}\n\n`);
                                res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                    type: "content_block_delta", index: contentIndex, delta: { type: "input_json_delta", partial_json: JSON.stringify(part.functionCall.args || {}) },
                                })}\n\n`);
                                res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                                    type: "content_block_stop", index: contentIndex,
                                })}\n\n`);
                                contentIndex++;
                            }
                        }
                    }
                    if (resp.usageMetadata) {
                        inputTokens = resp.usageMetadata.promptTokenCount || 0;
                        outputTokens = (resp.usageMetadata.candidatesTokenCount || 0) + (resp.usageMetadata.thoughtsTokenCount || 0);
                    }
                } catch { continue; }
            }
        }
    } catch (err) {
        log("[stream error]", err.message);
    }

    if (started) {
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: contentIndex })}\n\n`);
    }

    const hasToolUse = contentIndex > (started ? 1 : 0);
    res.write(`event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: hasToolUse ? "tool_use" : "end_turn", stop_sequence: null },
        usage: { output_tokens: outputTokens },
    })}\n\n`);
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
}

// ── HTTP Server ─────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();

    let anthropicReq;
    try { anthropicReq = JSON.parse(body); }
    catch { res.writeHead(400); res.end('{"error":"Invalid JSON"}'); return; }

    const isStream = anthropicReq.stream === true;
    const originalModel = anthropicReq.model;
    const googlePayload = convertAnthropicToGoogle(anthropicReq);

    log(`${originalModel} → ${googlePayload.model} (stream=${isStream})`);

    try {
        const token = await getToken();
        const headers = {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "User-Agent": `claude-code-gemini-proxy/${ANTIGRAVITY_VERSION}`,
            "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
            "Client-Metadata": JSON.stringify({ ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" }),
        };

        if (isThinkingModel(googlePayload.model)) {
            headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
        }

        const fetchOne = async (ep) => {
            const url = `${ep}/v1internal:streamGenerateContent?alt=sse`;
            const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(googlePayload) });
            if (!r.ok) throw { status: r.status, errText: await r.text() };
            return r;
        };

        // Attempt request with retry/fallback logic
        let success, finalError;
        let attempts = 0;

        while (attempts < 2) {
            attempts++;
            const results = await Promise.allSettled(ENDPOINTS.map(fetchOne));
            success = results.find(r => r.status === "fulfilled");

            if (success) break;

            finalError = results[0].reason;

            // Fallback logic
            if ((finalError?.status === 429 || finalError?.status === 503) &&
                (googlePayload.model === "gemini-3-pro-high")) {
                log(`⚠️ Rate limited. Falling back to Gemini 3 Flash.`);
                googlePayload.model = "gemini-3-flash";
                continue;
            }
            break;
        }

        if (!success) {
            const isRateLimit = finalError?.status === 429 || finalError?.status === 503;
            res.writeHead(isRateLimit ? 529 : 500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                type: "error",
                error: {
                    type: isRateLimit ? "overloaded_error" : "api_error",
                    message: isRateLimit ? "Overloaded — Model rate limited. Try again." : (finalError?.errText || "Unknown error"),
                },
            }));
            return;
        }

        const googleResp = success.value;
        if (isStream) {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            await streamGoogleToAnthropic(googleResp, res, originalModel);
        } else {
            const sseText = await googleResp.text();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(convertGoogleSSEToAnthropicStream(sseText, originalModel)));
        }
    } catch (err) {
        log("[proxy error]", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: err.message } }));
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Claude Code Gemini Proxy running on http://localhost:${PORT}`);
    console.log(`📝 Log: ${LOG_PATH}`);
});
