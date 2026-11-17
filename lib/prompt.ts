export type PromptInput = {
  description: string;
  role: string;
  action: string;
  refCount: number;
  pins: number[];
  frames: number;
  soundscape: string;
  direct?: boolean;
};

export function timecode(frame: number) {
  const seconds = frame / 24;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

export function buildPrompt(input: PromptInput) {
  const description = input.description.trim() || "a new character with the same build and pose as the person in the source";
  const role = input.role.trim() || "the main person";
  const action = input.action.trim();
  const pictures = Array.from({ length: input.refCount }, (_, i) => `<Picture ${i + 1}>`);
  const pictureList = pictures.length === 1 ? pictures[0] : `${pictures.slice(0, -1).join(", ")} and ${pictures.at(-1)}`;
  const anchors = input.pins.map((pin, i) => `<Picture ${i + 1}> at ${timecode(pin)}`).join(", ");
  const referenceLine = input.direct
    ? `${pictureList} ${input.refCount === 1 ? "is a character reference image" : "are character reference images"} of the new character.`
    : `${pictureList} ${input.refCount === 1 ? "is a frame" : "are frames"} of the target video, painted from the source.`;
  const retentionNote = input.direct
    ? "a picture of the new character; it fixes who <Subject 1> is"
    : "a frame of the target video; it fixes who <Subject 1> is";
  const actionLine = action
    ? ` The action, timing and camera stay exactly as in <Video 1>: ${action}`
    : " The action, timing, camera movement and framing stay exactly as in <Video 1>.";

  return `subject_definitions:
<Video 1> is the source video for the character replacement: one continuous shot. ${referenceLine}
<Subject 1> is ${description}. <Subject 1> replaces ${role} in <Video 1> and is the only thing that changes.

summary:
[video editing + character replacement] The target video is an edited version of <Video 1> in which ${role} becomes <Subject 1>, looking exactly as in ${pictureList}. Everything else in <Video 1> is unchanged.${actionLine}

retention_analysis:
<Video 1> (source video editing): fully_preserved - the shot, the camera framing and movement, the setting, the lighting, the timing, the background and every other person are copied frame for frame.
${pictures.map((picture, i) => `${picture} (appears in [Shot 1]): reference - ${retentionNote}${input.pins[i] !== undefined ? ` at ${timecode(input.pins[i])}` : ""}.`).join("\n")}
<Subject 1> (appears in [Shot 1]): fully_preserved - ${description} stays identical in every frame.

detailed_description:
The target video is the same scene as <Video 1> with ${role} replaced by <Subject 1>, who looks exactly as in ${pictureList}.
[Shot 1] At 00:00.000 the shot opens with <Subject 1> in the same place, pose and framing as ${role} in <Video 1>.${actionLine}${anchors ? ` The painted keyframes are ${anchors}.` : ""}
From the first frame to the last, ${role} is this same <Subject 1> exactly as in ${pictureList}; no trace of the original person remains. Every other element of <Video 1> is unchanged.

overall_soundscape:
${input.soundscape.trim() || "The source soundtrack continues throughout, including voices, ambience and the sounds of the action."}

non_diegetic_music:
N/A
`;
}
