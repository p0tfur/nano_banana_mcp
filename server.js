const fs = require("fs");
const path = require("path");

function send(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: "2.0", id, error });
}

function readAllStdinLines(onLine) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      onLine(line);
    }
  });
}

function safeSlug(input) {
  const base = (input || "image")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "image";
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!match) {
    throw new Error("Expected a base64 data URL (data:<mime>;base64,...) in OpenRouter response.");
  }
  const mime = match[1];
  const b64 = match[2];
  const buffer = Buffer.from(b64, "base64");
  return { mime, buffer };
}

function extensionForMime(mime) {
  switch ((mime || "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

function normalizeImageSize(imageSize) {
  if (!imageSize) return undefined;

  const raw = String(imageSize).trim();
  if (!raw) return undefined;

  const upper = raw.toUpperCase();
  if (upper === "1K" || upper === "2K" || upper === "4K") return upper;

  const dimsMatch = /^([0-9]{2,5})\s*[Xx]\s*([0-9]{2,5})$/.exec(raw);
  if (dimsMatch) {
    const w = Number(dimsMatch[1]);
    const h = Number(dimsMatch[2]);
    const maxSide = Math.max(w, h);
    if (maxSide <= 1024) return "1K";
    if (maxSide <= 2048) return "2K";
    if (maxSide <= 4096) return "4K";
    throw new Error(
      `Unsupported image_size '${raw}'. Max side ${maxSide}px is too large. Use 1K, 2K, 4K (or e.g. 1024x1024).`
    );
  }

  const numMatch = /^([0-9]{2,5})$/.exec(raw);
  if (numMatch) {
    const px = Number(numMatch[1]);
    if (px <= 1024) return "1K";
    if (px <= 2048) return "2K";
    if (px <= 4096) return "4K";
    throw new Error(`Unsupported image_size '${raw}'. Value ${px}px is too large. Use 1K, 2K, 4K (or e.g. 1024x1024).`);
  }

  throw new Error(
    `Invalid image_size '${raw}'. Supported: 1K | 2K | 4K (also accepts 1024x1024 / 2048x2048 / 4096x4096).`
  );
}

async function generateWithOpenRouter({ prompt, model, apiKey, imageSize, extraHeaders }) {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  const body = {
    model,
    modalities: ["image", "text"],
    messages: [{ role: "user", content: prompt }],
  };

  const normalizedImageSize = normalizeImageSize(imageSize);
  if (normalizedImageSize) {
    body.image_config = { image_size: normalizedImageSize };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse OpenRouter response as JSON: ${text}`);
  }

  const dataUrl =
    json?.choices?.[0]?.message?.images?.[0]?.image_url?.url || json?.choices?.[0]?.message?.images?.[0]?.url;

  if (!dataUrl) {
    throw new Error(
      `OpenRouter response did not include images[0].image_url.url. Response keys: ${Object.keys(json || {}).join(
        ", "
      )}`
    );
  }

  return { json, dataUrl };
}

async function handleToolCall(args) {
  const { prompt, project_path, images_subdir, output_dir, image_size, model } = args || {};

  if (!prompt || typeof prompt !== "string") {
    throw new Error("'prompt' is required and must be a string.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set.");
  }

  const resolvedModel = model || "google/gemini-3-pro-image-preview";

  const baseDir = output_dir
    ? path.resolve(output_dir)
    : project_path
    ? path.resolve(project_path, images_subdir || "public/images")
    : null;

  if (!baseDir) {
    throw new Error(
      "Provide either 'output_dir' (absolute or relative) or 'project_path' (and optionally 'images_subdir')."
    );
  }

  fs.mkdirSync(baseDir, { recursive: true });

  const { dataUrl } = await generateWithOpenRouter({
    prompt,
    model: resolvedModel,
    apiKey,
    imageSize: image_size,
    extraHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "",
      "X-Title": process.env.OPENROUTER_X_TITLE || "",
    },
  });

  const { mime, buffer } = parseDataUrl(dataUrl);
  const ext = extensionForMime(mime);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = safeSlug(prompt);
  const filename = `${ts}_${slug}.${ext}`;
  const filePath = path.join(baseDir, filename);

  fs.writeFileSync(filePath, buffer);

  let publicPath = null;
  if (project_path) {
    const publicDir = path.resolve(project_path, "public");
    const relToPublic = path.relative(publicDir, filePath);
    if (!relToPublic.startsWith("..") && !path.isAbsolute(relToPublic)) {
      publicPath = `/${relToPublic.replace(/\\/g, "/")}`;
    }
  }

  return {
    model: resolvedModel,
    mime,
    bytes: buffer.length,
    file_path: filePath,
    public_path: publicPath,
  };
}

const TOOLS = [
  {
    name: "nano_banana_generate_image",
    description:
      "Generate an image via OpenRouter (google/gemini-3-pro-image-preview) and save it into a project's public images folder.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string" },
        project_path: {
          type: "string",
          description:
            "Project root. If provided, image will be saved under <project_path>/<images_subdir> (default public/images).",
        },
        images_subdir: {
          type: "string",
          description: "Relative path inside project_path to store images. Defaults to public/images.",
        },
        output_dir: {
          type: "string",
          description: "Override output directory (absolute or relative). If set, project_path is optional.",
        },
        image_size: {
          type: "string",
          description: "Optional OpenRouter/Gemini image size. Example: 1024x1024 (model-dependent).",
        },
        model: {
          type: "string",
          description: "Optional OpenRouter model id. Defaults to google/gemini-3-pro-image-preview.",
        },
      },
      required: ["prompt"],
    },
  },
];

readAllStdinLines(async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return;
  }

  if (!msg || msg.jsonrpc !== "2.0") return;

  const { id, method, params } = msg;

  try {
    if (method === "initialize") {
      sendResult(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "nano-banana-mcp", version: "0.1.0" },
      });
      return;
    }

    if (method === "tools/list") {
      sendResult(id, { tools: TOOLS });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments;

      if (toolName !== "nano_banana_generate_image") {
        sendError(id, -32602, `Unknown tool: ${toolName}`);
        return;
      }

      const result = await handleToolCall(toolArgs);
      sendResult(id, {
        content: [
          {
            type: "text",
            text: result.public_path
              ? `Saved image to ${result.file_path} (public: ${result.public_path})`
              : `Saved image to ${result.file_path}`,
          },
        ],
        structuredContent: result,
      });
      return;
    }

    if (id !== undefined) {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (id !== undefined) {
      sendError(id, -32000, err?.message || "Unknown error", {
        stack: err?.stack,
      });
    }
  }
});
