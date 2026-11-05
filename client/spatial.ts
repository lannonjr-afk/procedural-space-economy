export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type Cell = Readonly<{ x: number; y: number; z: number }>;

export class FloatingOrigin {
  private origin: Vec3 = { x: 0, y: 0, z: 0 };
  constructor(private readonly threshold: number) {
    if (!(threshold > 0)) throw new Error("threshold must be positive");
  }
  get current(): Vec3 { return this.origin; }
  /** Returns origin delta; apply its negative to every camera-relative object atomically. */
  update(cameraAbsolute: Vec3): Vec3 | null {
    if (Math.hypot(cameraAbsolute.x - this.origin.x, cameraAbsolute.y - this.origin.y,
                   cameraAbsolute.z - this.origin.z) < this.threshold) return null;
    const next = { x: Math.round(cameraAbsolute.x / this.threshold) * this.threshold,
                   y: Math.round(cameraAbsolute.y / this.threshold) * this.threshold,
                   z: Math.round(cameraAbsolute.z / this.threshold) * this.threshold };
    const delta = { x: next.x - this.origin.x, y: next.y - this.origin.y, z: next.z - this.origin.z };
    this.origin = next;
    return delta;
  }
  relative(absolute: Vec3): Vec3 {
    return { x: absolute.x - this.origin.x, y: absolute.y - this.origin.y, z: absolute.z - this.origin.z };
  }
}

export interface Frustum { planes: readonly Readonly<{a:number;b:number;c:number;d:number}>[] }
export interface OctreeNode<T> { id: string; center: Vec3; halfExtent: number; level: number; payload?: T; children?: readonly OctreeNode<T>[] }
export interface Visible<T> { node: OctreeNode<T>; lod: number }

function outside(node: OctreeNode<unknown>, frustum: Frustum): boolean {
  return frustum.planes.some(p => p.a * node.center.x + p.b * node.center.y + p.c * node.center.z + p.d <
    -node.halfExtent * (Math.abs(p.a) + Math.abs(p.b) + Math.abs(p.c)));
}

export function traverse<T>(root: OctreeNode<T>, frustum: Frustum, camera: Vec3,
                            pixelScale: number, errorPixels = 2): Visible<T>[] {
  const visible: Visible<T>[] = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (outside(node, frustum)) continue;
    const distance = Math.max(1e-6, Math.hypot(camera.x-node.center.x, camera.y-node.center.y, camera.z-node.center.z)-node.halfExtent);
    const projectedError = node.halfExtent * pixelScale / distance;
    if (node.children?.length && projectedError > errorPixels) stack.push(...node.children);
    else visible.push({ node, lod: node.level });
  }
  return visible;
}

/** Byte-budget LRU; disposal callback must release GPU resources and CPU buffers. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>();
  private used = 0;
  constructor(private readonly maxBytes: number, private readonly dispose: (value: V) => void) {
    if (!(maxBytes >= 0)) throw new Error("maxBytes must be nonnegative");
  }
  get bytesUsed(): number { return this.used; }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: K, value: V, bytes: number): void {
    if (bytes < 0) throw new Error("bytes must be nonnegative");
    this.delete(key);
    if (bytes > this.maxBytes) { this.dispose(value); return; }
    this.entries.set(key, { value, bytes }); this.used += bytes;
    while (this.used > this.maxBytes) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key); this.used -= entry.bytes; this.dispose(entry.value); return true;
  }
  clear(): void { for (const key of [...this.entries.keys()]) this.delete(key); }
}

/** Bounded asynchronous queue suitable for a worker-owned mesh generation pipeline. */
export class AsyncTaskQueue<T> {
  private pending: Array<() => Promise<T>> = [];
  private active = 0;
  constructor(private readonly concurrency: number, private readonly maxPending = 256) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || maxPending < 1) throw new Error("invalid queue bounds");
  }
  enqueue(task: () => Promise<T>): Promise<T> {
    if (this.pending.length >= this.maxPending) return Promise.reject(new Error("stream queue full"));
    return new Promise<T>((resolve, reject) => {
      this.pending.push(async () => { try { resolve(await task()); } catch (error) { reject(error); } });
      this.pump();
    });
  }
  private pump(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const task = this.pending.shift()!; this.active++;
      void task().finally(() => { this.active--; this.pump(); });
    }
  }
}
