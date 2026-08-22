'use client';

/**
 * @fileoverview Accessible, URL-backed presentation of an assembled org forest.
 *
 * This component is the render boundary for build.md F3. It receives roots
 * that `buildForest()` has already ordered and `filterForest()` has already
 * narrowed. It does not resolve reporting edges, elect a principal root,
 * derive a department, classify a departure, or decide which nodes match a
 * query. Those are domain decisions and arrive here as immutable fields or
 * explicit props.
 *
 * ## Interaction contract
 *
 * The tree uses the WAI-ARIA tree roles required by build.md NFR 2 and one
 * roving `tabIndex`. Arrow keys move through the currently visible treeitems;
 * Right expands or enters a branch; Left collapses or returns to the parent;
 * Home and End reach the visible bounds; Enter and Space select the focused
 * node. Mouse selection and keyboard selection both set only `?person=`,
 * preserving source, filter, departure, and review state.
 *
 * Expansion is intentionally local UI state rather than a seventh URL
 * parameter. The URL contract in build.md §H.3 names exactly six dimensions,
 * and expansion is governed by three fixed controls: expand all, collapse all,
 * and reset to depth two. Every sibling list, including the forest roots, is
 * capped at fifteen until its explicit “show N more” control is used.
 *
 * ## Visual contract
 *
 * design.md §9.3 maps unselected nodes to flat 81px hairline rows and selected
 * or expanded nodes to Remote's maroon panel. Connector rails use the verified
 * grid-line token; synthetic parent rails use the authorized dashed accent
 * treatment. Indentation stops accumulating after eight levels while the real
 * depth remains visible, satisfying build.md §F.2 without inventing a second
 * mobile or deep-tree design.
 *
 * @see planning/build.md F3 — hierarchical tree and node content
 * @see planning/build.md F9 — matches versus retained context ancestors
 * @see planning/build.md §F.2 — sibling cap, depth cap, nulls, departures
 * @see planning/build.md §H.3 — controls, URL selection, and legend
 * @see planning/design.md §9.3 — locked tree-item visual treatment
 */

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { isDeparted } from '@/domain/normalize';
import type { OrgNode } from '@/domain/types';

/** Maximum visible siblings before the specified reveal control appears. */
const VISIBLE_SIBLING_LIMIT = 15;

/** Maximum number of nested rail offsets; the actual node depth is unchanged. */
const MAX_INDENT_DEPTH = 8;

/** Stable identity for the forest's imaginary parent and root sibling list. */
const ROOT_LIST_ID = 'tree-roots';

/** Inputs supplied by the request boundary after assembly and filtering. */
export type TreeProps = {
  /** Ordered roots from the filtered forest; this component never reorders them. */
  roots: OrgNode[];
  /** Selected full-forest node id, or null when no selectable principal exists. */
  selectedId: string | null;
  /** IDs returned by `filterForest().matchedIds`, serialized for the client boundary. */
  matchedIds: string[];
  /** Person ids whose full names collide and therefore require short-id disambiguation. */
  duplicateNameIds: string[];
  /** Whether search or department matching is active, even when it has zero matches. */
  hasMatchFilter: boolean;
  /** Whether any narrowing control, including hide-departed, is active. */
  hasActiveViewFilter: boolean;
};

/**
 * Collect every node id without changing the forest's canonical order.
 *
 * The result supports local state validation and the Expand all control. It is
 * not a second forest index: the request-side `Forest.byId` remains the domain
 * index, while this serializable client component receives roots only.
 */
function collectNodes(roots: OrgNode[]): OrgNode[] {
  const nodes: OrgNode[] = [];
  const stack = [...roots].reverse();

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    nodes.push(node);
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child !== undefined) stack.push(child);
    }
  }

  return nodes;
}

/**
 * Return the branch ids expanded by the locked depth-two default.
 *
 * A node at depth 0 or 1 must be open for nodes through depth 2 to be visible.
 * Leaves are excluded because `aria-expanded` is not meaningful on them.
 */
function depthTwoExpansion(nodes: OrgNode[]): Set<string> {
  return new Set(
    nodes
      .filter((node) => node.children.length > 0 && node.depth < 2)
      .map((node) => node.id),
  );
}

/**
 * Render the neutral hierarchy marker occupying Remote's 32px lead column.
 *
 * This is neither a portrait nor an invented person identity. It is an
 * aria-hidden line diagram of one hierarchy node, using the verified accent
 * token and the line-icon rules in design.md §9.6.
 */
function HierarchyMarker({ synthetic }: { synthetic: boolean }) {
  return (
    <svg aria-hidden="true" className="size-8" fill="none" viewBox="0 0 32 32">
      <circle cx="16" cy="11" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M16 15v6m-7 0h14M9 21v4m14-4v4"
        stroke="currentColor"
        strokeDasharray={synthetic ? '3 3' : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * Render the compact disclosure geometry aligned to the 24px action shell.
 */
function BranchChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-4 transition-transform duration-200${expanded ? ' rotate-180' : ''}`}
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      <path
        d="m7 9 5 5 5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * Format a critical field without hiding an operator-owned absence.
 *
 * Job title and department are the two critical nulls in build.md §F.2. Their
 * missing state names People Ops; informational nulls are handled in the
 * person card and render as an em dash instead.
 */
function criticalValue(value: string | null, label: 'Job title' | 'Department'): string {
  return value === null || value.trim() === ''
    ? `${label} missing · contact People Ops`
    : value;
}

/**
 * Render the tree, its fixed view controls, legend, and purpose-built empty state.
 *
 * @param props filtered roots, selected identity, and match identity
 * @returns one accessible organization tree without recomputing domain facts
 */
export function Tree({
  roots,
  selectedId,
  matchedIds,
  duplicateNameIds,
  hasMatchFilter,
  hasActiveViewFilter,
}: TreeProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const treeRef = useRef<HTMLUListElement>(null);
  const allNodes = useMemo(() => collectNodes(roots), [roots]);
  const allIds = useMemo(() => new Set(allNodes.map((node) => node.id)), [allNodes]);
  const matchSet = useMemo(() => new Set(matchedIds), [matchedIds]);
  const duplicateNameSet = useMemo(() => new Set(duplicateNameIds), [duplicateNameIds]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    depthTwoExpansion(allNodes),
  );
  const [revealedLists, setRevealedLists] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(() => roots[0]?.id ?? null);

  /**
   * Keep the single roving tab stop inside the rendered filtered forest.
   *
   * URL-backed filtering can remove the previously focused node without a local
   * keyboard event. Deriving the fallback during render avoids a state-setting
   * effect and guarantees the first visible root becomes tabbable immediately.
   */
  const rovingActiveId = activeId !== null && allIds.has(activeId) ? activeId : roots[0]?.id;

  /** Build a person-selection URL while preserving the other five dimensions. */
  function personHref(id: string): string {
    const next = new URLSearchParams(searchParams.toString());
    next.set('person', id);
    const serialized = next.toString();
    return serialized === '' ? pathname : `${pathname}?${serialized}`;
  }

  /** Select one visible node through the same URL used by mouse links. */
  function selectNode(id: string): void {
    setActiveId(id);
    router.push(personHref(id), { scroll: false });
  }

  /** Return treeitems in the browser's current visible order. */
  function visibleTreeItems(): HTMLElement[] {
    if (treeRef.current === null) return [];
    return Array.from(treeRef.current.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }

  /** Move DOM focus and the roving tab stop together. */
  function focusTreeItem(item: HTMLElement | undefined): void {
    if (item === undefined) return;
    const id = item.dataset['treeNodeId'];
    if (id === undefined) return;
    setActiveId(id);
    item.focus();
  }

  /** Find one visible treeitem by its data identity without CSS escaping. */
  function visibleItemById(id: string): HTMLElement | undefined {
    return visibleTreeItems().find((item) => item.dataset['treeNodeId'] === id);
  }

  /** Toggle one branch without changing selection or any URL state. */
  function toggleBranch(id: string): void {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Apply the complete keyboard contract to the focused treeitem.
   */
  function handleTreeKeyDown(
    event: KeyboardEvent<HTMLElement>,
    node: OrgNode,
    parentId: string | null,
  ): void {
    const items = visibleTreeItems();
    const currentIndex = items.findIndex((item) => item.dataset['treeNodeId'] === node.id);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusTreeItem(items[currentIndex + 1]);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusTreeItem(items[currentIndex - 1]);
        return;
      case 'Home':
        event.preventDefault();
        focusTreeItem(items[0]);
        return;
      case 'End':
        event.preventDefault();
        focusTreeItem(items.at(-1));
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (node.children.length === 0) return;
        if (!expandedIds.has(node.id)) {
          setExpandedIds((current) => new Set(current).add(node.id));
          requestAnimationFrame(() => {
            focusTreeItem(visibleItemById(node.children[0]?.id ?? ''));
          });
          return;
        }
        focusTreeItem(visibleItemById(node.children[0]?.id ?? ''));
        return;
      case 'ArrowLeft':
        event.preventDefault();
        if (expandedIds.has(node.id) && node.children.length > 0) {
          setExpandedIds((current) => {
            const next = new Set(current);
            next.delete(node.id);
            return next;
          });
          return;
        }
        if (parentId !== null) focusTreeItem(visibleItemById(parentId));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectNode(node.id);
        return;
      default:
        return;
    }
  }

  /** Expand every branch represented by the currently filtered forest. */
  function expandAll(): void {
    setExpandedIds(
      new Set(allNodes.filter((node) => node.children.length > 0).map((node) => node.id)),
    );
  }

  /** Collapse every branch while retaining the roots themselves. */
  function collapseAll(): void {
    setExpandedIds(new Set());
    setActiveId(roots[0]?.id ?? null);
  }

  /** Restore the exact depth-two first-paint state and sibling caps. */
  function resetDepthTwo(): void {
    setExpandedIds(depthTwoExpansion(allNodes));
    setRevealedLists(new Set());
    setActiveId(roots[0]?.id ?? null);
  }

  /** Reveal the remainder of one sibling list without expanding another branch. */
  function revealList(listId: string): void {
    setRevealedLists((current) => new Set(current).add(listId));
  }

  /**
   * Render one canonically ordered sibling group.
   *
   * The recursion follows the domain's existing child arrays and never sorts,
   * counts, or resolves anything. Nested group margin stops after level eight;
   * the node's actual `depth` remains available for the required deep label.
   */
  function renderGroup(
    nodes: OrgNode[],
    parentId: string | null,
    parentKind: OrgNode['kind'] | null,
  ) {
    const listId = parentId ?? ROOT_LIST_ID;
    const revealed = revealedLists.has(listId);
    const visibleNodes = revealed ? nodes : nodes.slice(0, VISIBLE_SIBLING_LIMIT);
    const remaining = nodes.length - visibleNodes.length;
    const parentDepth = parentId === null ? -1 : (nodes[0]?.depth ?? 1) - 1;
    const nested = parentId !== null;
    const railClass =
      parentKind === 'external' || parentKind === 'unresolved'
        ? 'synthetic-edge'
        : 'border-l-[var(--rule)] border-[var(--grid-line)]';
    const mayIndent = !nested || parentDepth < MAX_INDENT_DEPTH;

    return (
      <ul
        aria-label={nested ? undefined : 'Organizational reporting hierarchy'}
        className={
          nested
            ? `${railClass}${mayIndent ? ' ml-[var(--space-5)] pl-[var(--space-4)]' : ''}`
            : 'm-0 list-none p-0'
        }
        ref={nested ? undefined : treeRef}
        role={nested ? 'group' : 'tree'}
      >
        {visibleNodes.map((node) => {
          const expanded = node.children.length > 0 && expandedIds.has(node.id);
          const selected = node.id === selectedId;
          const emphasized = selected || expanded;
          const matched = matchSet.has(node.id);
          const contextOnly = hasMatchFilter && !matched;
          const departed = node.person !== null && isDeparted(node.person);
          const jobTitle =
            node.person === null
              ? node.kind === 'external'
                ? 'Outside Remote'
                : 'Reporting pointer unresolved'
              : criticalValue(node.person.jobTitle, 'Job title');
          const department =
            node.person === null
              ? null
              : criticalValue(node.person.department.name, 'Department');

          return (
            <li className="list-none" key={node.id} role="none">
              <div
                aria-expanded={node.children.length > 0 ? expanded : undefined}
                aria-level={node.depth + 1}
                aria-selected={selected}
                className={`${emphasized ? 'selected-panel' : 'hairline-row flex items-center'} relative my-[var(--space-2)] focus-visible:z-10`}
                data-tree-node-id={node.id}
                onFocus={() => {
                  setActiveId(node.id);
                }}
                onKeyDown={(event) => {
                  handleTreeKeyDown(event, node, parentId);
                }}
                role="treeitem"
                tabIndex={rovingActiveId === node.id ? 0 : -1}
              >
                <span
                  className={
                    emphasized
                      ? 'absolute left-[var(--space-5)] top-[var(--space-5)] text-[var(--selected-ink)]'
                      : 'mr-[var(--space-4)] shrink-0 text-[var(--accent)]'
                  }
                >
                  <HierarchyMarker synthetic={node.kind !== 'person'} />
                </span>

                <div
                  className={`${emphasized ? 'selected-panel__content flex-col gap-[var(--space-2)] pr-12' : `min-h-8 flex-1 flex-row items-center gap-[var(--space-1)]${node.children.length > 0 ? ' pr-12' : ''}`} flex min-w-0`}
                >
                  <Link
                    className={`section-title bidi-isolate text-current no-underline${emphasized ? ' w-fit max-w-full' : ' max-w-[36%] shrink-0'}`}
                    href={personHref(node.id)}
                    onClick={() => {
                      setActiveId(node.id);
                    }}
                    tabIndex={-1}
                  >
                    {node.displayName}
                  </Link>

                  <p
                    className={`${emphasized ? 'expanded-copy text-[var(--selected-ink-secondary)]' : 'micro-copy min-w-0 text-[var(--ink-secondary)]'} bidi-isolate`}
                  >
                    {jobTitle}
                    {department === null ? '' : ` · ${department}`}
                  </p>

                  <div
                    className={`flex items-center gap-[var(--space-2)]${emphasized ? ' flex-wrap' : ' shrink-0'}`}
                  >
                    <span className="status-pill">
                      {emphasized
                        ? `${String(node.directReports)} direct `
                        : `${String(node.directReports)} `}
                      {node.directReports === 1 ? 'report' : 'reports'}
                    </span>
                    {duplicateNameSet.has(node.id) &&
                    node.person?.shortId !== null &&
                    node.person?.shortId !== undefined ? (
                      <span className="micro-copy bidi-isolate">ID {node.person.shortId}</span>
                    ) : null}
                    {departed ? <span className="status-pill">Departed</span> : null}
                    {matched ? <span className="status-pill">Match</span> : null}
                    {contextOnly ? <span className="status-pill">Context</span> : null}
                    {node.kind === 'external' ? (
                      <span className="status-pill">Outside Remote</span>
                    ) : null}
                    {node.depth > MAX_INDENT_DEPTH ? (
                      <span className="micro-copy">Depth {node.depth}</span>
                    ) : null}
                  </div>
                </div>

                {node.children.length > 0 ? (
                  <button
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.displayName}`}
                    className={`icon-action absolute right-[var(--space-5)] top-[var(--space-5)]${emphasized ? ' icon-action--inverse' : ''}`}
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      toggleBranch(node.id);
                    }}
                    tabIndex={-1}
                    style={{
                      top: emphasized
                        ? 'var(--space-5)'
                        : 'calc((var(--row-height) - var(--status-pill-height)) / 2)',
                    }}
                    type="button"
                  >
                    <BranchChevron expanded={expanded} />
                  </button>
                ) : null}
              </div>

              {expanded ? renderGroup(node.children, node.id, node.kind) : null}
            </li>
          );
        })}

        {remaining > 0 ? (
          <li className="list-none py-[var(--space-2)]" role="none">
            <button
              className="outline-action"
              onClick={() => {
                revealList(listId);
              }}
              type="button"
            >
              Show {remaining} more
            </button>
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <section
      className="flex flex-col gap-[var(--space-4)]"
      aria-labelledby="organization-tree-title"
      style={{
        width: '100%',
        padding: 'var(--space-4)',
        border: 'var(--rule) solid var(--divider)',
        borderRadius: 'var(--radius-panel)',
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-[var(--space-3)]"
        style={{
          minHeight: 'var(--status-pill-height)',
          padding: 'var(--space-2) var(--space-2) var(--space-4)',
          borderBottom: 'var(--rule) solid var(--divider)',
        }}
      >
        <h2 className="section-title" id="organization-tree-title">
          Organization
        </h2>
        <div className="flex flex-wrap gap-[var(--space-2)]" aria-label="Tree view controls">
          <button
            className="outline-action"
            onClick={expandAll}
            type="button"
          >
            Expand all
          </button>
          <button
            className="outline-action"
            onClick={collapseAll}
            type="button"
          >
            Collapse all
          </button>
          <button
            className="outline-action"
            onClick={resetDepthTwo}
            type="button"
          >
            Restore default view
          </button>
        </div>
      </div>

      <div className="micro-copy flex flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-2)]" aria-label="Tree legend">
        <span>Solid rail · Remote employment</span>
        <span>Dashed rail · external or unresolved manager</span>
        <span>Rose badge · status or data context</span>
      </div>

      {roots.length === 0 ? (
        <div className="hairline-row flex flex-col justify-center gap-[var(--space-2)]">
          <p className="body-strong">
            {hasActiveViewFilter ? 'No people match this view.' : 'No employments are available.'}
          </p>
          {hasActiveViewFilter ? (
            <p className="body-copy text-[var(--ink-secondary)]">
              Clear the active filters to restore the organization.
            </p>
          ) : (
            <p className="body-copy text-[var(--ink-secondary)]">
              The snapshot is empty. Re-run pnpm sync and verify the Remote employment scope.
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-auto" aria-label="Scrollable organization hierarchy">
          {renderGroup(roots, null, null)}
        </div>
      )}
    </section>
  );
}
