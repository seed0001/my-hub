export const MAX_TTS_CHARS = 4_000;

/** Make markdown-ish assistant text pleasant to listen to. Client-safe. */
export function cleanForSpeech(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "") // checkboxes
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^[|].*[|]$/gm, "") // tables
    .replace(/^[-=_]{3,}$/gm, "")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/✓|✦|★|⏰|🔔|›|▸/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TTS_CHARS);
}
