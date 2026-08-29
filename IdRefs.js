// @ts-check
/** @import {FeatureSpawnContext, IdRefsCustomData, IIdRefs} from './types/id-referencer/types' */

const DEFAULT_EVENT_TYPE = 'id-referencer:resolved';

/**
 * `IdRefs` — a custom element feature that resolves a list of element ids to
 * live elements against the host's root node, and keeps watching the DOM
 * until every id has been found.
 *
 * Local implementation of https://github.com/bahrus/id-referencer (kept here
 * until it proves out; the class name `IdRefs` matches the intended package
 * export). Unlike the package README's first sketch, this variant does **not**
 * read a host attribute — the host hands it an already-split `string[]` of ids
 * via the {@linkcode IdRefs#searchFor} setter. That keeps the id-list parsing (attribute →
 * `string[]`) in the host's reactive graph (roundabout `splitter` parser) and
 * leaves this feature with the single reusable job: `string[]` → live
 * `Element[]`, with "wait for the missing ones" built in.
 *
 * Wiring:
 * ```js
 * customElements.assignFeatures(MyElement, {
 *     idRefs: { spawn: IdRefs, customData: { eventType: 'id-referencer:resolved' } }
 * });
 * ```
 *
 * Consumption:
 * ```js
 * el.idRefs.searchFor = ['sel1', 'sel2'];   // (re)point at these ids
 * el.idRefs.elements;                       // Element[] — resolved, still-connected, in order
 * el.idRefs.complete;                    // boolean
 * el.addEventListener('id-referencer:resolved', e => { ... });
 * ```
 *
 * @implements {IIdRefs}
 */
export class IdRefs {
    /** @type {WeakRef<HTMLElement>} */
    #hostRef;

    /** @type {string} */
    #eventType;

    /** current ordered id list @type {string[]} */
    #ids = [];

    /** resolved refs, index-aligned with {@linkcode #ids} @type {(WeakRef<Element> | undefined)[]} */
    #refs = [];

    /** @type {MutationObserver | undefined} */
    #rootObserver;

    /** whether the host is currently connected (drives observer arming) @type {boolean} */
    #connected = false;

    /**
     * @param {HTMLElement} hostElement
     * @param {FeatureSpawnContext} ctx
     * @param {Partial<IdRefsCustomData>} [initVals]
     */
    constructor(hostElement, ctx, initVals) {
        this.#hostRef = new WeakRef(hostElement);
        /** @type {IdRefsCustomData} */
        const customData = ctx?.injection?.customData ?? {};
        this.#eventType = customData.eventType ?? DEFAULT_EVENT_TYPE;

        if (initVals) Object.assign(this, initVals);
    }

    // ─── lifecycle (forwarded from the host) ──────────────────────────────────

    connectedCallback() {
        this.#connected = true;
        // Re-arm the root observer if we reconnected with ids still outstanding.
        if (this.#ids.length) this.#resolve(false);
    }

    disconnectedCallback() {
        this.#connected = false;
        this.#rootObserver?.disconnect();
        this.#rootObserver = undefined;
    }

    // ─── public API ──────────────────────────────────────────────────────────

    /**
     * @type {string[]}
     */
    #searchFor = [];

    get searchFor(){
        return this.#searchFor;
    }

    /**
     * Point the feature at a new list of ids to resolve. Idempotent — passing
     * the same ids in the same order is a no-op.
     *
     * Resolves synchronously against the host's root node; the caller is
     * expected to read {@linkcode elements} right after. If any id is still missing,
     * a MutationObserver is kept alive on the root node until it appears, and
     * `eventType` is dispatched on the host when a later (DOM-mutation-driven)
     * pass changes the resolved set. The synchronous pass here never dispatches.
     *
     * @param {string[]} nv
     */
    set searchFor(nv){
        this.#searchFor = nv;
        const next = (nv ?? []); //.filter(Boolean);
        if (sameList(next, this.#ids)) return;
        this.#ids = next.slice();
        this.#refs = new Array(next.length);
        this.#resolve(false);
    }

    /**
     * The resolved, still-connected elements, in the order their ids were
     * passed to {@linkcode IdRefs#searchFor}.
     * @returns {Element[]}
     */
    get elements() {
        /** @type {Element[]} */
        const out = [];
        for (const ref of this.#refs) {
            const el = ref?.deref();
            if (el && el.isConnected) out.push(el);
        }
        return out;
    }

    /** True once every id has been resolved to a still-connected element. */
    get complete() {
        return this.elements.length >= this.#ids.length;
    }

    // ─── internals ───────────────────────────────────────────────────────────

    /** @returns {Document | ShadowRoot} */
    #root() {
        const root = this.#hostRef.deref()?.getRootNode();
        return root instanceof ShadowRoot ? root : document;
    }

    /**
     * (Re-)resolve every still-missing id. Arms the root observer while
     * anything is outstanding and the host is connected; rests it otherwise.
     * @param {boolean} dispatch whether to fire `eventType` if the set changed
     */
    #resolve(dispatch) {
        const root = this.#root();
        const before = dispatch ? this.elements : null;

        let missing = 0;
        for (let i = 0; i < this.#ids.length; i++) {
            const current = this.#refs[i]?.deref();
            if (current && current.isConnected) continue;
            const el = root.getElementById(this.#ids[i]);
            if (el) this.#refs[i] = new WeakRef(el);
            else {
                this.#refs[i] = undefined;
                missing++;
            }
        }

        if (missing > 0 && this.#connected) this.#arm();
        else this.#rest();

        if (dispatch && before && !sameElements(before, this.elements)) this.#dispatch();
    }

    #arm() {
        if (this.#rootObserver) return;
        this.#rootObserver = new MutationObserver(() => this.#resolve(true));
        this.#rootObserver.observe(this.#root(), {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['id'],
        });
    }

    #rest() {
        this.#rootObserver?.disconnect();
        this.#rootObserver = undefined;
    }

    #dispatch() {
        const host = this.#hostRef.deref();
        if (!host) return;
        host.dispatchEvent(new CustomEvent(this.#eventType, {
            detail: { 
                ids: this.#ids.slice(), 
                elements: this.elements,
            },
        }));
    }
}

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 */
function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * @param {readonly Element[]} a
 * @param {readonly Element[]} b
 */
function sameElements(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
