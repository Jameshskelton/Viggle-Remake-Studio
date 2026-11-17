import { timecode } from "./prompt.ts";

export type EditKind = "remove" | "add" | "replace" | "scene" | "atmosphere" | "style";

export type EditRole = "background" | "object" | "style" | "frame";

export type EditRef = {
  role: EditRole;
  caption?: string;
  pin?: number;
};

export type EditPromptInput = {
  kind: EditKind;
  change: string;
  keep: string;
  style: string;
  refs: EditRef[];
  frames: number;
  soundscape: string;
};

export type EditKindInfo = {
  kind: EditKind;
  label: string;
  heading: string;
  placeholder: string;
  example: string;
  exampleLabel: string;
  keepPlaceholder: string;
  defaultKeep: string;
  subject: string;
  scope: string;
  retention: string;
};

const KEEP_REMOVE = "the camera framing and movement, the lighting, the timing and every other person and object";
const KEEP_ADD = "the camera framing and movement, the lighting, the timing and every other person and object";
const KEEP_REPLACE = "the setting, the lighting, the timing, the camera framing and movement and every other person and object";
const KEEP_SCENE = "the people, their poses, clothing and motion, the camera framing and movement and the timing";
const KEEP_ATMOSPHERE = "the people, their poses, clothing and motion, the camera framing and movement, the timing and the composition of the scene";
const KEEP_STYLE = "the people, their poses and motion, the camera framing and movement, the timing and the composition of the scene";

export const EDIT_KIND_INFO: EditKindInfo[] = [
  {
    kind: "remove",
    label: "Remove",
    heading: "What should be removed?",
    placeholder: "e.g. the watermark in the top-right corner",
    example: "the watermark in the top-right corner",
    exampleLabel: "Remove a watermark",
    keepPlaceholder: "camera, lighting, timing, other people and objects",
    defaultKeep: KEEP_REMOVE,
    subject: "the target of the edit",
    scope: "The named element is completely gone in every frame, and the background and surfaces behind it continue naturally.",
    retention: "removed",
  },
  {
    kind: "add",
    label: "Add",
    heading: "What should be added?",
    placeholder: "e.g. a red sports car parked on the left",
    example: "a red sports car parked on the left",
    exampleLabel: "Add an object",
    keepPlaceholder: "camera, lighting, timing, other people and objects",
    defaultKeep: KEEP_ADD,
    subject: "the target of the edit",
    scope: "The added element appears consistently, at a believable size and position, with perspective, light and contact shadows that match the scene.",
    retention: "new",
  },
  {
    kind: "replace",
    label: "Replace an object",
    heading: "What should it become?",
    placeholder: "e.g. the grey van becomes a red sports car",
    example: "the grey van becomes a red sports car",
    exampleLabel: "Change a vehicle",
    keepPlaceholder: "setting, lighting, timing, camera, other people and objects",
    defaultKeep: KEEP_REPLACE,
    subject: "the target of the edit",
    scope: "The changed element keeps a consistent new look while following the motion, framing and timing of <Video 1>.",
    retention: "fully_preserved",
  },
  {
    kind: "scene",
    label: "Replace the background",
    heading: "What should the new background be?",
    placeholder: "e.g. a sunlit beach with turquoise water and palm trees",
    example: "a sunlit beach with turquoise water and palm trees",
    exampleLabel: "New background",
    keepPlaceholder: "people, their motion, camera framing and timing",
    defaultKeep: KEEP_SCENE,
    subject: "the new setting",
    scope: "The entire setting is replaced in every frame, including the edges; no part of the original background, crowd, walls or lighting remains.",
    retention: "replaced",
  },
  {
    kind: "atmosphere",
    label: "Change weather or light",
    heading: "What should the weather or light be?",
    placeholder: "e.g. a summer storm with dark clouds and one shaft of sunlight",
    example: "a summer storm with dark clouds and one shaft of sunlight",
    exampleLabel: "Storm light",
    keepPlaceholder: "people, their motion, camera framing, timing, composition",
    defaultKeep: KEEP_ATMOSPHERE,
    subject: "the new weather and light",
    scope: "The weather and the light change in every frame, while the people, their motion and the composition stay exactly as in <Video 1>.",
    retention: "changed",
  },
  {
    kind: "style",
    label: "Change the look",
    heading: "What should it look like?",
    placeholder: "e.g. a hand-painted anime style with soft outlines",
    example: "a hand-painted anime style with soft outlines",
    exampleLabel: "Anime look",
    keepPlaceholder: "people, their motion, camera framing, timing, composition",
    defaultKeep: KEEP_STYLE,
    subject: "the new look of the whole frame",
    scope: "The whole frame takes on the new look in every frame, while the people, their motion and the composition stay exactly as in <Video 1>.",
    retention: "changed",
  },
];

export function editKindInfo(kind: EditKind): EditKindInfo {
  return EDIT_KIND_INFO.find((info) => info.kind === kind) ?? EDIT_KIND_INFO[0];
}

export function editDefaultRole(kind: EditKind): EditRole {
  if (kind === "scene") return "background";
  if (kind === "atmosphere" || kind === "style") return "style";
  return "object";
}

// A reference picture only reaches the model through the prompt, so the target of the
// edit is tied to the matching picture explicitly. The user's own words stay untouched.
const EDIT_ANCHOR: Record<EditKind, string> = {
  remove: "The element to remove is the one shown in {picture}.",
  add: "The element to add is the one shown in {picture}.",
  replace: "The changed element is the one shown in {picture}.",
  scene: "The new setting is the one shown in {picture}.",
  atmosphere: "The new weather and light are shown in {picture}.",
  style: "The new look is the one shown in {picture}.",
};

const EDIT_ANCHOR_ROLE: Record<EditKind, EditRole> = {
  remove: "object",
  add: "object",
  replace: "object",
  scene: "background",
  atmosphere: "style",
  style: "style",
};

export const EDIT_ROLE_INFO: Array<{ role: EditRole; label: string; hint: string }> = [
  { role: "background", label: "New background", hint: "A picture of the setting that should replace the old background." },
  { role: "object", label: "Object look", hint: "A picture of how the changed or added object should look." },
  { role: "style", label: "Style", hint: "A picture whose look, colour or texture should carry over." },
  { role: "frame", label: "Edited source frame", hint: "A source frame repainted to show the edit. Only this role can be pinned." },
];

// "change the background to the image" carries no description of the target: the
// picture supplies the look, so the request has to be replaced by a description.
export function isBareImageRequest(change: string) {
  const text = change.trim().toLowerCase();
  if (!/\b(image|picture|photo)\b/.test(text)) return false;
  const stripped = text
    .replace(/\b(the|this|that|it)\b/g, " ")
    .replace(/\b(image|picture|photo)\b/g, " ")
    .replace(/\b(change|replace|swap|use|make|set|take|put|apply|please)\b/g, " ")
    .replace(/\b(background|scene|setting|video|clip|shot|to|with|as|into)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return stripped.length === 0;
}

function sentenceStart(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerStart(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function roleDefinition(role: EditRole, index: number, pinned: boolean) {
  const picture = `<Picture ${index + 1}>`;
  if (role === "background") return `${picture} is a reference image of the new background and setting.`;
  if (role === "object") return `${picture} is a reference image of the new appearance to use.`;
  if (role === "style") return `${picture} is a style reference image.`;
  return pinned
    ? `${picture} is a frame of the target video, exactly as the target video shows it at that moment.`
    : `${picture} is an edited source frame showing the target look.`;
}

function roleRetention(role: EditRole, index: number, pin: number | undefined) {
  const picture = `<Picture ${index + 1}>`;
  if (role === "frame" && pin !== undefined) {
    return `${picture} (target keyframe): fully_preserved - the target video passes through this exact frame at ${timecode(pin)}.`;
  }
  if (role === "frame") return `${picture} (edited source frame): reference - shows the target look; the model uses it for appearance, not as a fixed frame.`;
  if (role === "background") return `${picture} (background reference): reference - shows the new background; the model uses it for appearance, not as a fixed frame.`;
  if (role === "object") return `${picture} (object reference): reference - shows the new appearance to use; not a fixed frame.`;
  return `${picture} (style reference): reference - shows the target look; not a fixed frame.`;
}

export function buildEditPrompt(input: EditPromptInput) {
  const info = editKindInfo(input.kind);
  const refs = input.refs;
  const rawChange = input.change.trim();
  const caption = refs.find((ref) => ref.caption?.trim())?.caption?.trim();
  const bare = isBareImageRequest(rawChange);
  const useCaption = Boolean(caption) && (!rawChange || bare);
  const change = useCaption ? caption! : rawChange || caption || "the requested change";
  const keep = input.keep.trim() || info.defaultKeep;
  const style = input.style.trim();
  const end = timecode(Math.max(0, input.frames - 1));
  const anchors = refs
    .map((ref, index) => (ref.pin !== undefined ? `<Picture ${index + 1}> at ${timecode(ref.pin)}` : null))
    .filter((value): value is string => Boolean(value))
    .join(", ");

  const anchorIndex = (() => {
    if (refs.length === 0) return -1;
    const wanted = EDIT_ANCHOR_ROLE[input.kind];
    const match = refs.findIndex((ref) => ref.role === wanted);
    return match >= 0 ? match : 0;
  })();
  const anchor = anchorIndex >= 0 ? EDIT_ANCHOR[input.kind].replace("{picture}", `<Picture ${anchorIndex + 1}>`) : "";

  const referenceLines = refs
    .map((ref, index) => {
      const definition = roleDefinition(ref.role, index, ref.pin !== undefined);
      const described = ref.caption?.trim();
      if (!described || useCaption) return definition;
      return `${definition} It shows: ${described}`;
    })
    .join("\n");

  const retentionLines = refs.map((ref, index) => roleRetention(ref.role, index, ref.pin)).join("\n");

  const keepSentence = sentenceStart(keep);

  return `subject_definitions:
<Video 1> is the source video for the target video edit.
${referenceLines ? `${referenceLines}\n` : ""}<Subject 1> is the part of <Video 1> that the edit preserves: ${keep}.
<Subject 2> is ${info.subject}: ${change}.${anchor ? ` ${anchor}` : ""}

summary:
[video editing] The target video is an edited version of <Video 1>. The edit is this: ${change}.${anchor ? ` ${anchor}` : ""} ${info.scope} ${keepSentence} stay exactly as in <Video 1>.

retention_analysis:
<Video 1> (source video editing): partially_preserved - everything not named in <Subject 2> keeps its source appearance, timing, motion and framing.
${retentionLines ? `${retentionLines}\n` : ""}<Subject 1> (appears in [Shot 1]): fully_preserved - ${keep} keep the exact look, position and layout they have in <Video 1>.
<Subject 2> (appears in [Shot 1]): ${info.retention} - ${lowerStart(info.scope)}

detailed_description:
The target video is the source clip with this edit applied: ${change}.${anchor ? ` ${anchor}` : ""} ${info.scope} ${keepSentence} are unchanged.${style ? ` ${style}` : ""}
[Shot 1] From 00:00.000 to ${end}, the target video follows <Video 1> frame for frame, with this change applied throughout.${anchors ? ` The target video passes through ${anchors}.` : ""}
Everything not named in <Subject 2> keeps its source appearance, timing, motion and framing.

overall_soundscape:
${input.soundscape.trim() || "The source soundtrack continues throughout, including voices, ambience and the sounds of the action."}

non_diegetic_music:
N/A
`;
}
