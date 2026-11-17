export const PROMPT_SECTIONS = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
] as const;

export function missingPromptSections(prompt: string) {
  return PROMPT_SECTIONS.filter((section) => !prompt.includes(section));
}
