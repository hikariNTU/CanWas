# Sync design

**Status: designed, partly built.** Sign-in and the Drive transport exist
(`src/sync/`). Nothing is uploaded or downloaded yet, and the conflict design
below is not implemented at all. Written so the
shape is agreed before code, in the same order as everything else in this
project.

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

The client ID is not a secret and can live in the repo.

Access tokens last an hour. There is no refresh token in a browser flow, so the
app re-requests silently and only prompts if consent has actually lapsed.

## What is stored, and where

```
CanWas/
  boards/<board-id>.json      the board record, as it is in IndexedDB
  assets/<sha256>.<ext>       image bytes, content-addressed
```

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

**3. Paint order has to stop being the array index.** This is the one that hurts,
because it contradicts [D18](decisions.md): paint order is array order and there
is no `z` field.

Array position is not mergeable. Two devices that each append a node produce
two arrays of the same length whose last elements differ, and there is no
operation on those two arrays that recovers the intent of either. The fix is a
**fractional index**: each node carries an order key, a string, and a node
inserted between two others gets a key that sorts between theirs. Reordering
touches one node instead of renumbering the list, and two devices reordering
different nodes merge cleanly.

D18 was right for a local app and is the specific thing sync breaks. It should
be revisited _before_ sync is built, not during — every board written until
then is a board without order keys.

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

## Open questions

- Should node order keys land now, ahead of sync? Every board written without
  them is a board that has to be migrated later, and the migration is
  guesswork once two devices disagree.
- Does the app sign in on its own, or does an unsigned user keep working
  entirely locally with sync as something they turn on? (Local-first says the
  latter.)
- What does the info panel show when signed in — quota used, last sync, pending
  uploads?
- Does a board deleted on one device go to a trash the user can reach, or is
  the tombstone the whole story?
- Does WebP cost recognition accuracy? Measurable now, with the suite that
  already exists.
