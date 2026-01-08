# Nano Banana MCP (Windsurf skill example)

Local MCP server for Windsurf Cascade that lets you generate images via OpenRouter’s
`google/gemini-3-pro-image-preview` model and drop them into any project’s
`public/images` folder (or another directory you choose).

> **Note**: The instructions below assume a standard Windsurf setup on Windows
> where MCP configs live in `C:\Users\<you>\.codeium\windsurf\mcp_config.json`.
>
> Adjust paths as needed for other platforms.

## Features

- Calls OpenRouter with your own API key (BYOK) and saves the resulting image locally.
- Accepts friendly `image_size` inputs like `1024x1024` or `2048` and maps them to
  Google’s required `1K | 2K | 4K` values.
- Supports per-project output:
  - pass `project_path` and (optionally) `images_subdir` (defaults to `public/images`), or
  - pass a fully custom `output_dir`.
- Returns both the absolute file path and a `/public/...` path when the file lives
  inside `<project>/public`.

## Requirements

- Node.js **18+** (needed for built-in `fetch`).
- OpenRouter account + API key with access to `google/gemini-3-pro-image-preview` (aka
  “Nano Banana Pro”).
- Windsurf 2.2.2+ (MCP support).

## Installation

1. Copy this folder wherever you keep MCP tools (example here: `D:\coding\projects\_skills\nano-banana`).
2. No npm install is required because this script only uses Node built‑ins.

## Configure Windsurf (MCP)

Edit `C:\Users\<you>\.codeium\windsurf\mcp_config.json` (create if missing) and add:

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["D:/coding/projects/_skills/nano-banana/server.js"],
      "env": {
        "OPENROUTER_API_KEY": "${env:OPENROUTER_API_KEY}",
        "OPENROUTER_HTTP_REFERER": "${env:OPENROUTER_HTTP_REFERER}",
        "OPENROUTER_X_TITLE": "${env:OPENROUTER_X_TITLE}"
      }
    }
  }
}
```

Restart Windsurf (or open the MCP panel → _Refresh plugins_).

## Environment variables

Set directly in "mcp_config.json" OR
Set these in Windows (PowerShell example) **before** launching Windsurf:

```powershell
setx OPENROUTER_API_KEY "sk-or-your-key"
# optional attribution headers, you can leave it empty
setx OPENROUTER_HTTP_REFERER "https://example.com"
setx OPENROUTER_X_TITLE "Your App Name"
```

> Restart Windsurf after running `setx`, because it only affects new processes.

## Tool usage

Just write in Cascade chat: "Please create an image <details> using nano-banana MCP".

Tool name: `nano_banana_generate_image`

Arguments:

| Name            | Required | Description                                                                                             |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `prompt`        | ✅       | Text prompt for the image                                                                               |
| `project_path`  | ✅\*     | Root of the project whose `/public` you want to write into (_required unless you provide `output_dir`_) |
| `images_subdir` | optional | Relative path under `project_path` (defaults to `public/images`)                                        |
| `output_dir`    | optional | Absolute/relative path override if you don’t want to use `project_path`                                 |
| `image_size`    | optional | Friendly sizes (`1K`, `2K`, `4K`, `1024x1024`, `2048`, etc.)                                            |
| `model`         | optional | OpenRouter model (defaults to `google/gemini-3-pro-image-preview`)                                      |

Example request via Cascade chat:

```json
{
  "prompt": "Design a minimalist teal + gold AI nutrition logo for Dietetyk.SI",
  "project_path": "D:/coding/projects/projectName/frontend",
  "images_subdir": "public/images",
  "image_size": "1024x1024"
}
```

The tool saves to `D:/.../public/images/<timestamp>_<slug>.png` and responds with:

```json
{
  "file_path": "D:/.../public/images/2026-01-08T18-20-45-123Z_dietetyk-si.png",
  "public_path": "/images/2026-01-08T18-20-45-123Z_dietetyk-si.png"
}
```

## Troubleshooting

- **Tool not visible in Windsurf**
  - Double-check the MCP config path and run _Refresh_ in the MCP panel, or restart Windsurf.
  - Ensure Node >= 18 is on your PATH (`node -v`).
- **`OPENROUTER_API_KEY` undefined**
  - Re-run `setx ...` (or set it in your shell) and restart Windsurf.
- **OpenRouter 400 “invalid image_size”**
  - Use `1K`, `2K`, or `4K`, or friendly equivalents like `1024x1024`.
- **403 / 401 from OpenRouter**
  - Make sure your key has access to the Gemini 3 Pro Image Preview model and you have enough credit.
- **Images not accessible via `/public`**
  - Confirm you passed `project_path` pointing at the repo with a `public` folder.

## License

MIT.
