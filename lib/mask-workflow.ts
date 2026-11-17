import { SAM_CHECKPOINT, UI_FRAME_SIZE } from "./config.ts";
import { dateStamp } from "./datetime.ts";
import { MASK_MARGINS } from "./margins.ts";
import type { ManualPoint, MaskMargin, SelectionMode } from "./types.ts";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }>;

export function buildMaskGraph(options: {
  clipInput: string;
  frames: number;
  mode: SelectionMode;
  target: string;
  point?: ManualPoint;
  width: number;
  height: number;
  key: string;
  margin: MaskMargin;
}) {
  const graph: Graph = {};
  const stamp = dateStamp();
  const looseness = MASK_MARGINS[options.margin];
  const add = (id: string, class_type: string, title: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs, _meta: { title } };
    return id;
  };

  add("1", "VHS_LoadVideo", "Source clip (24 fps)", {
    video: options.clipInput,
    force_rate: 24,
    custom_width: 0,
    custom_height: 0,
    frame_load_cap: options.frames,
    skip_first_frames: 0,
    select_every_nth: 1,
    format: "None",
  });
  add("2", "CheckpointLoaderSimple", "SAM 3.1", { ckpt_name: SAM_CHECKPOINT });
  add("3", "ImageScaleToMaxDimension", "Frames for masking", {
    upscale_method: "area",
    largest_size: UI_FRAME_SIZE,
    image: ["1", 0],
  });

  let trackId: string;
  if (options.mode === "prompt") {
    add("4", "CLIPTextEncode", "Character prompt", { text: options.target || "person", clip: ["2", 1] });
    trackId = add("5", "SAM3_VideoTrack", "Track the character", {
      detection_threshold: 0.35,
      max_objects: 8,
      detect_interval: 1,
      images: ["3", 0],
      model: ["2", 0],
      conditioning: ["4", 0],
    });
  } else {
    const point = options.point ?? { x: 0.5, y: 0.5 };
    add("4", "ImageFromBatch", "First frame", { image: ["1", 0], batch_index: 0, length: 1 });
    add("5", "SAM3_Detect", "Segment the clicked character", {
      model: ["2", 0],
      image: ["4", 0],
      positive_coords: JSON.stringify([{ x: Math.round(point.x * options.width), y: Math.round(point.y * options.height) }]),
      negative_coords: "",
      threshold: 0.5,
      refine_iterations: 2,
      individual_masks: false,
    });
    trackId = add("6", "SAM3_VideoTrack", "Track the character", {
      detection_threshold: 0.35,
      max_objects: 1,
      detect_interval: 1,
      images: ["3", 0],
      model: ["2", 0],
      initial_mask: ["5", 0],
    });
  }

  add("7", "H3PeopleMask", "Character mask", {
    track_data: [trackId, 0],
    headroom: looseness.headroom,
    hold_frames: 2,
    max_people: 1,
  });
  add("13", "GrowMaskWithBlur", "Loosen the mask", {
    expand: looseness.expand,
    incremental_expandrate: 0,
    tapered_corners: true,
    flip_input: false,
    blur_radius: looseness.blur,
    lerp_alpha: 1,
    decay_factor: 1,
    fill_holes: true,
    mask: ["7", 0],
  });
  add("8", "MaskToImage", "Mask image", { mask: ["13", 0] });
  add("9", "SaveImage", "Save masks", { images: ["8", 0], filename_prefix: `viggle-studio/${options.key}/mask-${stamp}` });
  add("10", "SaveImage", "Save frames", { images: ["3", 0], filename_prefix: `viggle-studio/${options.key}/frame-${stamp}` });
  add("11", "ImageAndMaskPreview", "Mask overlay", {
    mask_opacity: 0.45,
    mask_color: "0, 200, 255",
    pass_through: true,
    image: ["3", 0],
    mask: ["13", 0],
  });
  add("12", "VHS_VideoCombine", "Mask preview", {
    frame_rate: 24,
    loop_count: 0,
    filename_prefix: `viggle-studio/${options.key}/preview-${stamp}`,
    format: "video/h264-mp4",
    pix_fmt: "yuv420p",
    crf: 19,
    save_metadata: false,
    trim_to_audio: false,
    pingpong: false,
    save_output: false,
    images: ["11", 0],
  });

  return graph;
}
