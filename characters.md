# Series bible — characters & look

Applies to every episode of the History of Technology channel.

## Look
**Stylized 3D animated family-adventure film.** Warm, saturated, soft rounded shapes, golden light.
Not photoreal (rejected Ep 01 first pass as "too realistic").

Image model: `gpt_image_2_5`, 16:9, `resolution: 2k`
- `quality: medium` (1 credit) for scene stills · `quality: high` (2.75) for reference sheets

## Cast (locked)

### David — lead
Stone Age explorer, **~13 years old**, lanky, big curious eyes, expressive brows, lopsided grin,
tousled dark-brown hair sticking up at the crown.
Outfit: long-sleeved tan deer-hide knee-length tunic, brown hide leggings, wrapped hide boots,
braided plant-fibre belt with a small leather hip pouch, **red woven wool scarf** with frayed ends
(signature — carries through every era, even when the rest of the outfit changes).
- Reference sheet: `af70f6f0-691e-40f3-8191-19c379e90422`

### Caw — crow sidekick
Blue-black feathers with a purple-blue sheen, oversized dark-grey beak, large amber eyes with
feather-tuft brows, **one scruffy feather on top of the head**, **thin red wool band on the left leg**
(matches David's scarf). Clever, a little smug. Running gag: crows *use* tools but can't *imagine* new ones.
- Reference sheet: `93f98097-20ac-4e5a-bf5e-4b8d41d7e6ac`

## Scene prompt template
Pass **both** reference sheets as `image_references`, then:

```
Stylized 3D animated adventure film still, same characters exactly as in the reference sheets.
[SCENE: where, what the animal/tool is doing]. David, the Stone Age explorer with the red wool
scarf, [ACTION/EXPRESSION]. Caw the crow (blue-black, amber eyes, scruffy head feather, red band
on left leg) [ACTION/EXPRESSION]. [CAMERA], [LIGHT], family adventure film look, no text.
```

## Content-filter lessons
- A **young child** lead (~9) was blocked on every reference sheet → lead aged up to ~13. Keep him there.
- Avoid body/skin/pose wording on David ("slim body", "bare arms", "skin", "sits with knees up").
  Describe outfit and actions (standing, pointing, crouching to look) instead.
- Blocked jobs are not charged; reword and retry once rather than repeatedly.

## Narrator
**Arthur** — `seed_audio`, voice_type `preset`, voice_id `30fc8796-ceb6-4a66-b3a7-4a145ef7f346`, `speech_rate 15`.
(Dylan `b847bc29-…` was used by mistake on the first mixes of scenes 1–2; replaced.)
Write pauses as commas, not "…" (ellipses produce 2–3s gaps). After generating, cap silences at
0.45s (ffmpeg `silenceremove`, −45 dB) and loudness-normalise to −16 LUFS before muxing.
Fit rule: stretch video up to 1.3×, then hold the last frame; lead-in 0.3s, tail 0.3s.
Auditioned and not chosen: Dylan, Isla, Knox.

## David's voice
**Bram** — `seed_audio`, voice_type `preset`, voice_id `549ff70a-3ee7-4f04-a4d9-89a24fab7709`, `speech_rate 10`.
Chosen by the user. No preset voices are tagged as children; if Bram ever reads too old,
raise `pitch_rate` (+2 to +3) rather than switching voice.
Also auditioned for David: Benji +3 pitch (69891cff…), Cody +3 pitch (f748c546…).
