/**
 * Resonanco — TUI Renderer
 *
 * Render Resonanco tool calls and results.
 */

import { Text } from "@earendil-works/pi-tui";

export function renderResonancoCall(
  args: Record<string, any>,
  theme: any,
  _context: any,
): any {
  const prompt = args.prompt || "...";
  const permission = args.permissionLevel ?? "default";
  const preview = prompt.length > 60 ? `${prompt.slice(0, 60)}...` : prompt;

  const text =
    theme.fg("toolTitle", theme.bold("resonanco ")) +
    theme.fg("accent", `"${preview}"`) +
    theme.fg("muted", ` [Lv${permission}]`);

  return new Text(text, 0, 0);
}

export function renderResonancoResult(
  result: any,
  { expanded }: { expanded: boolean },
  theme: any,
  _context: any,
): any {
  const text = result.content?.[0]?.type === "text" ? result.content[0].text : "(no output)";

  if (expanded) {
    // Full output
    return new Text(text, 0, 0);
  }

  // Collapsed view: only first few lines shown
  const lines = text.split("\n");
  const previewLines = lines.slice(0, 8);
  const remaining = lines.length - previewLines.length;
  let preview = previewLines.join("\n");
  if (remaining > 0) preview += `\n${theme.fg("muted", `... (${remaining} more lines)`)}`;

  return new Text(preview, 0, 0);
}
