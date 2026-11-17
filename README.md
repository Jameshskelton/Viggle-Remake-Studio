# Viggle Remake Studio

A local web app for character swapping and video editing, powered by [Viggle Remake](https://huggingface.co/Viggle/Viggle-Remake) on your own GPU. The **Swap character** tab masks a person with SAM 3.1 and recasts them; the **Edit video** tab removes, adds or changes objects, weather, light, setting or style. Both re-shoot the shot while keeping the camera, cuts, motion, timing and soundtrack.

Everything runs locally: Next.js is only the UI and orchestrator; ComfyUI does the segmentation and the MiniMax H3 / Viggle Remake render.

## Pipeline

```
video ──► SAM 3.1 track (prompt or click) ──► mask per frame
                                                   │
character image ────────────────────────────► painted keyframes (1–4, clipped by the mask)
                                                   │
                                     six-section prompt + pins
                                                   │
                                  Viggle Remake (swap) in ComfyUI ──► MP4 + source audio
```

The **Edit video** tab uses the same render path with the edit LoRA instead of the swap LoRA:

```
video ──► choose window ──► 1–4 target frames (painted/generated) + optional pins
                                                   │
                                     six-section edit prompt
                                                   │
                                  Viggle Remake (edit) in ComfyUI ──► MP4 + source audio
```

Viggle Remake does not accept a mask directly. It takes **painted frames** (1–4 images showing the target), optional **pins** (the source frame each painted frame was made from), and a six-section prompt. The swap tab turns your mask and character image into those keyframes; the edit tab takes target frames you upload.

## Requirements

- An NVIDIA GPU with enough VRAM for the weights you choose. The tested path is the merged int8 transformer plus the int4 text encoder; a 24 GB card can run 832×480, an 80 GB card can use bf16 + LoRA.
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 0.42 or newer. Core provides MiniMax H3 and SAM 3.1.
- `ffmpeg` and `ffprobe` on `PATH`.
- Node.js 22.6 or newer.

### ComfyUI custom nodes

Install into `ComfyUI/custom_nodes` and restart ComfyUI:

| Pack | Used for |
| --- | --- |
| [ComfyUI-Viggle-Remake](https://huggingface.co/Viggle/Viggle-Remake/tree/main/comfyui/ComfyUI-Viggle-Remake) | `RemakeConditioning`, `RemakeKeyframeUntil`, `RemakeNoise` |
| [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | loading the clip, preview video |
| [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | `ImageAndMaskPreview`, `GrowMaskWithBlur` |
| [ComfyUI-Easy-Use](https://github.com/yolain/ComfyUI-Easy-Use) | `easy imageRemBg` background removal for character images |
| [ComfyUI-Florence2](https://github.com/kijai/ComfyUI-Florence2) | `Florence2Run` for the optional **Describe image** button in the edit tab |
| [comfyui-h3-oneclick-swap](https://github.com/D3voz/comfyui-h3-oneclick-swap) | `H3PeopleMask` |

The Viggle pack lives in the model repository. Download just that folder:

```bash
hf download Viggle/Viggle-Remake --include "comfyui/*" --local-dir ./viggle-remake
cp -r viggle-remake/comfyui/ComfyUI-Viggle-Remake ComfyUI/custom_nodes/
```

### Models

The app defaults to the merged int8 swap file (the documented small-GPU path). Put these in ComfyUI's model folders. Every default below can be overridden at runtime in the **Advanced** tab:

| Folder | File | Source |
| --- | --- | --- |
| `models/diffusion_models` | `viggle_remake_swap_pruned_int8_convrot.safetensors` | `Viggle/Viggle-Remake` → `int8/` (~21 GB) |
| `models/diffusion_models` | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `Comfy-Org/MiniMax-H3` (~20 GB) |
| `models/loras` | `viggle_remake_edit_comfyui.safetensors` | `Viggle/Viggle-Remake` → `comfyui/` (~3.8 GB) |
| `models/text_encoders` | `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` (or your int4/nvfp4 file) | `Comfy-Org/MiniMax-H3` (~27 GB, 16 GB nvfp4) |
| `models/vae` | `minimax_h3_video_vae_int8_convrot.safetensors` | `Comfy-Org/MiniMax-H3` (~2.8 GB) |
| `models/vae` | `minimax_h3_audio_vae_fp32.safetensors` | `Comfy-Org/MiniMax-H3` (~0.6 GB) |
| `models/checkpoints` | `sam3.1_multiplex_fp16.safetensors` | SAM 3.1 |
| `models/LLM` | `Florence-2-large-PromptGen-v2.0/` | `microsoft/Florence-2-large-PromptGen-v2.0` (optional, for **Describe image**) |

The edit tab uses `minimax_h3_fl2va_pruned_int8_convrot.safetensors` with `viggle_remake_edit_comfyui.safetensors` and the edit sigmas from the model card. Do not stack the edit LoRA on the merged swap file.

The `.env.local` used on the machine this was built on points at its installed files; the encoder there is `qwen3vl_32b_minimax_h3_int4_convrot.safetensors`. Set `VIGGLE_TEXT_ENCODER` to whichever encoder you downloaded. The default in `.env.example` uses that smaller int4 name; the official `int8_convrot` and `nvfp4_awq` files work the same way.

Download the merged transformer:

```bash
hf download Viggle/Viggle-Remake \
  --include "int8/viggle_remake_swap_pruned_int8_convrot.safetensors" \
  --local-dir ./viggle-int8
mv viggle-int8/int8/viggle_remake_swap_pruned_int8_convrot.safetensors ComfyUI/models/diffusion_models/
```

Download the edit LoRA for the **Edit video** tab:

```bash
hf download Viggle/Viggle-Remake \
  --include "comfyui/viggle_remake_edit_comfyui.safetensors" \
  --local-dir ./viggle-edit
mv viggle-edit/comfyui/viggle_remake_edit_comfyui.safetensors ComfyUI/models/loras/
```

If you have the bf16 files instead, use the base model + LoRA path: set `VIGGLE_BASE_MODEL`, `VIGGLE_LORA` (the ComfyUI repack `viggle_remake_swap_comfyui.safetensors`), and the matching bf16/fp16 encoders and VAEs in `.env.local`, or pick them in the **Advanced** tab. Do not stack the LoRA on the merged int8 file.

The header badges report **capability readiness** (Swap, Edit, Mask, Cutout, Describe image) rather than raw model lists. Hover a red badge to see the missing files or nodes. If a name is different on your machine, change the `VIGGLE_*`, `SAM_CHECKPOINT` or `CAPTION_MODEL` variables. The swap/edit diffusion models, text encoder, VAEs and LoRAs can also be changed live from the **Advanced** tab.

## Run

```bash
git clone <this repo> viggle-remake-app
cd viggle-remake-app
cp .env.example .env.local
npm install
```

Set `.env.local`:

```dotenv
COMFYUI_URL=http://127.0.0.1:8188
# Same-machine fast path. Leave empty to upload through ComfyUI's /upload/image.
COMFYUI_INPUT_DIR=/path/to/ComfyUI/input
DATA_DIR=./data

VIGGLE_DIFFUSION_MODEL=viggle_remake_swap_pruned_int8_convrot.safetensors
VIGGLE_TEXT_ENCODER=qwen3vl_32b_minimax_h3_int4_convrot.safetensors
VIGGLE_VIDEO_VAE=minimax_h3_video_vae_int8_convrot.safetensors
VIGGLE_AUDIO_VAE=minimax_h3_audio_vae_fp32.safetensors

# Edit tab: base transformer + edit LoRA.
VIGGLE_EDIT_BASE_MODEL=minimax_h3_fl2va_pruned_int8_convrot.safetensors
VIGGLE_EDIT_LORA=viggle_remake_edit_comfyui.safetensors

# Optional: Florence2 model for Describe image.
CAPTION_MODEL=Florence-2-large-PromptGen-v2.0

# Character-image background removal (ComfyUI-Easy-Use).
BACKGROUND_REMOVAL_MODEL=RMBG-1.4
BACKGROUND_REMOVAL_PADDING=0.12
```

Start ComfyUI, then the app:

```bash
# terminal 1
cd ComfyUI
AIOHTTP_NOSENDFILE=1 ./venv/bin/python main.py --listen 127.0.0.1 --port 8188

# terminal 2
cd viggle-remake-app
npm run dev        # http://127.0.0.1:3000
```

For production:

```bash
npm run build
npm start
```

`COMFYUI_INPUT_DIR` is the fastest route: trimmed clips and painted keyframes are copied straight into ComfyUI's input folder. When it is empty, the app uploads them through ComfyUI's `/upload/image` endpoint instead.

## Tests

```bash
npm test
```

The suite uses Node's built-in test runner (no extra dependencies). It covers the six-section edit prompt builder (including bare image requests, per-kind defaults, reference roles and captions), keyframe-hold presets, job-status reconciliation, atomic job storage and finalization deduplication, storage cleanup (assets, clips and ComfyUI folders), draft persistence, model settings, multiple-LoRA chains, sampling-step schedules, stored-render, clip-cache and full-data deletion, the render graph's model wiring, and the shared render-validation helpers.

## Using it

Each workspace is a four-step wizard. The step links at the top, the **Back**/**Next** buttons at the bottom, and the browser's back/forward buttons all move between steps without losing your work. Steps are addressable: `/?step=2` and `/edit?step=3` open that step directly.

### Queue, progress and cancel

The header shows how many jobs are running and queued. While a job runs, its status area shows a progress bar of the sampling steps with an approximate time remaining; queued jobs show their queue position. Before sampling starts, the bar is indeterminate (the clip and models are loading).

Every queued or running job has a **Cancel** button. Cancelling calls ComfyUI's queue delete and interrupt, so it works whether the job is still waiting or already running. The job is kept in **Renders** marked `cancelled`.

### Renders

The **Renders** tab lists every render newest first, including ones started before a reload. Active renders refresh on their own. For each render you can:

- watch and download the MP4;
- **Use as source** to start the next run from that result;
- **Reuse settings** to restore its source window, seed, size, prompt and references.

Use **Show older renders** to widen the list beyond the newest 60. Finished videos are copied into `data/assets/` when they complete, so they survive ComfyUI clearing its own output folder. Renders finished before this existed only stay available while ComfyUI still has the file.

**Delete all stored renders** removes every finished, failed or cancelled swap/edit job, its archived result video, its cached source clip and its unreferenced `viggle-studio` ComfyUI folders. Active jobs, source clips, reference images and assets referenced by an open draft are kept.

### Storage

The **Storage** tab shows how much space the app and ComfyUI use. **Clean unused files** removes assets that no job or open draft references and are older than 24 hours, plus cached clips older than the selected age. Drafts in the current browser are kept; job records and the Renders history are not deleted. Enable **Also remove orphaned ComfyUI input/output folders** to delete `viggle-studio/<key>` folders that no job references. Clean up leaves job records alone; use **Stored renders** for those. **Clear all cached clips** removes the rest of the clip cache immediately; source trims are rebuilt automatically when needed.

The **Stored renders** card lists previous swap and edit jobs. **Delete** removes one job, its archived result video, its cached source clip and its unreferenced ComfyUI folders; **Delete all swaps** and **Delete all edits** do the same for every finished, failed or cancelled job of that mode. Active jobs and assets used by an open draft are kept. Clips still used by a remaining mask job are kept.

**Delete everything** is the clean-slate action: type `DELETE` to remove every uploaded asset, painted frame, archived render, cached clip and job record, plus the app's ComfyUI `viggle-studio` folders if the option is enabled. It refuses while a render or mask job is active. Model settings are kept unless **Also reset model settings** is checked. It also clears this browser's drafts, active-run markers and pending hand-offs.

### Advanced settings

The **Advanced** tab picks the models and sampling used by new renders:

- **Swap diffusion model** — the merged Viggle Remake swap transformer. When the swap LoRA list is empty, this is the only model loaded.
- **Swap LoRAs** — optional. Add one or more LoRAs with individual strengths; they are applied in order on top of the **Swap base model** instead of the merged transformer.
- **Edit base diffusion model** and **Edit LoRAs** — the base MiniMax H3 transformer and an optional chain of Viggle Remake edit LoRAs. An empty list runs the base model alone.
- **Sampling steps** — separate counts for swap and edit, from 1 to 16. Six matches the model card's sigma schedule; other counts resample the same curve. The render step shows how many steps the selected composition-guidance preset holds at the current count.
- **Text encoder**, **Video VAE** and **Audio VAE** — shared by both modes.

The choices are written to `data/settings.json` and apply immediately to new renders; running or queued jobs keep the models they started with. The lists come from ComfyUI, so a model must already be installed before it can be selected. The `VIGGLE_*` environment variables only supply the initial defaults. Saved overrides are reflected in the header capability badges.

Large uploads show a progress bar instead of an indefinite spinner.

### Resume

Each workspace remembers its draft and last render in the browser. Reloading restores the source clip and window, the reference images with their roles and descriptions, the instructions and style fields, the prompt, seed, frame count and (for swaps) painted keyframes and mask job. A long-running render can also be watched again after a refresh; starting one and closing or reloading the tab does not lose it.

1. **Source clip** — drop a video. The app probes it, picks the longest valid window that fits (or `90` frames for very short clips), and trims the source to exactly that many frames. Choose another frame count at any time, scrub to the start frame, or press **Fit to video**. If the selected window is longer than the source, the source is looped automatically; if the start frame is past the end, it clamps to the last valid window. Viggle Remake still requires one window of `17n+5` frames at 24 fps (3.75–14.4 s).
2. **Character** — add a picture and describe the new character. **Remove background with ComfyUI** runs a matting pass on the upload and stores a transparent PNG with padding around the subject; turn it off to use the picture as-is. The first run downloads the configured matting model into ComfyUI. Choose **By prompt** (SAM tracks `person`, `the dancer`, `a man in a red hoodie`, …) or **By clicking** (click the character's torso on the first frame). Choose **Mask margin**: **Loose** (default) grows SAM3's area well beyond the tight silhouette so the character has room, **Normal** is in between, and **Tight** hugs the person. Press **Mask the character** and check the cyan preview. Changing the margin clears the current mask; run it again.
3. **Character reference** — choose **Direct image** (default) to use the clean character picture itself as `<Picture 1>`, with no keyframes and no pins; the source clip supplies the pose, camera, cuts and timing. The optional **Painted keyframes** mode instead lets you pick 1–4 source frames where the character image is clipped to the grown SAM3 mask, then adjust scale and X/Y. Each painted editor saves automatically. Painted keyframes need a mask; direct images do not.
4. **Render** — edit the prefilled six-section MiniMax H3 prompt, choose 480p or 736p, pick a seed, and run. Progress and the finished MP4 appear in the same card.

In **Painted keyframes** mode, two frames (near the start and end of the shot) are a good default. Add more when the character turns or when a second character enters.

### Editing a video

Use the **Edit video** tab for everything that is not a character recast: remove or add objects, change the setting, weather or light, or restyle the shot.

1. **Source clip** — same trim, frame-count and start-frame controls as the swap tab.
2. **Edit request** — pick the kind of edit (**Remove**, **Add**, **Replace an object**, **Replace the background**, **Change weather or light**, **Change the look**), then describe the result in your own words. Your words are used verbatim in the prompt. **Preserve** and **Style / look** are optional; leave them empty to use sensible defaults for the edit kind.
3. **Reference images (optional)** — upload up to four pictures and give each one a role: **New background**, **Object look**, **Style**, or **Edited source frame**. The role decides how the picture is described to the model. With no image, the app uses a source frame as the model's required reference and your instruction carries the edit.
   - A background or style picture is described automatically (Florence2) when you upload it, and that description becomes the target of the edit. **Describe image** does the same on demand, and its description can also be used as the instruction.
   - Only edited source frames can be pinned, and pinning needs every reference to be one.
   - The picture and the instruction are linked in the prompt: the target is tied to the picture that shows it ("the new setting is the one shown in `<Picture 1>`"). A request like "change the background to the image" is replaced by the picture's description, because the model needs a description of the target rather than an instruction.
4. **Render** — the six-section prompt is generated from the request. Pick 480p or 736p, a seed, pin mode and composition guidance, then run.

For **Replace the background**, describe the new setting in words as well as uploading a picture of it. The prompt states that the whole setting is replaced and that no part of the original background remains, so the edit is not silently ignored.

The tab loads the `minimax_h3_fl2va_pruned_int8_convrot.safetensors` base with `viggle_remake_edit_comfyui.safetensors` and the edit sigmas from the model card. The model's own remove-the-turbines example renders through this path.

### Motion vs likeness

**Direct image** never pins anything, so the source motion always wins. **Painted keyframes** can give a stronger likeness/composition, but they are pinned and held for a while, which can freeze the target's pose. In that mode the app gives two controls in **Render**:

- **Composition guidance** — **Light**, **Normal** and **Strong**. Viggle Remake drops a pinned frame once sigma falls below the threshold, so *more* guidance keeps the pinned frame for *more* of the render. At the default 6-step schedule, Light holds it for 2 steps, Normal for 4 and Strong for all 6; the render step recomputes these counts when you change the sampling steps in **Advanced**. Normal (0.90) is the model card default.
- **References only** — no pins at all: the references set identity/look while the source drives the motion and timing.

If a render looks static, switch to **Direct image**, choose **Light** composition guidance, or use **References only**.

### The prompt

The six-section prompt is generated from the fields above and stays in step with them. **Edit manually** turns it into a manual override: while a manual prompt is active the app says so, and changes to the fields are not applied to it until you **Rebuild from fields** or **Return to automatic**.

## How it works

- **Cutout job (optional):** the uploaded character image goes to `LoadImage → easy imageRemBg → SaveImage`. The matte is saved as an RGBA PNG, padded with transparent negative space, and registered as a new character asset. The original upload is kept so you can switch back.
- **Mask job:** `VHS_LoadVideo → SAM3_VideoTrack` (text conditioning, or `SAM3_Detect` point → `initial_mask`) `→ H3PeopleMask → GrowMaskWithBlur`. The mask is saved per frame, along with the frames themselves and a cyan overlay preview.
- **Paint (optional):** in **Painted keyframes** mode the browser loads the frame and grown mask, fits the character image's opaque bounds into the mask bounding box, clips it with the mask alpha, and uploads the resulting PNG. This is a deterministic composite, not a generative repaint. The mask margin controls how far the clip extends past the tight silhouette. **Direct image** mode skips this entirely and sends the character picture as the one reference.
- **Render job:** `Viggle Remake Conditioning` receives the clip, soundtrack, 1–4 reference images, optional pins, prompt, frame count and short edge. Direct mode sends one reference and no pins. Painted-keyframe mode uses `RemakeKeyframeUntil` to hold pinned poses until the selected sigma, and **References only** leaves `pins` empty. The render route requires all six prompt sections and only checks pin positions when pinning is on. The seed is woven through `RemakeNoise`. Swap renders use the merged swap file or the swap base plus the LoRA chain; edit renders use the `fl2va` base plus the edit LoRA chain. Sigma schedules are resampled from the model-card 6-step curves to the configured step count (default 6).
- **Edit job:** the same render path with `mode=edit`. The reference images are the optional target look (with no reference, the first source frame is used), each with a role that decides how it is described, and the optional pins are per reference. `lib/edit-prompt.ts` builds the six-section prompt from the edit kind, the user's own words (used verbatim), the preserve list, the reference roles and their descriptions. **Describe image** runs Florence2 on a reference and offers its caption as a suggestion or as the picture's description.
- **Caption job:** `LoadImage → Florence2ModelLoader → Florence2Run → PreviewAny` turns a reference picture into a written description for the edit prompt.
- **Prepared clips:** the trimmed 24 fps working clip is content-addressed by source asset, start, frame count and audio. Repeating a mask or render with the same window reuses that encode instead of running ffmpeg again.
- **Job records** are written atomically. A completed job is finalized once: concurrent status polls share the same finalization, so a render or cutout is only downloaded/imported once. A temporary ComfyUI history or queue failure keeps the job running instead of marking it failed.
- Jobs are recorded under `data/jobs/`; uploads and painted frames under `data/assets/`; trimmed working clips under `data/clips/`.

## Limits

- Swap: one character per run (the largest tracked match). Edit: one change per prompt; describe the target look fully.
- Edit renders can be text-only: the app supplies a source frame as the required reference. A reference image that shows the target look improves object/setting changes.
- One Viggle Remake window per run (3.75–14.4 s). Cuts inside the window follow the source clip; painted keyframes can pin around them. For whole films, run sections. Arbitrary source lengths are handled automatically: the app trims to the selected frame count and loops the source when it is shorter than the window.
- Mirrors and reflections are not supported in swap mode; the reflection keeps the original person.
- The soundtrack is carried through, not generated. A silent source gives a silent result.
- The composite keyframes are deliberately simple. For a better likeness, use a clean, well-lit character picture and adjust scale/position, or edit the painted keyframes externally before rendering.
- If the new character keeps getting cut off, choose the **Loose** mask margin in step 02 and re-mask, or lower **Scale**. The mask margin is baked into the saved mask, so re-running the mask is required after changing it.

## Licensing and attribution

The app code is MIT. Model weights are separate.

- **Powered by Viggle Remake** — [Viggle/Viggle-Remake](https://huggingface.co/Viggle/Viggle-Remake). The weights are a derivative of MiniMax H3 under the [MiniMax H3 Community License](https://huggingface.co/Viggle/Viggle-Remake/blob/main/LICENSE). Commercial products must display **MiniMax H3** prominently, include the license and NOTICE, and mark modified files.
- Only remake footage you have the right to change. **The identity comes from the character image you provide** (and any frames you paint). Do not put people into footage they did not agree to appear in, and label generated video as AI-generated.
