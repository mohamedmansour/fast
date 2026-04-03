import { HydrationMarkup } from "../components/hydration.js";
import type {
    CompiledViewBehaviorFactory,
    ViewBehaviorFactory,
    ViewBehaviorTargets,
} from "../templating/html-directive.js";

export class HydrationTargetElementError extends Error {
    /**
     * String representation of the HTML in the template that
     * threw the target element error.
     */
    public templateString?: string;

    constructor(
        /**
         * The error message
         */
        message: string | undefined,
        /**
         * The Compiled View Behavior Factories that belong to the view.
         */
        public readonly factories: CompiledViewBehaviorFactory[],
        /**
         * The node to target factory.
         */
        public readonly node: Element
    ) {
        super(message);
    }
}

/**
 * Represents the DOM boundaries controlled by a view
 */
export interface ViewBoundaries {
    first: Node;
    last: Node;
}

/**
 * Stores relationships between a {@link ViewBehaviorFactory} and
 * the {@link ViewBoundaries} the factory created.
 */
export interface ViewBehaviorBoundaries {
    [factoryId: string]: ViewBoundaries;
}

function isComment(node: Node): node is Comment {
    return node.nodeType === Node.COMMENT_NODE;
}

function isText(node: Node): node is Text {
    return node.nodeType === Node.TEXT_NODE;
}

/**
 * Returns a range object inclusive of all nodes including and between the
 * provided first and last node.
 * @param first - The first node
 * @param last - This last node
 * @returns
 */
export function createRangeForNodes(first: Node, last: Node): Range {
    const range = document.createRange();
    range.setStart(first, 0);

    // The lastIndex should be inclusive of the end of the lastChild. Obtain offset based
    // on usageNotes:  https://developer.mozilla.org/en-US/docs/Web/API/Range/setEnd#usage_notes
    range.setEnd(
        last,
        isComment(last) || isText(last) ? last.data.length : last.childNodes.length
    );
    return range;
}

function isShadowRoot(node: Node): node is ShadowRoot {
    return node instanceof DocumentFragment && "mode" in node;
}

/**
 * Maps {@link CompiledViewBehaviorFactory} ids to the corresponding node targets for the view.
 * @param firstNode - The first node of the view.
 * @param lastNode -  The last node of the view.
 * @param factories - The Compiled View Behavior Factories that belong to the view.
 * @returns - A {@link ViewBehaviorTargets } object for the factories in the view.
 */
export function buildViewBindingTargets(
    firstNode: Node,
    lastNode: Node,
    factories: CompiledViewBehaviorFactory[]
): { targets: ViewBehaviorTargets; boundaries: ViewBehaviorBoundaries } {
    const range = createRangeForNodes(firstNode, lastNode);
    const treeRoot = range.commonAncestorContainer;
    const hydrationIndexOffset = getHydrationIndexOffset(factories);
    const walker = document.createTreeWalker(
        treeRoot,
        NodeFilter.SHOW_ELEMENT + NodeFilter.SHOW_COMMENT + NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                return range.comparePoint(node, 0) === 0
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            },
        }
    );
    const targets: ViewBehaviorTargets = {};
    const boundaries: ViewBehaviorBoundaries = {};

    let node: Node | null = (walker.currentNode = firstNode);

    while (node !== null) {
        switch (node.nodeType) {
            case Node.ELEMENT_NODE: {
                targetElement(node as Element, factories, targets, hydrationIndexOffset);
                break;
            }

            case Node.COMMENT_NODE: {
                targetComment(
                    node as Comment,
                    walker,
                    factories,
                    targets,
                    boundaries,
                    hydrationIndexOffset
                );
                break;
            }
        }

        node = walker.nextNode();
    }

    range.detach();
    return { targets, boundaries };
}

function targetElement(
    node: Element,
    factories: CompiledViewBehaviorFactory[],
    targets: ViewBehaviorTargets,
    hydrationIndexOffset: number
) {
    // Check for attributes and map any factories.
    const attrFactoryIds =
        HydrationMarkup.parseAttributeBinding(node) ??
        HydrationMarkup.parseEnumeratedAttributeBinding(node) ??
        HydrationMarkup.parseCompactAttributeBinding(node);

    if (attrFactoryIds !== null) {
        for (const id of attrFactoryIds) {
            const factory = factories[id + hydrationIndexOffset];
            if (!factory) {
                throw new HydrationTargetElementError(
                    `HydrationView was unable to successfully target factory on ${
                        node.nodeName
                    } inside ${
                        (node.getRootNode() as ShadowRoot).host.nodeName
                    }. This likely indicates a template mismatch between SSR rendering and hydration.`,
                    factories,
                    node
                );
            }
            targetFactory(factory, node, targets);
        }

        node.removeAttribute(HydrationMarkup.attributeMarkerName);
    }
}

function targetComment(
    node: Comment,
    walker: TreeWalker,
    factories: CompiledViewBehaviorFactory[],
    targets: ViewBehaviorTargets,
    boundaries: ViewBehaviorBoundaries,
    hydrationIndexOffset: number
) {
    if (HydrationMarkup.isElementBoundaryStartMarker(node)) {
        skipToElementBoundaryEndMarker(node, walker);
        return;
    }

    if (HydrationMarkup.isContentBindingStartMarker(node.data)) {
        const parsed = HydrationMarkup.parseContentBindingStartMarker(node.data);

        if (parsed === null) {
            return;
        }

        const [index, id] = parsed;

        const factory = factories[index + hydrationIndexOffset];
        const nodes: Node[] = [];
        let current: Node | null = walker.nextSibling();
        node.data = "";
        const first = current!;

        // Search for the binding end marker that closes the binding.
        while (current !== null) {
            if (isComment(current)) {
                const parsed = HydrationMarkup.parseContentBindingEndMarker(current.data);

                if (parsed && parsed[1] === id) {
                    break;
                }
            }

            nodes.push(current);
            current = walker.nextSibling();
        }

        if (current === null) {
            const root = node.getRootNode();
            throw new Error(
                `Error hydrating Comment node inside "${
                    isShadowRoot(root) ? root.host.nodeName : root.nodeName
                }".`
            );
        }

        (current as Comment).data = "";
        if (nodes.length === 1 && isText(nodes[0])) {
            targetFactory(factory, nodes[0], targets);
        } else {
            // If current === first, it means there is no content in
            // the view. This happens when a `when` directive evaluates false,
            // or whenever a content binding returns null or undefined.
            // In that case, there will never be any content
            // to hydrate and Binding can simply create a HTMLView
            // whenever it needs to.
            if (current !== first && current.previousSibling !== null) {
                boundaries[factory.targetNodeId] = {
                    first,
                    last: current.previousSibling,
                };
            }
            // Binding evaluates to null / undefined or a template.
            // If binding revaluates to string, it will replace content in target
            // So we always insert a text node to ensure that
            // text content binding will be written to this text node instead of comment
            const dummyTextNode = current.parentNode!.insertBefore(
                document.createTextNode(""),
                current
            );
            targetFactory(factory, dummyTextNode, targets);
        }
    }
}

/**
 * Moves TreeWalker to element boundary end marker
 * @param node - element boundary start marker node
 * @param walker - tree walker
 */
function skipToElementBoundaryEndMarker(node: Comment, walker: TreeWalker) {
    const id = HydrationMarkup.parseElementBoundaryStartMarker(node.data);
    let current = walker.nextSibling();

    while (current !== null) {
        if (isComment(current)) {
            const parsed = HydrationMarkup.parseElementBoundaryEndMarker(current.data);
            if (parsed && parsed === id) {
                break;
            }
        }

        current = walker.nextSibling();
    }
}

function getHydrationIndexOffset(factories: CompiledViewBehaviorFactory[]): number {
    let offset = 0;

    for (let i = 0, ii = factories.length; i < ii; ++i) {
        if (factories[i].targetNodeId === "h") {
            offset++;
        } else {
            break;
        }
    }

    return offset;
}

export function targetFactory(
    factory: ViewBehaviorFactory,
    node: Node,
    targets: ViewBehaviorTargets
): void {
    if (factory.targetNodeId === undefined) {
        // Dev error, this shouldn't ever be thrown
        throw new Error("Factory could not be target to the node");
    }

    targets[factory.targetNodeId] = node;
}


/**
 * A structured representation of a single client-side binding expectation,
 * derived from the factory list. This is the client-side counterpart to the
 * server's `extractMarkerTree` and can be compared against the server marker
 * tree to detect mismatches.
 * @public
 */
export interface ClientBindingNode {
    /** Zero-based index of the factory in the compiled factory array. */
    factoryIndex: number;
    /** Structural DOM node ID the factory targets. */
    targetNodeId: string;
    /** The {@link DOMAspect} type (0 = none, 1 = attribute, etc.). */
    aspectType: number;
    /** Human-readable binding expression, if available. */
    bindingExpression?: string;
    /** Tag name of the target element, if known. */
    tagName?: string;
}

/**
 * Maps a compiled factory list into a structured array of
 * {@link ClientBindingNode} entries. This allows tooling to compare
 * the client-side expected binding tree against the server-emitted
 * hydration markers.
 *
 * @param factories - The compiled factory array from the template.
 * @returns An array of {@link ClientBindingNode} objects, one per factory.
 * @public
 */
export function extractClientBindingTree(
    factories: ReadonlyArray<{ targetNodeId: string; aspectType?: number }>,
): ClientBindingNode[] {
    return factories.map((factory, index) => {
        const info = factory as Record<string, unknown>;
        const node: ClientBindingNode = {
            factoryIndex: index,
            targetNodeId: factory.targetNodeId,
            aspectType: factory.aspectType ?? 0,
        };

        // Pull the binding expression string when available.
        if (typeof info.dataBinding === "object" && info.dataBinding !== null) {
            const binding = info.dataBinding as Record<string, unknown>;
            if (typeof binding.toString === "function") {
                node.bindingExpression = String(binding);
            }
        } else if (typeof info.sourceAspect === "string") {
            node.bindingExpression = info.sourceAspect;
        }

        // Capture the target tag name if the factory carries one.
        if (typeof info.targetTagName === "string") {
            node.tagName = info.targetTagName;
        }

        return node;
    });
}

/**
 * Analyzes the depth difference between expected and available paths to help
 * diagnose hydration targeting issues. Depth is measured by counting dot
 * separators in each path string.
 *
 * @param expectedPath - The path that was expected to be found
 * @param availablePaths - Array of paths that were actually available
 * @returns Analysis object with depth information and likely cause
 * @public
 */
export function depthAnalysis(expectedPath: string, availablePaths: string[]): {
    commonPrefix: string;
    expectedDepth: number;
    nearestAvailableDepth: number;
    depthDifference: number;
    likelyCause: string;
} {
    const countDots = (s: string): number => {
        let n = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i] === ".") n++;
        }
        return n;
    };

    const expectedDepth = countDots(expectedPath);

    if (availablePaths.length === 0) {
        return {
            commonPrefix: "",
            expectedDepth,
            nearestAvailableDepth: 0,
            depthDifference: expectedDepth,
            likelyCause: "directive_element_mismatch",
        };
    }

    // Find the longest common character prefix among all paths (including expected).
    const allPaths = [expectedPath, ...availablePaths];
    let commonPrefix = allPaths[0];
    for (let i = 1; i < allPaths.length; i++) {
        let j = 0;
        while (j < commonPrefix.length && j < allPaths[i].length && commonPrefix[j] === allPaths[i][j]) {
            j++;
        }
        commonPrefix = commonPrefix.substring(0, j);
    }

    // Trim to the last complete segment (end at a dot boundary).
    const lastDot = commonPrefix.lastIndexOf(".");
    if (lastDot !== -1) {
        commonPrefix = commonPrefix.substring(0, lastDot + 1);
    } else if (commonPrefix !== expectedPath && commonPrefix !== availablePaths[0]) {
        // Partial segment match — not a complete prefix.
        commonPrefix = "";
    }

    // Pick the available path whose depth is closest to the expected depth.
    const availableDepths = availablePaths.map(countDots);
    let nearestAvailableDepth = availableDepths[0];
    for (let i = 1; i < availableDepths.length; i++) {
        if (
            Math.abs(availableDepths[i] - expectedDepth) <
            Math.abs(nearestAvailableDepth - expectedDepth)
        ) {
            nearestAvailableDepth = availableDepths[i];
        }
    }

    const depthDifference = Math.abs(expectedDepth - nearestAvailableDepth);

    // Heuristic cause classification.
    let likelyCause: string;
    if (depthDifference >= 2) {
        likelyCause = "directive_element_mismatch";
    } else if (depthDifference === 0) {
        likelyCause = "missing_marker";
    } else {
        // depthDifference === 1
        likelyCause = "duplicate_node";
    }

    return {
        commonPrefix,
        expectedDepth,
        nearestAvailableDepth,
        depthDifference,
        likelyCause,
    };
}

