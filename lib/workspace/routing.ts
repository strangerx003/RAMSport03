import type { DiagramEdge, DiagramNode } from "@/lib/workspace/types";

export type PortSide = "left" | "right" | "top" | "bottom";

const BLOCK_WIDTH = 196;
const BLOCK_HEIGHT = 108;
const GATE_WIDTH = 54;
const GATE_HEIGHT = 60;

export function nodeSize(node: DiagramNode) {
  return node.type.startsWith("gate ")
    ? { width: GATE_WIDTH, height: GATE_HEIGHT }
    : { width: BLOCK_WIDTH, height: BLOCK_HEIGHT };
}

export function lockedPortPoint(node: DiagramNode, side: PortSide) {
  const size = nodeSize(node);
  if (side === "left") return { x: node.x, y: node.y + size.height / 2 };
  if (side === "right") return { x: node.x + size.width, y: node.y + size.height / 2 };
  if (side === "top") return { x: node.x + size.width / 2, y: node.y };
  return { x: node.x + size.width / 2, y: node.y + size.height };
}

export function resolveRbdConnectionSides(from: DiagramNode, to: DiagramNode, edgeIndex = 0): { fromSide: PortSide; toSide: PortSide } {
  const fromSize = nodeSize(from);
  const toSize = nodeSize(to);
  const dx = to.x + toSize.width / 2 - (from.x + fromSize.width / 2);
  const dy = to.y + toSize.height / 2 - (from.y + fromSize.height / 2);
  if (Math.abs(dx) >= Math.abs(dy) * 0.75) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  // Vertical alignment: alternate between right and left ports so parallel
  // connections between stacked blocks do not overlap.
  const alternate = edgeIndex % 2 === 0 ? "right" : "left";
  return { fromSide: alternate, toSide: alternate };
}

/** Assigns missing ports once. Existing ports are never recalculated from block position. */
export function lockRbdConnectionPorts(nodes: DiagramNode[], edges: DiagramEdge[]): DiagramEdge[] {
  const perPair = new Map<string, number>();
  return edges.map((edge, index) => {
    if (edge.fromSide && edge.toSide) return edge;
    const from = nodes.find((node) => node.id === edge.from);
    const to = nodes.find((node) => node.id === edge.to);
    if (!from || !to) return edge;
    const key = `${edge.from}->${edge.to}`;
    const count = perPair.get(key) ?? 0;
    perPair.set(key, count + 1);
    const automatic = resolveRbdConnectionSides(from, to, count);
    return { ...edge, fromSide: edge.fromSide ?? automatic.fromSide, toSide: edge.toSide ?? automatic.toSide };
  });
}

type Point = { x: number; y: number };
type Rectangle = { left: number; right: number; top: number; bottom: number };
type Direction = "h" | "v" | "start";
const ROUTE_CLEARANCE = 12;

function outsidePort(point: Point, side: PortSide, clearance: number = ROUTE_CLEARANCE): Point {
  if (side === "left") return { x: point.x - clearance, y: point.y };
  if (side === "right") return { x: point.x + clearance, y: point.y };
  if (side === "top") return { x: point.x, y: point.y - clearance };
  return { x: point.x, y: point.y + clearance };
}

/**
 * Parallel connections that share one port must attach at *distinct points
 * along that port's edge*. If they all terminate on the same port point, every
 * branch collapses onto one final segment — the "connections overlap when a
 * block is moved" bug. Offsets are centred across the sibling group so N
 * branches fan out symmetrically, independent of global edge order.
 *
 * Returns the offset in pixels along the port edge (Y for left/right ports,
 * X for top/bottom ports) for one end of `edge`.
 */
function siblingLaneInfo(
  edge: DiagramEdge,
  end: "from" | "to",
  allEdges: DiagramEdge[] | undefined,
): { lane: number; count: number } | null {
  if (!allEdges) return null;
  const side = end === "from" ? edge.fromSide ?? "right" : edge.toSide ?? "left";
  const nodeId = end === "from" ? edge.from : edge.to;
  const selfIndex = allEdges.indexOf(edge);
  const group: number[] = [];
  allEdges.forEach((item, index) => {
    const itemSide = end === "from" ? item.fromSide ?? "right" : item.toSide ?? "left";
    const itemNode = end === "from" ? item.from : item.to;
    if (itemNode === nodeId && itemSide === side) group.push(index);
  });
  if (group.length <= 1) return null;
  const lane = group.indexOf(selfIndex);
  if (lane < 0) return null;
  return { lane, count: group.length };
}

function siblingFanOffset(
  edge: DiagramEdge,
  end: "from" | "to",
  allEdges: DiagramEdge[] | undefined,
  edgeIndex: number,
  node: DiagramNode,
): number {
  const laneInfo = siblingLaneInfo(edge, end, allEdges);
  if (!laneInfo) {
    if (!allEdges) return edgeIndex % 2 === 0 ? -8 : 8;
    return 0;
  }
  const { lane, count } = laneInfo;
  const side = end === "from" ? edge.fromSide ?? "right" : edge.toSide ?? "left";
  const size = nodeSize(node);
  const along = side === "left" || side === "right" ? size.height : size.width;
  const usable = Math.max(16, along - 16);
  const step = Math.min(20, usable / (count - 1));
  return (lane - (count - 1) / 2) * step;
}

/** Fans a port point along its own edge, clamped so it stays on the block. */
function fanAlongPort(point: Point, side: PortSide, node: DiagramNode, offset: number): Point {
  if (!offset) return point;
  const size = nodeSize(node);
  if (side === "left" || side === "right") {
    const minY = node.y + 8;
    const maxY = node.y + size.height - 8;
    return { x: point.x, y: Math.min(maxY, Math.max(minY, point.y + offset)) };
  }
  const minX = node.x + 8;
  const maxX = node.x + size.width - 8;
  return { x: Math.min(maxX, Math.max(minX, point.x + offset)), y: point.y };
}

function obstacle(node: DiagramNode): Rectangle {
  const size = nodeSize(node);
  const margin = 10;
  return {
    left: node.x - margin,
    right: node.x + size.width + margin,
    top: node.y - margin,
    bottom: node.y + size.height + margin,
  };
}

function inside(point: Point, rectangle: Rectangle) {
  return point.x > rectangle.left && point.x < rectangle.right && point.y > rectangle.top && point.y < rectangle.bottom;
}

function segmentClear(first: Point, second: Point, obstacles: Rectangle[]) {
  if (first.x !== second.x && first.y !== second.y) return false;
  return obstacles.every((rectangle) => {
    if (first.y === second.y) {
      if (first.y <= rectangle.top || first.y >= rectangle.bottom) return true;
      return (
        Math.max(Math.min(first.x, second.x), rectangle.left) >=
        Math.min(Math.max(first.x, second.x), rectangle.right)
      );
    }
    if (first.x <= rectangle.left || first.x >= rectangle.right) return true;
    return (
      Math.max(Math.min(first.y, second.y), rectangle.top) >=
      Math.min(Math.max(first.y, second.y), rectangle.bottom)
    );
  });
}

function simplify(points: Point[]) {
  const unique = points.filter(
    (point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y,
  );
  return unique.filter((point, index) => {
    if (!index || index === unique.length - 1) return true;
    const before = unique[index - 1];
    const after = unique[index + 1];
    return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y));
  });
}

function perimeterRoute(start: Point, end: Point, obstacles: Rectangle[], padding: number) {
  if (!obstacles.length) return simplify([start, { x: end.x, y: start.y }, end]);
  const left = Math.min(...obstacles.map((item) => item.left)) - padding;
  const right = Math.max(...obstacles.map((item) => item.right)) + padding;
  const top = Math.min(...obstacles.map((item) => item.top)) - padding;
  const bottom = Math.max(...obstacles.map((item) => item.bottom)) + padding;
  const candidates: Point[][] = [
    [start, { x: start.x, y: top }, { x: end.x, y: top }, end],
    [start, { x: start.x, y: bottom }, { x: end.x, y: bottom }, end],
    [start, { x: left, y: start.y }, { x: left, y: end.y }, end],
    [start, { x: right, y: start.y }, { x: right, y: end.y }, end],
    [start, { x: left, y: start.y }, { x: left, y: top }, { x: end.x, y: top }, end],
    [start, { x: right, y: start.y }, { x: right, y: bottom }, { x: end.x, y: bottom }, end],
  ];
  return (
    candidates
      .map(simplify)
      .find((candidate) => candidate.slice(1).every((point, index) => segmentClear(candidate[index], point, obstacles))) ??
    []
  );
}

function orthogonalRoute(start: Point, end: Point, obstacles: Rectangle[], waypoint?: Point): Point[] {
  if (waypoint && !obstacles.some((rectangle) => inside(waypoint, rectangle))) {
    const first = orthogonalRoute(start, waypoint, obstacles);
    const second = orthogonalRoute(waypoint, end, obstacles);
    if (first.length && second.length) return simplify([...first, ...second.slice(1)]);
  }
  const padding = 36;
  const xs = new Set<number>([start.x, end.x, ...obstacles.flatMap((item) => [item.left, item.right])]);
  const ys = new Set<number>([start.y, end.y, ...obstacles.flatMap((item) => [item.top, item.bottom])]);
  if (obstacles.length) {
    xs.add(Math.min(...obstacles.map((item) => item.left)) - padding);
    xs.add(Math.max(...obstacles.map((item) => item.right)) + padding);
    ys.add(Math.min(...obstacles.map((item) => item.top)) - padding);
    ys.add(Math.max(...obstacles.map((item) => item.bottom)) + padding);
  }
  const points: Point[] = [];
  for (const x of xs) {
    for (const y of ys) {
      const point = { x, y };
      if (!obstacles.some((rectangle) => inside(point, rectangle))) points.push(point);
    }
  }
  const indexByPoint = new Map(points.map((point, index) => [`${point.x}:${point.y}`, index]));
  const startIndex = indexByPoint.get(`${start.x}:${start.y}`);
  const endIndex = indexByPoint.get(`${end.x}:${end.y}`);
  if (startIndex === undefined || endIndex === undefined) return perimeterRoute(start, end, obstacles, padding);
  const neighbours = new Map<number, { index: number; direction: Exclude<Direction, "start">; distance: number }[]>();
  const addLink = (a: number, b: number, direction: Exclude<Direction, "start">) => {
    if (!segmentClear(points[a], points[b], obstacles)) return;
    const distance = Math.abs(points[a].x - points[b].x) + Math.abs(points[a].y - points[b].y);
    neighbours.set(a, [...(neighbours.get(a) ?? []), { index: b, direction, distance }]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), { index: a, direction, distance }]);
  };
  for (const y of ys) {
    const row = points
      .map((point, index) => ({ point, index }))
      .filter((item) => item.point.y === y)
      .sort((a, b) => a.point.x - b.point.x);
    for (let index = 1; index < row.length; index += 1) addLink(row[index - 1].index, row[index].index, "h");
  }
  for (const x of xs) {
    const column = points
      .map((point, index) => ({ point, index }))
      .filter((item) => item.point.x === x)
      .sort((a, b) => a.point.y - b.point.y);
    for (let index = 1; index < column.length; index += 1) addLink(column[index - 1].index, column[index].index, "v");
  }
  type State = { point: number; direction: Direction; cost: number; previous?: string };
  const queue: State[] = [{ point: startIndex, direction: "start", cost: 0 }];
  const best = new Map<string, State>();
  best.set(`${startIndex}:start`, queue[0]);
  let final: State | undefined;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const currentKey = `${current.point}:${current.direction}`;
    if (best.get(currentKey)?.cost !== current.cost) continue;
    if (current.point === endIndex) {
      final = current;
      break;
    }
    for (const next of neighbours.get(current.point) ?? []) {
      const cost = current.cost + next.distance + (current.direction !== "start" && current.direction !== next.direction ? 32 : 0);
      const key = `${next.index}:${next.direction}`;
      if (cost >= (best.get(key)?.cost ?? Infinity)) continue;
      const state = { point: next.index, direction: next.direction, cost, previous: currentKey };
      best.set(key, state);
      queue.push(state);
    }
  }
  if (!final) return perimeterRoute(start, end, obstacles, padding);
  const route: Point[] = [];
  let current: State | undefined = final;
  while (current) {
    route.push(points[current.point]);
    current = current.previous ? best.get(current.previous) : undefined;
  }
  return simplify(route.reverse());
}

export function routeRbdConnection(
  nodes: DiagramNode[],
  edge: DiagramEdge,
  edgeIndex = 0,
  allEdges?: DiagramEdge[],
) {
  const from = nodes.find((node) => node.id === edge.from);
  const to = nodes.find((node) => node.id === edge.to);
  if (!from || !to) return { path: "", points: [] as Point[] };
  const automatic = resolveRbdConnectionSides(from, to, edgeIndex);
  const fromSide = edge.fromSide ?? automatic.fromSide;
  const toSide = edge.toSide ?? automatic.toSide;
  const rawStart = lockedPortPoint(from, fromSide);
  const rawEnd = lockedPortPoint(to, toSide);
  const obstacles = nodes.map(obstacle);
  const fromLane = siblingLaneInfo(edge, "from", allEdges);
  const toLane = siblingLaneInfo(edge, "to", allEdges);
  const fannedStart = fanAlongPort(rawStart, fromSide, from, siblingFanOffset(edge, "from", allEdges, edgeIndex, from));
  const fannedEnd = fanAlongPort(rawEnd, toSide, to, siblingFanOffset(edge, "to", allEdges, edgeIndex, to));
  const startExitClearance = fromLane ? ROUTE_CLEARANCE + fromLane.lane * 6 : ROUTE_CLEARANCE + (edgeIndex % 6) * 6;
  const endExitClearance = toLane ? ROUTE_CLEARANCE + toLane.lane * 6 : ROUTE_CLEARANCE + (edgeIndex % 6) * 6;
  const clear = (p: Point) => !obstacles.some((rectangle) => inside(p, rectangle));
  // Pick the best candidate per end: prefer the fanned point with a staggered
  // exit distance; fall back to the raw port point / default clearance if it
  // would land inside another block. A bad lane must never delete a line.
  const pickEnd = (fanned: Point, raw: Point, side: PortSide, fanClearance: number) => {
    const clearances = [fanClearance, ROUTE_CLEARANCE, 24, 36, 48, 72, 96, 120];
    for (const clearance of clearances) {
      for (const point of [fanned, raw]) {
        const exit = outsidePort(point, side, clearance);
        if (clear(exit)) return { point, exit };
      }
    }
    return null;
  };
  const startPicked = pickEnd(fannedStart, rawStart, fromSide, startExitClearance);
  const endPicked = pickEnd(fannedEnd, rawEnd, toSide, endExitClearance);
  if (!startPicked || !endPicked) {
    // Last resort: route the raw port points with the default clearance.
    const so = outsidePort(rawStart, fromSide, ROUTE_CLEARANCE);
    const eo = outsidePort(rawEnd, toSide, ROUTE_CLEARANCE);
    const middle = orthogonalRoute(so, eo, obstacles, edge.waypoint);
    if (!middle.length) return { path: "", points: [] as Point[] };
    return finishRoute(rawStart, so, middle, eo, rawEnd);
  }
  const middle = orthogonalRoute(startPicked.exit, endPicked.exit, obstacles, edge.waypoint);
  if (!middle.length) {
    const so = outsidePort(rawStart, fromSide, ROUTE_CLEARANCE);
    const eo = outsidePort(rawEnd, toSide, ROUTE_CLEARANCE);
    const retry = orthogonalRoute(so, eo, obstacles, edge.waypoint);
    if (!retry.length) return { path: "", points: [] as Point[] };
    return finishRoute(rawStart, so, retry, eo, rawEnd);
  }
  return finishRoute(startPicked.point, startPicked.exit, middle, endPicked.exit, endPicked.point);
}

function finishRoute(start: Point, startOutside: Point, middle: Point[], endOutside: Point, end: Point) {
  const points = simplify([start, startOutside, ...middle.slice(1, -1), endOutside, end]);
  return { path: points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" "), points };
}
