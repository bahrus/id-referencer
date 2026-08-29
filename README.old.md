# id-referencer

*id-referencer* is a custom element feature that searches for DOM elements matching id references from specified attributes / properties.

## Usage

```JS
customElements.assignFeatures(MyHTMLElement, {
    idReferencer: { 
        spawn: IDReferencer,
        customData: {
            searchFor: ['for', 'aria-controls']
        } 
    }
});
```

What this does:

1.  Monitors for changes to these attributes
2.  Parses the attributes based on normalized space delimiter.
3.  Searches for elements matching the ids.
4.  Creates weak references to them accessible via:

```TS
const forRefs = oMyHTMLElement.idReferencer.for as WeakRef<Element>[];
const ariaControls = oMyHTMLElement.idReferencer.ariaControls as WeakRef<Element>[];
```

5.  The moment all the id's have been found for an attribute, the feature can "rest" when it comes to that attribute, as long as the attribute value doesn't change.  In contrast, if not all matching elements are found, a mutation observer should be created on the root node, and keep testing new elements for matching id.


## Viewing Demos Locally

1. Install git
2. Fork/clone this repo
3. Install node.js
4. Open command window to folder where you cloned this repo
5. > git submodule add https://github.com/bahrus/types.git types
6. > git submodule update --init --recursive
7. > npm install
8. > npm run serve
9. Open http://localhost:8000/ in a modern browser