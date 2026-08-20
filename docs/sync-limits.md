# What sync costs, and where it breaks

Written after the pass over every board landed, because that is the change that
turns "one board, occasionally" into "everything you own, on connect". The
numbers are Google's, from the Drive API limits page; the failure modes are
this code's.

## The quota, in the units Google counts

Drive charges **quota units per minute**, not requests:

|                                       |                   |
| ------------------------------------- | ----------------- |
| Per project, per minute               | 1,000,000 units   |
| **Per user, per project, per minute** | **325,000 units** |
| List (`files.list`)                   | 100 units         |
| Download (`alt=media`)                | 200 units         |
| Edit / upload                         | 50 units          |
| Read (`files.get`, `about.get`)       | 5 units           |

Over the limit is `403 User rate limit exceeded`, or `429 Rate limit exceeded`
from the backend check.

## What this app spends

**Opening a session:** four `findByName` lists to resolve the folders, three
`listChildren` listings for `boards/`, `assets/` and `text/`, one `about.get`.
About **700 units**, once, and every folder listing is then cached for the rest
of the session.

**A board that has not moved:** nothing. Zero requests. The board's `updatedAt`
is repeated into Drive's `appProperties`, so the listing already in hand answers
"has this changed" for every board at once. This is the difference between a
pass that is affordable on every connect and one that is not.

**A board that has moved:** one download (200) plus one upload (50), and 50 per
image the remote is missing. `hasAsset` is answered from the cached listing, so
checking costs nothing and no blob is read off disk for an image that is already
up there.

**First connect, 50 boards, 500 images:** roughly **27,500 units** — about 8% of
one minute's allowance. Quota is not the constraint.

**Bandwidth is.** 500 images is 500 sequential multipart uploads. At a couple of
hundred milliseconds each that is minutes of wall clock, and every byte of every
image goes up. There is no progress indication and no way to stop it.

The 750 GB/day upload cap and the 5 TB file cap are not reachable from a canvas
of screenshots. The 15 GB of a free Google account is very reachable, and it is
shared with Gmail and Photos.

## Limits this code has, that Drive does not

- **No backoff.** Nothing retries a `403` or `429`. In the per-board pass the
  board is recorded as failed and the pass moves on; for the open board the
  round fails and says so. A truncated exponential backoff is the documented
  answer and is not implemented.
- **No resumable uploads.** Everything is multipart, which Drive only
  recommends below 5 MB. A large image that fails at 90% starts again.
- **Everything is sequential.** One board at a time, one asset at a time. Safe,
  and slow.
- **The directory listing is cached for the whole session and never refreshed.**
  A tab left open all day never sees a board or an image another device added.
  Combined with there being no periodic pull, the second device's work is
  invisible until a reload.
- **A duplicate upload is possible.** If another device uploads an image after
  this session's listing was taken, `hasAsset` says no and it is uploaded again.
  Drive permits two files with one name, so the folder ends up with both. Wasted
  bytes, not lost data — the id is the hash, so both files have identical
  content.

## Where data can still go wrong

Ordered by how much it would hurt, not by how likely it is.

### Clock skew decides every conflict

Every merge decision — which node wins, which name wins, whether a tombstone
beats an edit — compares `updatedAt` values produced by `Date.now()` on
different machines. There is no vector clock and no server time. A device an
hour fast wins every conflict it takes part in, forever, and a device an hour
slow silently loses work it did most recently. A laptop resumed from sleep with
a stale clock is the ordinary way this happens.

This is the deepest structural risk in the design, and nothing above the merge
can correct for it.

### Two tabs on one board — mostly handled

Two tabs are two copies of the atoms over one IndexedDB. Each writes the _whole_
board record when it saves, so a tab holding a stale node list used to land it
on top of a newer one — the second tab did not have to be edited to destroy
work, it only had to be open and then saved.

A `BroadcastChannel` now carries "this board moved, go and look" between tabs.
A tab that hears it reloads the board from IndexedDB, so by the time it writes
anything it is writing over its own reading. It carries no board content: the
message can arrive twice, arrive late, or be dropped, and IndexedDB is still the
only source of truth.

Two things had to be true for that to work. A tab with unsaved work does not
reload — the save is debounced, and adopting another tab's record inside that
window would discard the edit about to be written. And _opening_ a board no
longer saves it: the content effect ran on mount and wrote the board back with a
fresh `updatedAt`, so the second tab to open a board would stamp its own view as
the newest edit, which is precisely the write that could not be argued with.

What remains is last-writer-wins between two tabs both actively editing. That is
the same rule the app already had, but both tabs now agree on what happened
rather than one silently flattening the other.

### A board deleted while the pass is running — fixed

The pass takes one snapshot of local boards at the start, and a board deleted
between then and the pass reaching it was written back out: `removeBoard`
dropped the row, and the pass still held the record it had read. That was the
narrow version of a much wider bug — a board dropped from disk is
indistinguishable from a board this device has never seen, so the pass
downloaded it again on _every_ round, snapshot or no snapshot. With Drive
connected, deleting a board was not something the app could do.

Deletion is now a marker on the record rather than the record's removal (D66).
The grave is what the pass finds instead of an absence, and the grave is what
travels to the remote so the other devices bury it too.

What is left of the race is benign. A board deleted while the pass is mid-round
can still be pushed as live by that round; the deletion is on disk, the next
round reads it, and the board goes back to being deleted. The window costs one
extra round rather than a resurrection.

### Renaming dropped tombstones — fixed

`renameBoardAtom` assembled the stored record by hand and left out
`tombstones`, which `StoredBoard` makes optional, so it type-checked. A rename
erased the record of every node deleted on that board.

Narrower in practice than it looks: the next ordinary save rebuilds the record
from the atoms, where the tombstones still are, so the damage repaired itself
unless the tab reloaded in between. Every writer now goes through one assembler,
so the next field added to a board cannot be dropped by one caller out of three.

### A refusal nobody sees

A board written by a newer version of the app is refused, correctly. In the
per-board pass that refusal is caught, counted, and never shown: the board
quietly stops syncing while everything looks fine. Only the open board's refusal
reaches the UI.

### Running out of Drive

A full account fails uploads partway through a pass. Some boards are up, some
are not, and a board that made it while its images did not renders elsewhere as
placeholders that will never fill in. The quota bar in the panel is the only
warning, and nothing checks it before starting.

### An image that never arrives

`records` mode deliberately does not download images for boards that are not
open, which is right for traffic. It also means a board pulled from another
device shows placeholders until opened — correct, but it makes "the image is
missing" and "the image has not been fetched yet" look identical.
