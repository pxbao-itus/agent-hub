export type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

/**
 * Find the @token immediately before the caret. The boundary deliberately
 * rejects email addresses and already-completed mentions followed by spaces.
 */
export function findActiveMention(value: string, caret: number): ActiveMention | null {
  const beforeCaret = value.slice(0, caret);
  const match = /(^|[^a-zA-Z0-9_@])@([a-zA-Z0-9]{0,32})$/.exec(beforeCaret);
  if (!match) return null;
  const query = match[2] ?? "";
  const start = caret - query.length - 1;
  return { start, end: caret, query };
}

export function replaceActiveMention(
  value: string,
  mention: ActiveMention,
  username: string,
): { value: string; caret: number } {
  const suffix = mention.end < value.length && /\s/.test(value[mention.end] ?? "") ? "" : " ";
  const token = `@${username}${suffix}`;
  return {
    value: `${value.slice(0, mention.start)}${token}${value.slice(mention.end)}`,
    caret: mention.start + token.length,
  };
}
