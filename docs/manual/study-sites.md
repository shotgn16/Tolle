# Study sites

For every passage it studies, Tolle reads the sources turned on in **Settings → Sources**: the Bible text, a wide range of commentaries from the early Church to today, the Church Fathers, the original Greek or Hebrew, sermons and pastoral writing, Bible dictionaries and book overviews. It then asks the AI to weigh all of it. The AI compares the commentators, notes how the passage has been read across the centuries, uses the language notes and the pastoral material, and names each source it relies on. Every AI note lists the sources Tolle checked and whether they were available.

## Every commentator, not just the first

Some pages hold many separate works. StudyLight's page for a verse has around 40 commentaries, and Bible Hub's has about 15. Sending only the start of such a page would mean the AI only ever saw the first commentator. So Tolle splits these pages into their separate works and labels each one with its author, date and kind of voice:

| Kind | For example |
|---|---|
| early church | Augustine, Chrysostom, Tertullian, Bede |
| Reformation & Puritan | Calvin, the Geneva Bible, Matthew Henry, Matthew Poole, John Trapp, Gill, Bengel, Wesley |
| 1700s–1800s | Adam Clarke, Barnes, Ellicott, Jamieson-Fausset-Brown, Keil & Delitzsch, Godet |
| original languages | Robertson's Word Pictures, Vincent's Word Studies, the Expositor's Greek Testament, Meyer, Cambridge Bible |
| sermons & pastoral | The Biblical Illustrator, the Pulpit Commentary, MacLaren, Spurgeon's *Treasury of David*, Simeon's *Horae Homileticae* |
| modern | Coffman, Constable, Pett |
| reference | Treasury of Scripture Knowledge (cross references), Scofield |

Then it shares out the space so **every kind is represented**: when there isn't room for everything, the kinds take turns, so you get the Fathers, a Reformer, a word study and a sermon, not five works of the same kind. How much space there is depends on **Settings → AI → Source text budget** and the model. With Ollama, Tolle also keeps within the model's context window so nothing gets cut off.

## Built-in sources

| Source | What it adds | Looks up |
|---|---|---|
| bible-api.com | the Bible text in your translation | the passage |
| StudyLight – commentaries | ~40 commentators on the verse, from Calvin to Constable, including word studies and The Biblical Illustrator | the first verse |
| Bible Hub – commentaries | Ellicott, MacLaren, the Pulpit Commentary, Cambridge, Spurgeon's *Treasury of David*, Keil & Delitzsch… | the first verse |
| Catena Bible – Church Fathers | the early Church on the verse. Only some verses have the Fathers on the page, and others are skipped quietly | the first verse |
| Bible Hub – interlinear | each Greek or Hebrew word with its transliteration, Strong's number, meaning and grammar | the first verse |
| BibleStudyTools – Matthew Henry Complete | the full Matthew Henry commentary | the chapter |
| Enduring Word – David Guzik | modern pastoral commentary | the chapter |
| BibleProject | an overview of the book | the book |
| Easton's Bible Dictionary | the dictionary entry for a topic word (e.g. *love*, *grace*), used for insights, focus words and study-plan themes | a topic word |

People who used an earlier version get the new sources added automatically. Any changes you made are kept, and a source you deleted stays deleted. **Add back built-in sources** restores any you removed.

## When a site changes

Websites change their layouts. If a source shows ✗ in a note, open **Settings → Sources** and press **Test**. For pages split into several works, the test tells you how many it found (for example, "34 works used: Clarke, Calvin, …"). Open the URL in a browser to see the right pattern, and edit the template. For example, BibleProject splits some books into two videos (`john-1-12`, `john-13-21`).

## Placeholders

| Placeholder | Example (John 3:16) |
|---|---|
| `{book}` | `John` |
| `{book_slug}` | `john`, `1-corinthians`, `song-of-solomon` |
| `{book_bh}` | Bible Hub's spelling: `john`, `1_corinthians`, `songs` |
| `{book_nab}` | short codes used by Catena Bible: `jn`, `1cor`, `sg` |
| `{book_q}` | URL-encoded book name |
| `{chapter}` | `3` |
| `{verse}` | `16` (first verse, or 1) |
| `{ref}` / `{ref_q}` | `John 3:16` / URL-encoded |
| `{translation}` | your chosen translation code |
| `{topic_slug}` / `{topic_letter}` | for "a topic word" sources: `love` / `l` |

## Adding sources

**+ Add source**: any site with one page per verse, chapter or topic word works. Choose what it **looks up** (the passage, the first verse, the chapter, the book or a topic word) and what **kind** of source it is. Examples:

- a single StudyLight commentary, such as Matthew Henry: `https://www.studylight.org/commentaries/eng/mhm/{book_slug}-{chapter}.html`
- the International Standard Bible Encyclopedia for a topic: `https://www.studylight.org/encyclopedias/eng/isb/{topic_letter}/{topic_slug}.html`
- GotQuestions or your church's own study pages

Pages that need JavaScript to show their text won't work.

## Good citizenship

- Pages are cached for 30 days, so repeated studies don't hit the sites again.
- Only the pages needed for your study are fetched, a few at a time.
- Output links back to each source. Please respect each site's terms; this feature is intended for personal study.
