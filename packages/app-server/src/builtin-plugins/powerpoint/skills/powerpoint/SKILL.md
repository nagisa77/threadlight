---
name: powerpoint
description: Create, inspect, edit, convert, and verify PowerPoint presentations, including slide structure, layouts, themes, charts, images, speaker notes, and rendered visual quality. Use whenever a .pptx, .ppt, or presentation deck is an input or deliverable.
---

# PowerPoint

Produce a real, presentation-ready deck. Treat slides as a visual narrative,
not a document split across pages.

## Workflow

1. Establish the audience, purpose, setting, duration, aspect ratio, language,
   and deliverable. Confirm whether to create, edit, restyle, summarize,
   translate, or convert a deck, and preserve the source unless overwrite was
   explicitly requested.
2. Inspect the source material and any existing deck: slide order, layouts,
   masters, theme, fonts, colors, placeholders, notes, charts, media,
   transitions, and hidden slides.
3. Build a concise story before editing individual slides. Give each slide one
   job and one takeaway; remove repetition and make the sequence easy to
   present aloud.
4. Read `references/tooling.md`, then use the least destructive implementation
   path. Reuse a provided template's masters, layouts, theme, and spacing.
5. Create or edit content using deliberate hierarchy, alignment, contrast, and
   restrained visual density. Prefer diagrams, charts, and meaningful images
   over walls of text when they clarify the message.
6. Render and inspect every changed slide using
   `references/quality-checks.md`. Fix overflow, clipping, collisions,
   unreadable text, inconsistent spacing, and broken media before handoff.
7. Return the artifact path and summarize the story, material edits, visual
   validation performed, and any feature that could not be preserved.

## Presentation rules

- Never rename another file type to `.pptx`; create a valid Office Open XML
  presentation.
- Do not silently replace or remove masters, layouts, theme fonts, notes,
  hyperlinks, animations, transitions, embedded media, or hidden slides.
- Use short, assertive slide titles and keep body copy scannable. Put detailed
  explanation in speaker notes or an appendix when appropriate.
- Keep margins and alignment consistent. Avoid decorative elements that do not
  support hierarchy, meaning, or brand.
- Preserve editable text, shapes, and charts when practical. Disclose when an
  element must be flattened to an image.
- Use accessible contrast, readable type sizes, meaningful chart labels, and
  alt text when the tooling supports it.
- Do not claim a deck is visually verified until every changed slide has been
  rendered or opened in a compatible presentation application.

## Completion gate

Do not finish until the presentation opens successfully, contains the expected
slide count and notes, has no accidental placeholders, and every changed slide
has been visually inspected at full-slide and thumbnail scale.
