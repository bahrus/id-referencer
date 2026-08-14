# Create The Feature

--- 

## Human Ask

The root of this VSCode instance contains multiple submodules that provide various "custom element features."

The folder we are in, [id-referencer](/id-referencer/README.md) is a new, not yet implemented custom element feature.

I will be asking you to implement this, following the instructions of [New Custom Element Feature](../../types/NewCustomElementFeature.md), and, if it helps, inspecting other features in this root directory.

But first, please indicate any ambiguities / issues / suggestions for improvements below.

## Agent's Pre-implementation Thoughts

### Ambiguities / Questions

1. **Configuration mechanism.** The README example passes `customData: { searchFor: ['for', 'aria-controls'] }`, but the `NewCustomElementFeature.md` instructions primarily describe attribute-driven `initVals` via `withAttrs`. Should `searchFor` be supplied as `customData` in the `assignFeatures` config, or should it be parsed from attributes (e.g. `id-referencer-search-for="for aria-controls"`)? Clarifying this determines the constructor signature and the public API.

2. **Attribute-to-property naming.** The README shows `aria-controls` mapping to `.idReferencer.ariaControls`. We need to define the exact kebab-case → camelCase conversion rule, especially for attributes like `for` that have no hyphen.

3. **"Normalized space delimiter".** Needs a precise definition: split on ASCII whitespace, trim each token, collapse empty tokens? This affects parsing of `for="id1  id2"` and similar.

4. **Reference type.** The README exposes `WeakRef<Element>[]`. That is safe against GC but awkward to consume. Should we also expose a convenience accessor that returns dereferenced elements, or keep only the raw `WeakRef` array? If only `WeakRef`s, consumers must handle `deref()` returning `undefined`.

5. **Mutation observer target.** "root node" is ambiguous. Should the observer watch `document`, the host's `rootNode`, or the host's `shadowRoot` if one exists? The correct root depends on where referenced elements are expected to live.

6. **Rest / resume semantics.** The feature should stop observing once all ids for an attribute are found, but only until that attribute changes or the DOM mutates in a way that could invalidate existing refs. Since `WeakRef` does not notify on GC, we cannot auto-resume when a previously found element is collected. We should decide whether periodic re-validation is needed or whether stale refs are acceptable.

7. **Property vs attribute monitoring.** The README says "attributes / properties" but only describes attribute changes. Does the feature also need to react when the corresponding JS property changes? If so, a `hostPropagator`-style mechanism may be needed.

8. **Case sensitivity of ids.** HTML `id`s are case-sensitive. We should preserve case and match exactly, not normalize.

### Issues

1. **Missing project scaffolding.** The repo currently lacks:
   - `IDReferencer.js` feature class
   - `types/id-referencer/types.d.ts`
   - `imports.html`
   - `tests/`
   - `.vscode/settings.json`
   - `.kiro/steering/project-context.md`
   These are required by `NewCustomElementFeature.md`.

2. **Incomplete `package.json`.** Compared to `truth-sourcer/package.json`, `id-referencer/package.json` is missing:
   - `serve`, `update`, `safari`, `chrome` scripts
   - `devDependencies`: `assign-gingerly`, `@playwright/test`, `spa-ssi`
   Without these, `npm run serve` and `playwright test` will not work.

3. **Main file mismatch risk.** `package.json` declares `"main": "IDReferencer.js"`, but that file does not exist yet. The class name should be `IDReferencer` to match the project/feature name.

### Suggestions for Improvement

1. **Use `static onAssigned` to set `observedAttributes` if going the attribute-driven route.** Similar to `TruthSourcer.onAssigned`, this lets the feature register the attributes it watches without forcing the consumer to declare `static observedAttributes` manually.

2. **Forward `attributeChangedCallback` and `connectedCallback` / `disconnectedCallback`.** `id-referencer` needs DOM context to search by id and to manage the mutation observer lifecycle. `callbackForwarding` is the idiomatic pattern for this (see `NewCustomElementFeature.md` § "Callback Forwarding").

3. **Store references as `WeakRef` internally but expose helper getters.** Keep the public API documented in the README (`for`, `ariaControls` returning `WeakRef<Element>[]`) but consider adding a `resolve()` method that returns dereferenced, non-null elements. This preserves safety while improving ergonomics.

4. **Make the search root explicit.** Add a configuration option or derive the root from `host.getRootNode()` at spawn time. For shadow DOM hosts, `getRootNode()` returns the shadow root, which is usually the right search scope.

5. **Add a `validateShape` fallback.** In `supportedFeatures`, declare a `fallbackSpawn: IDReferencer` with a `validateShape` that checks for the expected public properties/methods. This catches injection mismatches early.

6. **Start with a minimal test file.** Create `tests/test1.html` that:
   - Defines a `<test-element>` using `IDReferencer`
   - Sets `for="target1 target2"` and `aria-controls="ctl1"`
   - Inserts referenced elements into the DOM
   - Asserts `el.idReferencer.for.length`, `el.idReferencer.ariaControls.length`, and that refs dereference to the expected elements
   - Removes a referenced element and verifies the `WeakRef` returns `undefined`

7. **Consider using `withAttrs` for the attribute list itself.** If the feature is meant to be configured entirely through `assignFeatures`, `customData` is fine. If it should also parse attributes on the element, use `withAttrs` with a base prefix such as `id-referencer`.

---

## Human Response I

>  Should `searchFor` be supplied as `customData` in the `assignFeatures` config, or should it be parsed from attributes (e.g. `id-referencer-search-for="for aria-controls"`)

The former.

The purpose of this feature is to provide 

