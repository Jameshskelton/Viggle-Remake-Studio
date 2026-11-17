import { CUTOUT_MODEL } from "./config.ts";
import { dateStamp } from "./datetime.ts";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }>;

export function buildCutoutGraph(options: { imageInput: string; key: string; model?: string }) {
  const graph: Graph = {};
  const stamp = dateStamp();
  const add = (id: string, class_type: string, title: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs, _meta: { title } };
    return id;
  };

  add("1", "LoadImage", "Character image", { image: options.imageInput });
  add("2", "easy imageRemBg", "Remove background", {
    images: ["1", 0],
    rem_mode: options.model ?? CUTOUT_MODEL,
    image_output: "Hide",
    save_prefix: `viggle-studio/${options.key}/cutout-${stamp}`,
    torchscript_jit: false,
    add_background: "none",
    refine_foreground: false,
  });
  add("3", "SaveImage", "Save cutout", {
    images: ["2", 0],
    filename_prefix: `viggle-studio/${options.key}/cutout-${stamp}`,
  });

  return graph;
}
