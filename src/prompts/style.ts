export function buildPromptSections(sections: Array<{ heading: string; body: string }>): string {
  return sections
    .map((section) => [`## ${section.heading}`, section.body].join("\n"))
    .join("\n\n");
}

export function renderBoundedExample(label: string, value: string, maxChars = 120): string {
  const trimmed = value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
  return `${label}: ${trimmed}`;
}

export function renderContextEnvelope(input: { origin: string; trusted: boolean; content: string }): string {
  return JSON.stringify({
    origin: input.origin,
    trusted: input.trusted,
    content: input.content,
  });
}

export function renderCompletionCriteria(criteria: string[]): string {
  if (criteria.length === 0) return "Completion criteria: none provided.";
  return [`Completion criteria:`, ...criteria.map((criterion) => `- ${criterion}`)].join("\n");
}
