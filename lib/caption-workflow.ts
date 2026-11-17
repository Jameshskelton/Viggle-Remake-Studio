import { CAPTION_MODEL } from "./config.ts";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }>;

export function buildCaptionGraph(options: { imageInput: string }) {
  const graph: Graph = {};
  const add = (id: string, class_type: string, title: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs, _meta: { title } };
    return id;
  };

  add("1", "LoadImage", "Reference image", { image: options.imageInput });
  add("2", "Florence2ModelLoader", "Florence2 prompt generator", {
    model: CAPTION_MODEL,
    precision: "bf16",
    attention: "sdpa",
  });
  add("3", "Florence2Run", "Describe the image", {
    image: ["1", 0],
    florence2_model: ["2", 0],
    text_input: "",
    task: "more_detailed_caption",
    fill_mask: true,
    max_new_tokens: 512,
    num_beams: 3,
    do_sample: false,
  });
  add("4", "PreviewAny", "Caption text", { source: ["3", 2] });

  return graph;
}
