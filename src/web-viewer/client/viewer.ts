/**
 * Fig Viewer - Client Side
 *
 * Handles tree navigation, node selection, and SVG preview rendering.
 */

interface TreeNode {
  id: string;
  type: string;
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  visible?: boolean;
  opacity?: number;
  characters?: string;
  children?: TreeNode[];
  childCount?: number;
}

interface FlatNode {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  absX: number;
  absY: number;
  width: number;
  height: number;
  visible: boolean;
  depth: number;
}

interface NodeDetails {
  id: string;
  type: string;
  name: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  opacity?: number;
  characters?: string;
  fills?: unknown[];
  strokes?: unknown[];
  children?: NodeDetails[];
}

// State
let currentTree: TreeNode | null = null;
let pages: TreeNode[] = [];
let selectedPageId: string | null = null;
let selectedNodeId: string | null = null;
let zoomLevel = 1;
let searchQuery = "";

// Hover/selection state for canvas interaction
let currentRenderNodeId: string | null = null; // The node being rendered in the canvas
let flatNodes: FlatNode[] = []; // Cached flat nodes for the current rendered node
let hoveredNodeId: string | null = null; // Node under cursor
let renderBounds: { minX: number; minY: number; width: number; height: number } | null = null;

// DOM elements
const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const elements = {
  fileName: $<HTMLSpanElement>("file-name"),
  openBtn: $<HTMLButtonElement>("open-btn"),
  search: $<HTMLInputElement>("search"),
  pagesList: $<HTMLDivElement>("pages-list"),
  tree: $<HTMLDivElement>("tree"),
  canvas: $<HTMLDivElement>("canvas"),
  canvasPlaceholder: $<HTMLDivElement>("canvas-placeholder"),
  zoomIn: $<HTMLButtonElement>("zoom-in"),
  zoomOut: $<HTMLButtonElement>("zoom-out"),
  zoomLevel: $<HTMLSpanElement>("zoom-level"),
  zoomFit: $<HTMLButtonElement>("zoom-fit"),
  noSelection: $<HTMLDivElement>("no-selection"),
  nodeDetails: $<HTMLDivElement>("node-details"),
  nodeId: $<HTMLElement>("node-id"),
  copyId: $<HTMLButtonElement>("copy-id"),
  nodeType: $<HTMLSpanElement>("node-type"),
  nodeName: $<HTMLSpanElement>("node-name"),
  nodeX: $<HTMLSpanElement>("node-x"),
  nodeY: $<HTMLSpanElement>("node-y"),
  nodeWidth: $<HTMLSpanElement>("node-width"),
  nodeHeight: $<HTMLSpanElement>("node-height"),
  textSection: $<HTMLDivElement>("text-section"),
  nodeText: $<HTMLDivElement>("node-text"),
  nodeJson: $<HTMLPreElement>("node-json"),
  fileDialog: $<HTMLDivElement>("file-dialog"),
  filePathInput: $<HTMLInputElement>("file-path-input"),
  cancelOpen: $<HTMLButtonElement>("cancel-open"),
  confirmOpen: $<HTMLButtonElement>("confirm-open"),
};

// API helpers
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

async function fetchTree(): Promise<{ tree: TreeNode; meta: Record<string, unknown> }> {
  return api("/api/tree");
}

async function fetchNodeDetails(nodeId: string): Promise<{ node: NodeDetails }> {
  return api(`/api/node/${encodeURIComponent(nodeId)}`);
}

async function fetchNodeRaw(nodeId: string): Promise<{ node: unknown }> {
  return api(`/api/node-raw/${encodeURIComponent(nodeId)}`);
}

async function fetchRenderSvg(nodeId: string): Promise<string> {
  const res = await fetch(`/api/render/${encodeURIComponent(nodeId)}`);
  if (!res.ok) {
    throw new Error("Failed to render");
  }
  return res.text();
}

async function fetchFlatNodes(nodeId: string): Promise<FlatNode[]> {
  const res = await api<{ nodes: FlatNode[] }>(`/api/flat-nodes/${encodeURIComponent(nodeId)}`);
  return res.nodes;
}

async function openFile(filePath: string): Promise<void> {
  await api("/api/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath }),
  });
}

// Tree rendering
function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    DOCUMENT: "D",
    CANVAS: "P",
    FRAME: "F",
    GROUP: "G",
    TEXT: "T",
    RECTANGLE: "R",
    ELLIPSE: "O",
    VECTOR: "V",
    LINE: "L",
    STAR: "*",
    REGULAR_POLYGON: "P",
    COMPONENT: "C",
    COMPONENT_SET: "S",
    INSTANCE: "I",
    BOOLEAN_OPERATION: "B",
    SLICE: "S",
    STICKY: "N",
    SHAPE_WITH_TEXT: "ST",
    CONNECTOR: "CN",
    SECTION: "SE",
  };
  return icons[type] || "?";
}

// Pages rendering
function renderPages() {
  elements.pagesList.innerHTML = "";

  for (const page of pages) {
    const item = document.createElement("div");
    item.className = "page-item";
    if (page.id === selectedPageId) {
      item.classList.add("selected");
    }
    item.dataset.pageId = page.id;

    const icon = document.createElement("span");
    icon.className = "page-icon";
    icon.textContent = "P";
    item.appendChild(icon);

    const name = document.createElement("span");
    name.className = "page-name";
    name.textContent = page.name || "(unnamed)";
    item.appendChild(name);

    item.addEventListener("click", () => selectPage(page.id));

    elements.pagesList.appendChild(item);
  }
}

function selectPage(pageId: string) {
  selectedPageId = pageId;
  selectedNodeId = null;

  // Update pages list selection
  elements.pagesList.querySelectorAll(".page-item").forEach((el) => {
    el.classList.toggle("selected", el.getAttribute("data-page-id") === pageId);
  });

  // Re-render tree for selected page
  renderTree();

  // Clear canvas preview
  elements.canvas.innerHTML = `<div id="canvas-placeholder">Select a node to preview</div>`;

  // Hide node details
  elements.noSelection.classList.remove("hidden");
  elements.nodeDetails.classList.add("hidden");
}

function matchesSearch(node: TreeNode, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    node.name.toLowerCase().includes(q) ||
    node.type.toLowerCase().includes(q) ||
    node.id.toLowerCase().includes(q)
  );
}

function hasMatchingDescendant(node: TreeNode, query: string): boolean {
  if (matchesSearch(node, query)) return true;
  if (node.children) {
    return node.children.some((child) => hasMatchingDescendant(child, query));
  }
  return false;
}

function renderTreeNode(node: TreeNode, depth = 0): HTMLElement {
  const container = document.createElement("div");
  container.className = "tree-node";
  container.dataset.nodeId = node.id;

  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = depth < 2; // Auto-expand first 2 levels

  if (isExpanded && hasChildren) {
    container.classList.add("expanded");
  }

  // Node row
  const row = document.createElement("div");
  row.className = "tree-node-row";
  row.style.paddingLeft = `${depth * 16 + 8}px`;

  if (node.id === selectedNodeId) {
    row.classList.add("selected");
  }

  // Toggle
  const toggle = document.createElement("span");
  toggle.className = `tree-toggle ${hasChildren ? (isExpanded ? "expanded" : "collapsed") : ""}`;
  if (hasChildren) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      container.classList.toggle("expanded");
      toggle.classList.toggle("collapsed");
      toggle.classList.toggle("expanded");
    });
  }
  row.appendChild(toggle);

  // Icon
  const icon = document.createElement("span");
  icon.className = `tree-icon type-${node.type}`;
  icon.textContent = getTypeIcon(node.type);
  row.appendChild(icon);

  // Name
  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = node.name || "(unnamed)";
  row.appendChild(name);

  // Type badge
  const typeBadge = document.createElement("span");
  typeBadge.className = "tree-type";
  typeBadge.textContent = node.type;
  row.appendChild(typeBadge);

  // Click handler
  row.addEventListener("click", () => selectNode(node.id));

  container.appendChild(row);

  // Children container
  if (hasChildren) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "tree-children";
    for (const child of node.children!) {
      if (searchQuery && !hasMatchingDescendant(child, searchQuery)) {
        continue;
      }
      childrenContainer.appendChild(renderTreeNode(child, depth + 1));
    }
    container.appendChild(childrenContainer);
  }

  return container;
}

function renderTree() {
  elements.tree.innerHTML = "";

  // Find the selected page
  const selectedPage = pages.find((p) => p.id === selectedPageId);
  if (!selectedPage) {
    elements.tree.innerHTML = `<div style="padding: 20px; color: #999;">Select a page to view its contents</div>`;
    return;
  }

  // If searching, expand all matching paths
  if (searchQuery) {
    const expandMatching = (el: HTMLElement) => {
      el.classList.add("expanded");
      const toggle = el.querySelector(".tree-toggle");
      if (toggle) {
        toggle.classList.remove("collapsed");
        toggle.classList.add("expanded");
      }
    };

    const fragment = document.createDocumentFragment();
    fragment.appendChild(renderTreeNode(selectedPage));
    elements.tree.appendChild(fragment);

    // Expand all nodes when searching
    elements.tree.querySelectorAll(".tree-node").forEach((el) => {
      expandMatching(el as HTMLElement);
    });
  } else {
    elements.tree.appendChild(renderTreeNode(selectedPage));
  }
}

// Node selection
async function selectNode(nodeId: string, options?: { skipRender?: boolean }) {
  selectedNodeId = nodeId;

  // Update tree selection
  elements.tree.querySelectorAll(".tree-node-row.selected").forEach((el) => {
    el.classList.remove("selected");
  });
  const nodeEl = elements.tree.querySelector(`[data-node-id="${nodeId}"] > .tree-node-row`);
  if (nodeEl) {
    nodeEl.classList.add("selected");
  }

  // Show details panel
  elements.noSelection.classList.add("hidden");
  elements.nodeDetails.classList.remove("hidden");
  elements.nodeId.textContent = nodeId;

  try {
    // Fetch full node details
    const [detailsResult, rawResult] = await Promise.allSettled([
      fetchNodeDetails(nodeId),
      fetchNodeRaw(nodeId),
    ]);

    if (detailsResult.status !== "fulfilled") {
      throw detailsResult.reason;
    }

    const { node } = detailsResult.value;
    const rawNode =
      rawResult.status === "fulfilled"
        ? rawResult.value.node
        : node;

    elements.nodeType.textContent = node.type;
    elements.nodeName.textContent = node.name || "(unnamed)";
    elements.nodeX.textContent = node.x?.toFixed(1) ?? "-";
    elements.nodeY.textContent = node.y?.toFixed(1) ?? "-";
    elements.nodeWidth.textContent = node.width?.toFixed(1) ?? "-";
    elements.nodeHeight.textContent = node.height?.toFixed(1) ?? "-";

    // Text content
    if (node.characters) {
      elements.textSection.classList.remove("hidden");
      elements.nodeText.textContent = node.characters;
    } else {
      elements.textSection.classList.add("hidden");
    }

    // JSON dump
    elements.nodeJson.textContent = JSON.stringify(rawNode, null, 2);

    // Render preview (unless skipRender is true)
    if (!options?.skipRender) {
      await renderPreview(nodeId);
    } else {
      // Just update the selection highlight on the canvas
      updateHoverOverlay(nodeId);
    }
  } catch (err) {
    console.error("Failed to load node details:", err);
  }
}

async function renderPreview(nodeId: string) {
  // Track if this is a new render target (different node being rendered)
  const isNewRenderTarget = nodeId !== currentRenderNodeId;

  try {
    // Fetch SVG and flat nodes in parallel
    const [svg, nodes] = await Promise.all([
      fetchRenderSvg(nodeId),
      fetchFlatNodes(nodeId),
    ]);

    elements.canvas.innerHTML = svg;
    elements.canvasPlaceholder?.remove();

    // Store flat nodes for hit testing
    currentRenderNodeId = nodeId;
    flatNodes = nodes;

    // Calculate render bounds from flat nodes
    if (nodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const node of nodes) {
        minX = Math.min(minX, node.absX);
        minY = Math.min(minY, node.absY);
        maxX = Math.max(maxX, node.absX + node.width);
        maxY = Math.max(maxY, node.absY + node.height);
      }
      renderBounds = { minX, minY, width: maxX - minX, height: maxY - minY };
    } else {
      renderBounds = null;
    }

    // Create hover overlay
    createHoverOverlay();

    // Only reset zoom and fit for new render targets
    if (isNewRenderTarget) {
      zoomLevel = 1;
      updateZoom();

      // Auto-fit if content is larger than viewport
      const svgEl = elements.canvas.querySelector("svg:not(#hover-overlay)");
      if (svgEl) {
        const container = elements.canvas.parentElement!;
        const containerRect = container.getBoundingClientRect();
        const svgWidth = (svgEl as SVGSVGElement).width.baseVal.value || parseFloat(svgEl.getAttribute("width") || "100");
        const svgHeight = (svgEl as SVGSVGElement).height.baseVal.value || parseFloat(svgEl.getAttribute("height") || "100");

        // If content is larger than container, fit it
        if (svgWidth > containerRect.width - 80 || svgHeight > containerRect.height - 80) {
          zoomFit();
        }
      }
    }
  } catch (err) {
    console.error("Failed to render preview:", err);
    elements.canvas.innerHTML = `<div id="canvas-placeholder">Failed to render: ${err}</div>`;
    elements.canvas.style.width = "";
    elements.canvas.style.height = "";
    flatNodes = [];
    renderBounds = null;
  }
}

// Zoom controls
function updateZoom() {
  const container = elements.canvas.parentElement!;

  // Save scroll position relative to content (as percentages)
  const prevScrollLeft = container.scrollLeft;
  const prevScrollTop = container.scrollTop;
  const prevScrollWidth = container.scrollWidth;
  const prevScrollHeight = container.scrollHeight;
  const scrollXRatio = prevScrollWidth > container.clientWidth ? prevScrollLeft / (prevScrollWidth - container.clientWidth) : 0;
  const scrollYRatio = prevScrollHeight > container.clientHeight ? prevScrollTop / (prevScrollHeight - container.clientHeight) : 0;

  elements.zoomLevel.textContent = `${Math.round(zoomLevel * 100)}%`;
  elements.canvas.style.transform = `scale(${zoomLevel})`;

  // Update canvas size to allow proper scrolling at different zoom levels
  const svg = elements.canvas.querySelector("svg:not(#hover-overlay)") as SVGSVGElement | null;
  if (svg) {
    const containerRect = container.getBoundingClientRect();
    const svgWidth = svg.width.baseVal.value || parseFloat(svg.getAttribute("width") || "100");
    const svgHeight = svg.height.baseVal.value || parseFloat(svg.getAttribute("height") || "100");
    const padding = 80; // padding on both sides

    const scaledWidth = (svgWidth + padding) * zoomLevel;
    const scaledHeight = (svgHeight + padding) * zoomLevel;

    // Only set explicit dimensions if content exceeds container (enables scrolling)
    // Otherwise, let min-width/min-height + flexbox handle centering
    if (scaledWidth > containerRect.width || scaledHeight > containerRect.height) {
      elements.canvas.style.width = `${scaledWidth}px`;
      elements.canvas.style.height = `${scaledHeight}px`;
    } else {
      elements.canvas.style.width = "";
      elements.canvas.style.height = "";
    }
  }

  // Restore scroll position proportionally
  requestAnimationFrame(() => {
    const newScrollWidth = container.scrollWidth;
    const newScrollHeight = container.scrollHeight;
    if (newScrollWidth > container.clientWidth) {
      container.scrollLeft = scrollXRatio * (newScrollWidth - container.clientWidth);
    }
    if (newScrollHeight > container.clientHeight) {
      container.scrollTop = scrollYRatio * (newScrollHeight - container.clientHeight);
    }
  });
}

function zoomIn() {
  zoomLevel = Math.min(zoomLevel * 1.25, 10);
  updateZoom();
}

function zoomOut() {
  zoomLevel = Math.max(zoomLevel / 1.25, 0.1);
  updateZoom();
}

function zoomFit() {
  const svg = elements.canvas.querySelector("svg:not(#hover-overlay)") as SVGSVGElement | null;
  if (!svg) return;

  const container = elements.canvas.parentElement!;
  const containerRect = container.getBoundingClientRect();
  const svgWidth = svg.width.baseVal.value || parseFloat(svg.getAttribute("width") || "100");
  const svgHeight = svg.height.baseVal.value || parseFloat(svg.getAttribute("height") || "100");
  const padding = 80; // Account for padding on both sides

  const scaleX = (containerRect.width - padding) / svgWidth;
  const scaleY = (containerRect.height - padding) / svgHeight;
  zoomLevel = Math.min(scaleX, scaleY, 1);

  updateZoom();

  // Reset scroll position to top-left
  container.scrollLeft = 0;
  container.scrollTop = 0;
}

// ============================================================================
// Hover Overlay & Hit Testing
// ============================================================================

let hoverOverlay: SVGSVGElement | null = null;
let svgWrapper: HTMLDivElement | null = null;

function createHoverOverlay() {
  // Remove existing wrapper if any
  if (svgWrapper) {
    svgWrapper.remove();
  }

  // Find the content SVG
  const contentSvg = elements.canvas.querySelector("svg") as SVGSVGElement | null;
  if (!contentSvg) return;

  // Create a wrapper div that will contain both SVGs
  svgWrapper = document.createElement("div");
  svgWrapper.id = "svg-wrapper";
  svgWrapper.style.cssText = `
    position: relative;
    display: inline-block;
  `;

  // Move the content SVG into the wrapper
  contentSvg.parentNode?.insertBefore(svgWrapper, contentSvg);
  svgWrapper.appendChild(contentSvg);

  // Create the overlay SVG
  hoverOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  hoverOverlay.id = "hover-overlay";
  hoverOverlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    overflow: visible;
  `;

  svgWrapper.appendChild(hoverOverlay);
}

function getContentSvg(): SVGSVGElement | null {
  // Try to find the content SVG (could be in wrapper or directly in canvas)
  if (svgWrapper) {
    return svgWrapper.querySelector("svg:not(#hover-overlay)") as SVGSVGElement | null;
  }
  return elements.canvas.querySelector("svg:not(#hover-overlay)") as SVGSVGElement | null;
}

function updateHoverOverlay(nodeId: string | null) {
  if (!hoverOverlay || !renderBounds) return;

  // Clear existing content
  hoverOverlay.innerHTML = "";

  if (!nodeId) return;

  // Find the node in flatNodes
  const node = flatNodes.find((n) => n.id === nodeId);
  if (!node) return;

  // Get SVG dimensions
  const svg = getContentSvg();
  if (!svg) return;

  const svgWidth = svg.width.baseVal.value || parseFloat(svg.getAttribute("width") || "0");
  const svgHeight = svg.height.baseVal.value || parseFloat(svg.getAttribute("height") || "0");

  // Set viewBox to match SVG
  hoverOverlay.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
  hoverOverlay.setAttribute("width", String(svgWidth));
  hoverOverlay.setAttribute("height", String(svgHeight));

  // Calculate position relative to render bounds
  const x = node.absX - renderBounds.minX;
  const y = node.absY - renderBounds.minY;

  // Create hover rectangle
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(node.width));
  rect.setAttribute("height", String(node.height));
  rect.setAttribute("fill", "rgba(0, 120, 212, 0.1)");
  rect.setAttribute("stroke", "#0078d4");
  rect.setAttribute("stroke-width", "2");

  hoverOverlay.appendChild(rect);
}

function screenToDesignCoords(clientX: number, clientY: number): { x: number; y: number } | null {
  const svg = getContentSvg();
  if (!svg || !renderBounds) return null;

  const svgRect = svg.getBoundingClientRect();

  // Get the viewBox dimensions
  const svgWidth = svg.width.baseVal.value || parseFloat(svg.getAttribute("width") || "0");
  const svgHeight = svg.height.baseVal.value || parseFloat(svg.getAttribute("height") || "0");

  // Calculate position within the SVG element (accounting for zoom via CSS transform)
  const relX = (clientX - svgRect.left) / zoomLevel;
  const relY = (clientY - svgRect.top) / zoomLevel;

  // Convert to design coordinates
  const designX = relX + renderBounds.minX;
  const designY = relY + renderBounds.minY;

  return { x: designX, y: designY };
}

function findNodesAtPoint(x: number, y: number): FlatNode[] {
  // Find all nodes that contain the point, sorted by depth (deepest first)
  return flatNodes
    .filter((node) => {
      return (
        node.visible &&
        x >= node.absX &&
        x <= node.absX + node.width &&
        y >= node.absY &&
        y <= node.absY + node.height
      );
    })
    .sort((a, b) => b.depth - a.depth); // Deepest first
}

function findOutermostFrame(nodes: FlatNode[]): FlatNode | null {
  // Find the outermost FRAME (not CANVAS) - shallowest depth that isn't CANVAS
  const frames = nodes.filter((n) => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE");
  if (frames.length === 0) return null;
  // Sort by depth ascending (shallowest first)
  frames.sort((a, b) => a.depth - b.depth);
  return frames[0];
}

function findInnermostSelectable(nodes: FlatNode[]): FlatNode | null {
  // Find the innermost (deepest) node - first in the already sorted array
  if (nodes.length === 0) return null;
  return nodes[0];
}

function expandToNode(nodeId: string) {
  // Find and expand all parent nodes in the tree to reveal the target
  const nodeEl = elements.tree.querySelector(`[data-node-id="${nodeId}"]`);
  if (!nodeEl) return;

  // Walk up the DOM tree and expand all parent tree-nodes
  let current = nodeEl.parentElement;
  while (current) {
    if (current.classList?.contains("tree-node")) {
      current.classList.add("expanded");
      const toggle = current.querySelector(":scope > .tree-node-row > .tree-toggle");
      if (toggle) {
        toggle.classList.remove("collapsed");
        toggle.classList.add("expanded");
      }
    }
    if (current.id === "tree") break;
    current = current.parentElement;
  }

  // Scroll the node into view
  const row = nodeEl.querySelector(":scope > .tree-node-row");
  if (row) {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function handleCanvasMouseMove(e: MouseEvent) {
  if (flatNodes.length === 0) return;

  const coords = screenToDesignCoords(e.clientX, e.clientY);
  if (!coords) {
    hoveredNodeId = null;
    updateHoverOverlay(null);
    return;
  }

  const nodesAtPoint = findNodesAtPoint(coords.x, coords.y);
  const innermost = findInnermostSelectable(nodesAtPoint);

  if (innermost?.id !== hoveredNodeId) {
    hoveredNodeId = innermost?.id ?? null;
    updateHoverOverlay(hoveredNodeId);
  }
}

function handleCanvasClick(e: MouseEvent) {
  if (flatNodes.length === 0) return;

  const coords = screenToDesignCoords(e.clientX, e.clientY);
  if (!coords) return;

  const nodesAtPoint = findNodesAtPoint(coords.x, coords.y);
  const innermost = findInnermostSelectable(nodesAtPoint);

  if (innermost) {
    expandToNode(innermost.id);
    // If the node is in the current flat nodes list, we don't need to re-render
    const isInCurrentView = flatNodes.some((n) => n.id === innermost.id);
    selectNode(innermost.id, { skipRender: isInCurrentView });
  }
}

function handleCanvasDblClick(e: MouseEvent) {
  if (flatNodes.length === 0) return;

  const coords = screenToDesignCoords(e.clientX, e.clientY);
  if (!coords) return;

  const nodesAtPoint = findNodesAtPoint(coords.x, coords.y);
  const innermost = findInnermostSelectable(nodesAtPoint);

  if (innermost) {
    expandToNode(innermost.id);
    selectNode(innermost.id);
  }
}

function handleCanvasMouseLeave() {
  hoveredNodeId = null;
  updateHoverOverlay(null);
}

// File dialog
function showFileDialog() {
  elements.fileDialog.classList.remove("hidden");
  elements.filePathInput.focus();
}

function hideFileDialog() {
  elements.fileDialog.classList.add("hidden");
}

async function handleOpenFile() {
  const filePath = elements.filePathInput.value.trim();
  if (!filePath) return;

  try {
    elements.confirmOpen.disabled = true;
    elements.confirmOpen.textContent = "Loading...";

    await openFile(filePath);
    hideFileDialog();

    // Reset page selection for new file
    selectedPageId = null;
    selectedNodeId = null;

    // Reload tree
    await loadTree();

    // Update file name display
    elements.fileName.textContent = filePath.split("/").pop() || filePath;
  } catch (err) {
    alert(`Failed to open file: ${err}`);
  } finally {
    elements.confirmOpen.disabled = false;
    elements.confirmOpen.textContent = "Open";
  }
}

// Initial load
async function loadTree() {
  try {
    const { tree, meta } = await fetchTree();
    currentTree = tree;

    // Extract pages (CANVAS nodes) from the document
    pages = [];
    if (tree.children) {
      pages = tree.children.filter((child) => child.type === "CANVAS");
    }

    // Auto-select first page if none selected
    if (pages.length > 0 && !selectedPageId) {
      selectedPageId = pages[0].id;
    }

    // Render pages list and tree
    renderPages();
    renderTree();

    // Update file name if available
    if (meta?.name) {
      elements.fileName.textContent = meta.name as string;
    }
  } catch (err) {
    console.error("Failed to load tree:", err);
    pages = [];
    elements.pagesList.innerHTML = "";
    elements.tree.innerHTML = `<div style="padding: 20px; color: #999;">No file loaded. Click "Open File" to start.</div>`;
  }
}

// Copy to clipboard
async function copyNodeId() {
  if (!selectedNodeId) return;
  try {
    await navigator.clipboard.writeText(selectedNodeId);
    const originalText = elements.copyId.textContent;
    elements.copyId.textContent = "Copied!";
    setTimeout(() => {
      elements.copyId.textContent = originalText;
    }, 1000);
  } catch {
    // Fallback
    const textarea = document.createElement("textarea");
    textarea.value = selectedNodeId;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

// Event listeners
function init() {
  // Zoom controls
  elements.zoomIn.addEventListener("click", zoomIn);
  elements.zoomOut.addEventListener("click", zoomOut);
  elements.zoomFit.addEventListener("click", zoomFit);

  // Keyboard zoom
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;

    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      zoomIn();
    } else if (e.key === "-") {
      e.preventDefault();
      zoomOut();
    } else if (e.key === "0") {
      e.preventDefault();
      zoomFit();
    }
  });

  // Mouse wheel zoom
  elements.canvas.parentElement?.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    }
  }, { passive: false });

  // Canvas hover and selection handlers
  elements.canvas.addEventListener("mousemove", handleCanvasMouseMove);
  elements.canvas.addEventListener("click", handleCanvasClick);
  elements.canvas.addEventListener("dblclick", handleCanvasDblClick);
  elements.canvas.addEventListener("mouseleave", handleCanvasMouseLeave);

  // Search
  elements.search.addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderTree();
  });

  // File dialog
  elements.openBtn.addEventListener("click", showFileDialog);
  elements.cancelOpen.addEventListener("click", hideFileDialog);
  elements.confirmOpen.addEventListener("click", handleOpenFile);
  elements.filePathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleOpenFile();
    } else if (e.key === "Escape") {
      hideFileDialog();
    }
  });
  elements.fileDialog.addEventListener("click", (e) => {
    if (e.target === elements.fileDialog) {
      hideFileDialog();
    }
  });

  // Copy ID
  elements.copyId.addEventListener("click", copyNodeId);

  // Initial load
  loadTree();
}

// Start
document.addEventListener("DOMContentLoaded", init);
