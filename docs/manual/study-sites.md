# Research sources

For every passage it studies, Tolle fetches pages from the sources enabled in **Settings → Sources**, extracts the main text, and passes trimmed excerpts to the AI with the URL. The AI is instructed to cite sources as links, summarise rather than quote, and keep “what the text says”, “what the sources say” and “its own synthesis” separate. Each AI note lists every source it checked and whether it was available.

## Default sources

| Source | What | URL template |
|---|---|---|
| bible-api.com | Bible text (public-domain translations) | `https://bible-api.com/{ref_q}?translation={translation}` |
| StudyLight – commentaries | all of StudyLight's commentators on the verse (the same address LifeHub uses) | `https://www.studylight.org/commentary/{book_slug}/{chapter}-{verse}.html` |
| BibleStudyTools – Matthew Henry Complete | commentary | `https://www.biblestudytools.com/commentaries/matthew-henry-complete/{book_slug}/{chapter}.html` |
| Enduring Word – David Guzik | commentary | `https://enduringword.com/bible-commentary/{book_slug}-{chapter}/` |
| BibleProject | book overview | `https://bibleproject.com/explore/video/{book_slug}/` |

Websites change their layouts. If a source shows ✗ in a note, open **Settings → Sources**, press **Test**, open the URL in a browser to see the right pattern, and edit the template. For example, BibleProject splits some books into two videos (`john-1-12`, `john-13-21`).

## Placeholders

| Placeholder | Example (John 3:16) |
|---|---|
| `{book}` | `John` |
| `{book_slug}` | `john`, `1-corinthians`, `song-of-solomon` |
| `{book_q}` | URL-encoded book name |
| `{chapter}` | `3` |
| `{verse}` | `16` (first verse, or 1) |
| `{ref}` / `{ref_q}` | `John 3:16` / URL-encoded |
| `{translation}` | your chosen translation code |

## Adding sources

**+ Add source** – any site with one page per chapter works, e.g. a single StudyLight commentary such as Matthew Henry (`https://www.studylight.org/commentaries/eng/mhm/{book_slug}-{chapter}.html`), Bible Hub commentaries (`https://biblehub.com/commentaries/{book_slug}/{chapter}-{verse}.htm`) or GotQuestions pages. Pages that need JavaScript to show their text won't work.

## Good citizenship

- Pages are cached for 30 days so repeated studies don't hit the sites again.
- Only the pages needed for your study are fetched, one at a time.
- Output links back to each source. Please respect each site's terms; this feature is intended for personal study.
