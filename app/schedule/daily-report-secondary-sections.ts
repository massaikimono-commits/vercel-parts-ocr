export type DailyReportSecondaryEntry = {
  notes?: string | null;
};

export function collectDailyReportMessages(entries: DailyReportSecondaryEntry[]) {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const entry of entries) {
    const note = entry.notes?.trim();
    if (!note || seen.has(note)) continue;
    seen.add(note);
    messages.push(note);
  }
  return messages;
}
