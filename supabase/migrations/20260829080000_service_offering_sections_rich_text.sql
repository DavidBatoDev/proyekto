-- Service section bodies are rich text, not only markdown.
--
-- The About editor now mounts the app's rich-text editor when a section is
-- opened, so new bodies are saved as its sanitised HTML. Sections written
-- before it stay markdown and keep rendering that way — the web renderer picks
-- per body — so this migration changes no data, only the column comment that
-- would otherwise tell the next reader something false.
comment on column public.service_offerings.description_sections is
  'Ordered sections. layout "prose" => {heading?, body}, where body is rich-text HTML from the editor or markdown for sections written before 2026-08-29; layout "columns" => {heading?, columns:[{label, body}]} (max 3, plain text). Missing layout means prose. description mirrors section 1 as plain text for cards and contract snapshots.';
