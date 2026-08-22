# Sync design

**Status: built, against a fake remote.** The merge, the tombstones, the loop
and the asset transfer all exist and are tested (`src/sync/`). What has never
run is Drive itself — there is no OAuth client yet, so the transport that has
actually been exercised is the local fake behind `?sync=fake`
([D57](decisions.md)).

That ordering was deliberate. The transport is the easy half; the merge is the
half that cannot be debugged after the fact, because by the time anyone notices,
the evidence is two devices that disagree and no record of what either used to
hold.

## What this is for

One person's devices. Sign in on a laptop and a phone, see the same boards.

Explicit non-goals for the first version, each of which needs its own decision
to enter scope:

- **Sharing a board with another person.** A different feature with a different
  hard part — a permissions model and an answer for two people editing at once.
  The scope chosen below leaves the door open; nothing else here assumes it.
- **Real-time collaboration.** Not planned at all. It would change the store
  from "an array of nodes" to a CRDT and rewrite history along with it.
- **A server.** The app is static and stays static. Drive is the only backend.

## Auth

Google Identity Services' token model, in the browser, no backend. A static site
can do this: the token flow needs a client ID but no client secret.

Scope: **`https://www.googleapis.com/auth/drive.file`** — access limited to
files this app created, in a folder the user can see.

The alternative was `drive.appdata`, a hidden folder. Rejected: it cannot be
shared, cannot be inspected, and cannot be recovered by hand. When sync breaks —
and sync breaks — the difference between a folder the user can open and a folder
nobody can look at is the difference between a bug report and a shrug. It also
forecloses sharing without a scope change and fresh consent.

`drive.file` is classified **non-sensitive**, so the app does not need OAuth
verification to function. Brand verification is needed only to show a name and
logo on the consent screen instead of the raw origin.
([scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[verification](https://support.google.com/cloud/answer/13463073))

Before any of this can be written, someone has to create a Google Cloud project,
enable the Drive API, and add an OAuth client with these authorized JavaScript
origins:

```
https://hikarintu.github.io
http://localhost:5173
```

The client ID is not a secret. Locally it lives in `.env`, which is gitignored
— not because the id needs hiding, but because that file is where a real secret
lands by accident, and Vite inlines every `VITE_` variable into public
JavaScript. In CI it is a repository **variable**, `VITE_GOOGLE_CLIENT_ID`, and
the deploy fails if it is missing: an absent one is not a build error, it is a
build that silently ships with sync disabled.

The token flow uses no client secret at all. If one exists for this project, it
has no business in this repo or in any `VITE_` variable.

Access tokens last an hour, and there is no way to get another one quietly.

Google's token model has no silent path. From its own documentation: _"Due to
security concerns, only the dialog UX is supported"_, and _"a user gesture
triggers the token flow"_. Every token comes from a popup, and a popup that no
click opened is a popup the browser blocks. There is no refresh token in a
browser flow either — nothing exists to exchange in the background. `prompt: ""`
does not remove the popup; it removes what the popup _shows_.

Three things follow, and none of them are preferences:

- **A reload signs you out.** The token is memory-only by choice, and no code
  could obtain a new one without asking.
- **There is no hourly renewal.** An expired session is marked `expired` and the
  round fails with a message saying so. Requesting a token from a sync timer
  would open a window the browser blocks — a failure that is also invisible.
- **Every token request lives inside a click**, and there is exactly one such
  place: the Connect button.

What _is_ kept is `canwas.drive.account`: the address, display name and picture
of the last account this browser connected with. All three come from the same
`about` request that already reported the storage quota, so knowing them costs
nothing. None of it is a credential — it opens no door, it only names one — and
signing out erases it, because it is ordinary personal data on a machine
somebody else may use next. Erasing it is _all_ signing out does: the grant on
Google's side is untouched, because it belongs to the account rather than to
this browser, and ending it is a link to Google's own permissions page (D108).

Its presence buys three things:

- The request carries it as a `hint`, so Google knows which of two signed-in
  accounts is meant and skips the chooser (D82).
- Every request passes `prompt: ""` — Google's default, which shows a chooser or
  a consent screen exactly when one is needed and otherwise opens and closes a
  window. The record is cleared only when Google says the grant itself is the
  problem; a dismissed popup leaves it alone, because forgetting there would
  cost the next click the consent screen this record exists to skip (D108).
- The button reads **Reconnect** rather than Connect, so a signed-out state
  looks like one click rather than like setting the whole thing up again.
- Reconnect sits _beside_ the sync icon, wearing the face of the account it
  would reconnect as. Putting it inside the popup made the most likely action
  after a reload cost two clicks, and on a machine signed into two Google
  accounts the question was never "connect?" but "connect as whom?".

The stored record is parsed defensively — anything can be under a `localStorage`
key, including another version of this app or a hand-edited value — and a
picture that fails to load falls back to an initial. A broken image where a face
should be reads as a broken connection.

An automatic resume on page load was built first, and cannot work. Worth writing
down, because the code for it reads as though it should.

## Landing a round on a board that moved

A round reads the board, talks to Drive for a second or several — longer when
it is uploading a screenshot — and comes back with a merged result. By then the
board may have moved: a node pasted, a node dragged, a node deleted.

The result is therefore **settled** against the board as it is at that instant
before it lands (`settleRound`), rather than replacing it. The rule is that a
round only has authority over what it saw; anything that happened since is
newer than the round by definition and survives to be pushed by the next one.
It is the same merge that does this, with the board as the round found it as
the base — which is what distinguishes "the remote deleted this" from "this
arrived while we were busy".

Two things got this wrong at first, and both looked identical from the outside:
a node pasted during a round vanished a second or two later, tombstone and all,
so the next push deleted it everywhere.

- The result was applied with `replaceNodes` against current nodes, so anything
  the round had not seen was treated as removed.
- The stored base was written as "the merged board, with whatever nodes this
  device holds now". A node that arrived mid-round therefore entered the base
  without ever reaching Drive, and the next round read "in the base, absent from
  the remote" as the remote having deleted it.

The base is now exactly what was pushed. It describes the _remote_, and nothing
else may be folded into it.

## What is stored, and where

```
CanWas/
  boards/<board-id>.json      the board record, as it is in IndexedDB
  assets/<sha256>.<ext>       image bytes, content-addressed
  text/<sha256>.json          what was read out of those bytes
```

Every JSON document this app writes carries a `_version`. Not for the format as
it stands — a single writer needs no version — but for the moment there are
two. Devices update independently, so a phone unopened for a month is a client
running last month's code reading what the laptop wrote this morning. Without a
stamp, an old build reading a new document does not fail, it _half-succeeds_:
takes the fields it knows, drops the rest, writes the result back. Stamp on the
way out, refuse on the way in — refusing to read is also refusing to overwrite.
A missing stamp is version 0, which is what the boards written before this
carry; they are read normally and stamped on their next write.

Recognition lives in its own folder rather than as a second extension under
`assets/`, because `hasAsset` answers by filename prefix and a text file beside
the image would make a picture nobody has look present.

It is the cheapest thing here to share and the most expensive not to: reading an
image costs 21 MB of weights and real seconds, and depends on nothing but the
bytes — which are content-addressed, so the same id is the same pixels on every
device forever. It also cannot conflict. Two devices that read the same image
did not disagree, so first writer wins and nobody loses.

Two rules it does have:

- **Only a finished reading goes up.** A failure is one device's problem — it
  ran out of memory, or the tab closed — and publishing it would stop every
  other device from ever trying.
- **The engine is recorded and checked.** The mock recognizer invents its
  strings, so a board that had been near a `?engine=mock` session would
  otherwise poison every other device with nonsense that looks exactly like a
  result.

Recognition is pulled _before_ the images it belongs to, so a downloaded asset
arrives already read. Landing the pixels first puts an unread asset in the store
and the local pipeline starts on it the moment React sees it — spending exactly
what this exchange exists to save, then overwriting the arriving reading with
its own.

Weights are never uploaded. They are 21 MB of public files that re-download for
free, and putting them in someone's Drive quota would be rude.

Assets are content-addressed already, which does most of the work: the same
screenshot on two boards is one upload, and two devices that ingest the same
image converge without either knowing about the other. **An asset can never
conflict** — same name means same bytes, by construction.

## The sync loop

IndexedDB stays the source of truth. Drive is a replica, and the app works
offline exactly as it does now.

- **Push** on the same debounce that already writes a board locally, plus a
  flush on `pagehide`.
- **Pull** on sign-in and on board open.
- **Conflicts** are the hard part, and they are not per board. See below.

## Conflicts

Per-board last-writer-wins is the obvious answer and it is wrong. Two devices
that each add one image to the same board produce two whole-board writes, and
whichever lands second erases the other's image. That is not an edge case; on
two devices it is Tuesday.

So the merge has to be per node. Three things are needed, and only the first is
obvious:

**1. Every node carries `updatedAt`.** The merge is the union of both node
lists, and where both sides hold the same node id the newer one wins.

**2. Deletions leave tombstones.** A node — or a board — deleted on the laptop
must not be resurrected by the phone, which still holds it and will push it
back as an addition. A tombstone is a record that something was deleted and
when. They can be reclaimed after a fixed period, on the bet that no device
stays offline longer than that.

**3. Paint order has to stop being the array index.** ✅ Done ahead of the rest
([D55](decisions.md)).

Array position is not mergeable. Two devices that each append a node produce
two arrays of the same length whose last elements differ, and there is no
operation on those two arrays that recovers the intent of either. So each node
now carries an `order` key — a **fractional index**, a string with room for
another key between any two — and the board paints in `(order, id)` order.
Reordering touches one node instead of renumbering the list, two devices
reordering different nodes merge cleanly, and two devices that mint the _same_
key still agree, because the id breaks the tie the same way on both.

This went first because every board written without keys is a board that needs
migrating later, and the migration is guesswork once two devices already
disagree. Boards saved by an older build are filled in from their stored array
order on the way out of storage, on every hydration rather than once — a board
written by an older build on another device is not a case that ever stops
happening.

### Text is the remaining loss

With per-node merge, the only true conflict left is the same text node edited on
both devices while both were offline. There is no correct answer without a CRDT,
and a CRDT for text means the store stops being an array of plain nodes and the
history stack (D15, inverse patches) stops being expressible.

That is not a trade worth making for a single-user app whose two devices are
rarely editing the same paragraph at the same minute. So: **last writer wins,
and the loser is kept as a second text node beside the winner.** Ugly, visible,
and recoverable — which beats silent and correct-looking.

### Undo does not cross the boundary

History is in-memory and per session (D16), so a merge arriving from another
device cannot be undone by the device that receives it. A merge must therefore
land as an ordinary change with its own inverse, exactly like a paste, or the
undo stack and the board disagree about what happened.

### Deletion needs tombstones

The one part that does not fall out of the design. A board deleted on the laptop
must not be resurrected by the phone, which still has it and will happily push
it back. So deletions record a tombstone rather than removing a row, and the
sweep only reclaims a tombstone once every device has seen it — or, more
cheaply, after a fixed period.

This interacts with the asset sweep (D14), which currently runs at startup
against the local board list. With sync, a board that exists only on another
device makes its assets look orphaned. The sweep has to run against the _synced_
board list, or it will delete images that are still in use.

## Image size — settled

Every image now gains a WebP re-encode in the background, at the same
dimensions, keeping the original ([D52](decisions.md)). Measured at 2.4x smaller
on a UI screenshot with no cost to recognition.

**Only the WebP is uploaded.** The original never leaves the device that pasted
it. A device that receives a board therefore has the WebP and nothing else,
which is fine: it renders it, reads it, and the asset id still matches, because
the id is the hash of the _original_ bytes and travels as the filename rather
than being recomputed. Two devices holding different bytes for the same asset id
is not a conflict — it is the design.

The one consequence to remember: a receiving device cannot reproduce the
original, so a round trip through two devices is lossy exactly once.

## What is still missing

- **There is no periodic pull.** Rounds fire on board open, 2.5s after edits
  stop, on the button, and once per connection for every other board. Two
  devices open on the same board do not converge on their own.
- **The folder listing is cached for the whole session.** A tab left open never
  sees anything another device added.
- **Nothing backs off.** A `403` or `429` from Drive fails that board's round;
  the documented truncated exponential backoff is not implemented.

`docs/sync-limits.md` has the numbers and the longer list of ways data can still
go wrong — clock skew, two tabs, a rename dropping tombstones.

- **Tombstones are never reclaimed.** They are small, and a wrong reclamation
  resurrects a deleted node, so the bet is not worth taking until there is a
  reason.

## Every board, once per connection

`useSync` keeps the open board in step. That was the whole of sync for a while,
and it left two holes of the same shape: connecting for the first time uploaded
one board out of however many exist, and a board made on another device never
appeared here, because the menu is fed from local IndexedDB and nothing ever
asked the remote what it had.

`reconcileBoards` walks the union of both sides once per connection — not per
navigation, since it is the one thing that should not run every time a board is
opened.

- **The open board is skipped**, and the check is repeated for every board
  rather than taken once at the start. The pass outlives a navigation, and the
  board that was safe to touch when it began may be the one on screen by the
  time it is reached. Two writers on one board, one working from atoms and one
  from disk, is the bug that check exists to prevent.
- **Boards that have not moved cost nothing.** Each board's `updatedAt` is
  repeated into Drive's `appProperties`, so one folder listing — already made —
  answers "which of these changed" for all of them. Agreement is only believed
  when all three stamps line up: local, remote and base. An absent stamp means
  _ask_, never _skip_, or a board written by an older build would be skipped
  forever.
- **Other boards sync in `records` mode**: their record and their images go up,
  and nothing but the record comes down. Images cannot be recomputed, so they
  belong on the remote immediately; downloading the images of a board nobody has
  opened is speculative traffic, and the missing-asset placeholder already
  covers a node whose picture has not arrived.
- **Blobs are read from disk one at a time**, and only after the remote has said
  it does not have that image. Holding fifty boards of images in memory to
  upload the few that are missing is a way to run a phone out of memory doing
  housekeeping.
- **One bad board does not stop the pass.** A failure is counted and the walk
  continues.

## Opening a board this device has never seen

A URL carries an id, so a link to another device's board reaches a device that
has never heard of it. That board is materialised locally rather than refused,
and the round that follows fills it in: an empty local side against no base is
read as a union, not as a deletion, so every remote node arrives.

The placeholder is created with `updatedAt: 0`. Stamping it with the current
time — which is what it used to do — made an empty shell the most recently
touched copy of that board anywhere, and the merge believed it twice: the
placeholder's name (the raw id, for want of anything better) beat the real one
under last-writer-wins and was pushed to every other device, and a board deleted
elsewhere came back from the dead. Zero says the true thing: this side has no
edit to offer.

The board's own fields — name, `createdAt`, `updatedAt` — are then taken from
the merge result and written back locally. They were being merged and pushed
correctly and then dropped on the floor, which is why a rename never crossed
between devices even though the merge had always computed it. Adopting is
deliberately not renaming: a rename stamps the time to say _this device decided
this_, and a merge result that announced itself as a fresh local edit would win
the next round on the strength of having been received.

## Open questions

- Does the app sign in on its own, or does an unsigned user keep working
  entirely locally with sync as something they turn on? (Local-first says the
  latter.)
- What does the info panel show when signed in — quota used, last sync, pending
  uploads?
- Does a board deleted on one device go to a trash the user can reach? The
  grave keeps its contents for thirty days (D66), so an undelete is a button
  away and nobody has asked for one.
- Does WebP cost recognition accuracy? Measurable now, with the suite that
  already exists.
