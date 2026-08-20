# Context for AI assistants

## Legal/policy page tone

`privacy.html`, `support.html`, `licenses.html` must use formal official/government register in **both** the English and Traditional Chinese (zh-Hant) sections — not conversational tone.

- English: keep "you" (standard for legal text) but drop chatty asides, casual phrasing ("nowhere for them to go"), and subjective asides.
- zh-Hant: third-person objective (避免你/妳second-person conversational address), avoid colloquial word choices (e.g. 無法/不會 not 拿不到/跑掉), 條列式/numbered sections (一、二、三...) over loose prose.
- No subjective/opinionated asides (e.g. declaring what "is not a feature") — state facts plainly.
- `licenses.html` has an auto-generated section (`<!-- GENERATED:START -->`, produced by `npm run licenses`) — only the hand-written lede/intro prose needs this treatment; leave the generated license table alone.
- Scope is limited to these three pages. Normal app UI copy and other docs keep whatever register fits their context.
