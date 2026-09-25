# Master image prompt — History of Technology (animated)

One prompt architecture for every still in every episode. Built from `script.md`,
`script_long.md`, `research_notes.md` and the locked cast in `characters.md`.

**Model:** `gpt_image_2_5` · `aspect_ratio 16:9` (re-render heroes at `9:16` for Shorts) ·
`resolution 2k` · `quality medium` for scenes, `high` for reference sheets.
**Always attach both reference sheets** as `image_references`:
David `af70f6f0-691e-40f3-8191-19c379e90422` · Caw `93f98097-20ac-4e5a-bf5e-4b8d41d7e6ac`

---

## The full prompt (fill the [slots], keep everything else verbatim)

```
Stylized 3D animated family-adventure feature film still, high-end animation studio quality,
same characters exactly as in the reference sheets.

SETTING: [era] — [place], [time of day], [weather/atmosphere], [2-3 specific environment details
that are historically/biologically accurate for this place].

THE TOOL MOMENT: [the animal or person and exactly what they do with the tool, stated as the
research notes describe it — the object, how it is held, what it acts on, what comes out].
This action is the clear focal point of the frame, readable at a glance by a child.

DAVID: the ~13-year-old Stone Age explorer — tousled dark-brown hair up at the crown, big curious
eyes, expressive brows, long-sleeved tan deer-hide tunic, hide leggings, wrapped hide boots,
fibre belt with leather pouch, and his bright red woven wool scarf — [action verb: watching /
pointing / reaching / kneeling to look], [expression: wonder / delight / puzzled / determined].

CAW: the crow — blue-black feathers with a purple sheen, amber eyes, feather-tuft brows, one
scruffy feather on his head, thin red band on his left leg — [action], [attitude: smug /
jealous / curious / startled]. Caw is funny but never steals focus from the tool moment.

CAMERA: [shot size: wide / medium / close / macro], [angle: eye-level / low at ground level /
over-the-shoulder], [lens feel: wide-angle adventure / long-lens compressed], subject placed on
[left/right] third, clear negative space for on-screen text on the [opposite] side.

LIGHT & COLOUR: [key light: golden-hour sun / midday island sun / firelight / stone-lamp glow],
soft global illumination, gentle rim light on the characters, warm palette of ochre, amber,
sand and sky-teal, David's red scarf the strongest accent colour in frame, light atmospheric
haze, shallow cinematic depth of field.

MOOD: [one line — the emotional beat of the narration, e.g. "quiet wonder", "comic rivalry",
"the moment an idea is born"].

No text, no captions, no watermark, no logos, no modern objects, no extra characters,
original characters only, clean appealing anatomy, correct number of fingers and toes.
```

---

## Rules that come from the scripts

1. **The tool is the hero, not the cast.** Every Ep 01 beat is "an animal/person doing a specific
   thing with a tool". David and Caw *witness*; they are the audience's stand-ins.
2. **Stay factual.** Only show behaviour from `research_notes.md` (e.g. the finch holds a spine
   *lengthwise*, rejects twigs that are too short; the otter uses a flat stone on its chest as an
   anvil). If it isn't in the notes, don't draw it.
3. **Caw's running gag = the thesis.** Crows *use* tools; only humans *imagine* new ones.
   Caw copies, shows off, or is jealous — he never invents.
4. **Leave text room.** One third of the frame stays clean for captions/kickers from `scenes.json`.
5. **Avoid filter trips on David:** describe outfit and actions, never body/skin/pose-of-body words.
   (See `characters.md`.)

## Video (image → video)

`kling3_0`, `mode std`, `sound off`, `start_image` = the approved still. Duration = narration
length + ~1s. Prompt: one sentence of main action, one of character acting, one of camera move,
then "characters stay on-model, smooth natural animation, no text."
