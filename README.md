# IdRefs — a custom-element feature for resolving id lists to live elements

`IdRefs` is a small, framework-agnostic **custom-element feature** (in the
[`assign-gingerly`](https://github.com/bahrus/assign-gingerly) / `el-maker` sense): a class that a
host custom element spawns and delegates to. Its single job:

> Given an ordered `string[]` of element ids, resolve them to the live `Element`s with those ids in
> the host's root node — and keep watching the DOM until every id has been found, re-resolving (and
> notifying the host) whenever the matching set changes.

It is the reusable core of the "point at other elements by id" pattern that the platform itself
implements over and over (`label[for]` → `HTMLLabelElement.control`, `input[list]`,
`button[popovertarget]`, `[commandfor]`, ARIA element reflection, …).

- **Intended package:** `id-referencer` — <https://github.com/bahrus/id-referencer>
- **Export:** `class IdRefs`
- **Default event:** `id-referencer:resolved`

This document describes the implementation currently vendored at `./IdRefs.js`, written so it can
be lifted into its own package.

---

## What it is *not*

- **It does not read an attribute.** The host owns `attribute → string[]` parsing (e.g. a
  roundabout `splitter` parser turning `for="a b c"` into `['a','b','c']`) and hands the array in
  via the `searchFor` property. That keeps id-list parsing in the host's reactive graph and leaves
  this feature with the one reusable transform: `string[]` → `Element[]`.
- **It does not render anything.** It resolves references and emits an event; the host decides what
  to do with the resolved elements.
- **It does not mutate the referenced elements.**

---

## Installation (once extracted)

```bash
npm install id-referencer
```

```js
import { IdRefs } from 'id-referencer';
```

---

## The feature contract

`IdRefs` follows the `assign-gingerly` feature-spawn contract.

### Constructor

```ts
new IdRefs(hostElement: HTMLElement, ctx: FeatureSpawnContext, initVals?: Partial<IdRefs>)
```

| Param | Purpose |
| --- | --- |
| `hostElement` | The custom element this feature serves. Held via `WeakRef` — the feature never keeps the host alive. |
| `ctx` | Spawn context. `ctx.injection.customData` supplies configuration (see below). |
| `initVals` | Optional; `Object.assign`-ed onto the instance after construction. |

### Configuration — `customData`

```ts
interface IdRefsCustomData {
  /** Event dispatched on the host when a DOM-mutation-driven pass changes the
   *  resolved set. Default: 'id-referencer:resolved'. */
  eventType?: string;
}
```

### Lifecycle callbacks (host-forwarded)

The host **must** forward these:

| Callback | Effect |
| --- | --- |
| `connectedCallback()` | Marks the feature connected. If an id list is outstanding, re-resolves it (no event) and re-arms the observer if anything is still missing. |
| `disconnectedCallback()` | Marks the feature disconnected and tears down the `MutationObserver`. While disconnected, re-resolves never re-arm the observer. |

---

## Public API

```ts
interface IIdRefs {
  /** The ordered id list to resolve. Assigning triggers a synchronous resolve. */
  searchFor: string[];
  /** Resolved, still-connected elements, in id order. */
  readonly elements: Element[];
}
```

Plus, on the concrete class:

| Member | Kind | Description |
| --- | --- | --- |
| `searchFor` | get/set `string[]` | See below. The getter returns the last value assigned (raw). |
| `elements` | get `Element[]` | Currently-resolved elements: each `WeakRef` de-referenced, filtered to `isConnected`, in the order their ids appear in `searchFor`. Unresolved / removed ids are **omitted**, so `elements.length` may be `< searchFor.length`. A fresh array each call. |
| `complete` | get `boolean` | `elements.length >= searchFor.length` — i.e. every id currently resolves to a connected element. |

### `set searchFor(ids: string[])`

1. Stores `ids` (returned verbatim by the getter).
2. Compares to the id list currently being tracked, **order-sensitively**. If identical, returns —
   no re-resolve. (So `['a','b']` then `['b','a']` *is* a change; `['a','b']` then `['a','b']` is
   a no-op.)
3. Otherwise replaces the tracked list, clears resolved state, and **resolves synchronously**
   against the host's root node.
4. Never dispatches the event. The caller is expected to read `elements` immediately afterward.
5. If any id is unresolved and the host is connected, a `MutationObserver` is armed on the root
   node; it stays armed until every id resolves.

---

## Resolution semantics

- **Root node.** Ids are resolved with `root.getElementById(id)` where `root` is
  `hostElement.getRootNode()` when that is a `ShadowRoot`, otherwise `document`. This works inside
  a shadow tree and in the main document alike. (If the host is disconnected, `getRootNode()`
  yields a detached tree and resolution falls back to `document`.)
- **Per-slot, order-preserving.** Each id has a slot in the output aligned to its position in
  `searchFor`. Already-resolved, still-connected slots are skipped on re-resolve.
- **Duplicates.** A repeated id resolves each slot independently — the same element can appear
  twice in `elements`.
- **Weak retention.** Resolved elements are stored as `WeakRef`; `IdRefs` never keeps a referenced
  element (or the host) alive. If a resolved element is GC'd or disconnected, it silently drops out
  of `elements` and the observer re-arms.

---

## Watching for late / changing elements

While at least one id is unresolved **and** the host is connected, a single `MutationObserver` runs
on the root node with:

```js
{ childList: true, subtree: true, attributes: true, attributeFilter: ['id'] }
```

On any mutation it re-resolves. This picks up:

- a referenced element being **added** later,
- a referenced element being **removed** (it drops from `elements`; observer re-arms),
- an `id` attribute being **assigned or reassigned** so an element enters/leaves the watched set.

The observer is **disconnected as soon as every id is resolved** and re-armed if the set later
becomes incomplete. It is also torn down on `disconnectedCallback`.

---

## The `resolved` event

When a **mutation-driven** re-resolve changes the resolved set (compared order-sensitively to the
set before that pass), `IdRefs` dispatches a `CustomEvent` on the host:

```ts
host.dispatchEvent(new CustomEvent(eventType /* default 'id-referencer:resolved' */, {
  detail: {
    ids: string[];        // the id list currently being resolved (a copy)
    elements: Element[];   // same as `.elements` at dispatch time
  }
}));
```

It does **not** bubble and is **not** composed.

It is **not** fired for:

- the synchronous resolve triggered by assigning `searchFor`,
- the re-resolve in `connectedCallback`,
- a mutation pass that leaves the resolved set unchanged.

So the consumption pattern is: assign `searchFor`, read `elements` synchronously, and *also* listen
for `eventType` to catch later changes.

---

## Wiring into a host element

### With `assign-gingerly` / `el-maker`

Declare it as a supported feature and forward the two lifecycle callbacks:

```js
static supportedFeatures = {
  ...ElementMaker.supportedFeatures,
  idRefs: {
    fallbackSpawn: () => import('id-referencer').then(m => m.IdRefs),
    callbackForwarding: ['connectedCallback', 'disconnectedCallback'],
  },
};
```

```js
await customElements.assignFeatures(MyElement, {
  idRefs: {
    customData: { eventType: 'id-referencer:resolved' },
    callbackForwarding: ['connectedCallback', 'disconnectedCallback'],
  },
});
```

### Consumption

```js
// point it at a list of ids (host has already parsed them from wherever)
el.idRefs.searchFor = ['sel1', 'sel2'];

// read the resolved elements right away
const found = el.idRefs.elements;          // Element[], in id order, connected only
const done  = el.idRefs.complete;          // boolean

// react to a referenced element showing up / going away later
el.addEventListener('id-referencer:resolved', e => {
  const { ids, elements } = e.detail;
  // re-render against `elements`
});
```

### Worked example — `chip-away`

`chip-away` parses its `for="id1 id2"` attribute to `splitFor: string[]` (roundabout `splitter`
parser), then in its `hydrate()`:

```js
hydrate(self) {
  const { idRefs, splitFor } = self;
  idRefs.searchFor = splitFor;             // (re)point
  const resolved = idRefs.elements;        // live <select>s, in order
  // …render chips for each resolved <select>…
}
```

and re-runs `hydrate()` from an `id-referencer:resolved` listener, so a `<select>` that appears in
the DOM after `<chip-away>` still gets chips.

---

## Edge cases & gotchas

| Situation | Behavior |
| --- | --- |
| Empty / whitespace id string in the list | **Not filtered.** `getElementById('')` returns `null`, so that slot is treated as perpetually missing and the observer stays armed forever. Callers should filter falsy ids before assigning `searchFor`. |
| Same ids, different order | Treated as a change → full re-resolve. |
| `searchFor` assigned while disconnected | Resolves synchronously against `document` (fallback root); observer is **not** armed until `connectedCallback`. |
| Host in a `ShadowRoot` | Resolution and observation are scoped to that `ShadowRoot`. |
| Referenced element replaced by a different element with the same id | Next mutation pass swaps the `WeakRef`; event fires if the identity changed. |
| `elements` read when partially resolved | Returns only the resolved subset (shorter than `searchFor`). Use `complete` to gate. |

---

## Possible improvements for the standalone package

- **Filter falsy ids** in the `searchFor` setter (the code has a commented-out `.filter(Boolean)`).
- **Coalesce** rapid mutation bursts into one microtask before re-resolving / dispatching.
- Optional **predicate / type guard** so a host can say "only accept an `HTMLSelectElement` for
  this id".
- Optional **single-element** convenience accessor for the common one-id case.
- A **shared per-root observer** (`WeakMap<Node, Registry>`) if many instances observe the same
  root.
