export function extractMentionedUsernames(content: string): string[] {
  const regex = /@([a-zA-Z0-9_]+)/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    seen.add(match[1].toLowerCase());
  }
  return Array.from(seen);
}
