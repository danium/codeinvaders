import type { ArenaSnapshot } from './arena.js';
import * as THREE from 'three';

export interface ArenaCanvas {
  readonly width: number;
  readonly height: number;
  getContext(
    type: 'webgl' | 'experimental-webgl',
    attributes?: unknown,
  ): WebGLRenderingContext | null;
}
const VERTEX_SHADER =
  'attribute vec2 a_position; attribute vec3 a_color; varying vec3 v_color; void main(){gl_Position=vec4(a_position,0.0,1.0);gl_PointSize=6.0;v_color=a_color;}';
const FRAGMENT_SHADER =
  'precision mediump float; varying vec3 v_color; void main(){vec2 p=gl_PointCoord-vec2(0.5);if(dot(p,p)>0.25)discard;gl_FragColor=vec4(v_color,1.0);}';

/** Minimal local WebGL renderer. Semantic transitions remain owned by the mapper and DOM feed. */
export class WebGLArenaRenderer {
  private gl: WebGLRenderingContext | undefined;
  private program: WebGLProgram | undefined;
  private buffer: WebGLBuffer | undefined;
  private position: number | undefined;
  private color: number | undefined;
  private reducedMotion = false;
  initialize(canvas: ArenaCanvas): boolean {
    try {
      const gl =
        canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }) ??
        canvas.getContext('experimental-webgl');
      if (!gl) return false;
      const vertex = this.compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = this.compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      if (!vertex || !fragment) return false;
      const program = gl.createProgram();
      if (!program) {
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        return false;
      }
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteProgram(program);
        return false;
      }
      const buffer = gl.createBuffer();
      if (!buffer) return false;
      this.gl = gl;
      this.program = program;
      this.buffer = buffer;
      this.position = gl.getAttribLocation(program, 'a_position');
      this.color = gl.getAttribLocation(program, 'a_color');
      return true;
    } catch {
      this.dispose();
      return false;
    }
  }
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }
  render(snapshot: ArenaSnapshot, _semanticTime: number): void {
    void _semanticTime;
    const gl = this.gl,
      program = this.program,
      buffer = this.buffer;
    if (!gl || !program || !buffer) return;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.04, 0.09, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const visible = snapshot.entities.filter((entity) => entity.visible).slice(0, 1000);
    const values: number[] = [];
    for (let i = 0; i < visible.length; i++) {
      const entity = visible[i]!;
      const x = ((i % 20) / 19) * 1.8 - 0.9;
      const y = (Math.floor(i / 20) / Math.max(1, Math.ceil(visible.length / 20) - 1)) * 1.8 - 0.9;
      const [r, g, b] =
        entity.kind === 'carrier'
          ? [0.35, 0.83, 0.77]
          : entity.kind === 'child-ship'
            ? [0.45, 0.68, 0.95]
            : entity.kind === 'fallback'
              ? [0.96, 0.82, 0.4]
              : entity.status === 'failed'
                ? [0.95, 0.35, 0.35]
                : [0.85, 0.9, 0.93];
      values.push(x, y, r, g, b);
    }
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.position!);
    gl.vertexAttribPointer(this.position!, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.color!);
    gl.vertexAttribPointer(this.color!, 3, gl.FLOAT, false, 20, 8);
    gl.drawArrays(gl.POINTS, 0, visible.length);
    if (!this.reducedMotion) gl.flush();
  }
  dispose(): void {
    if (this.gl && this.program) this.gl.deleteProgram(this.program);
    if (this.gl && this.buffer) this.gl.deleteBuffer(this.buffer);
    this.gl = undefined;
    this.program = undefined;
    this.buffer = undefined;
  }
  private compile(
    gl: WebGLRenderingContext,
    type: number,
    source: string,
  ): WebGLShader | undefined {
    const shader = gl.createShader(type);
    if (!shader) return undefined;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return undefined;
    }
    return shader;
  }
}
export interface ThreeArenaOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly maxEntities?: number;
  readonly maxEffects?: number;
  readonly reducedMotion?: boolean;
}

/** Three.js presentation layer: instanced entities/effects, absolute semantic time, explicit disposal. */
export class ThreeArenaRenderer {
  private renderer: THREE.WebGLRenderer | undefined;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly entityGeometry = new THREE.SphereGeometry(0.035, 6, 4);
  private readonly entityMaterial = new THREE.MeshBasicMaterial({ color: 0x8ea9b8 });
  private readonly effectGeometry = new THREE.SphereGeometry(0.012, 5, 3);
  private readonly effectMaterial = new THREE.MeshBasicMaterial({ color: 0x58d4c5 });
  private readonly maxEntities: number;
  private readonly maxEffects: number;
  private entityPool:
    THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | undefined;
  private effectPool:
    THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | undefined;
  private reducedMotion: boolean;
  private readonly marker = new THREE.Object3D();
  constructor(options: ThreeArenaOptions = {}) {
    this.maxEntities = Math.max(100, Math.min(1000, options.maxEntities ?? 1000));
    this.maxEffects = Math.max(1, Math.min(300, options.maxEffects ?? 300));
    this.reducedMotion = options.reducedMotion ?? false;
    this.camera.position.z = 2;
    if (options.canvas) this.initialize(options.canvas);
  }
  initialize(canvas: HTMLCanvasElement): boolean {
    try {
      this.renderer?.dispose();
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'low-power',
      });
      this.renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio || 1));
      this.renderer.setSize(
        canvas.clientWidth || canvas.width,
        canvas.clientHeight || canvas.height,
        false,
      );
      this.entityPool = new THREE.InstancedMesh(
        this.entityGeometry,
        this.entityMaterial,
        this.maxEntities,
      );
      this.effectPool = new THREE.InstancedMesh(
        this.effectGeometry,
        this.effectMaterial,
        this.maxEffects,
      );
      this.entityPool.count = 0;
      this.effectPool.count = 0;
      this.scene.add(this.entityPool, this.effectPool);
      return true;
    } catch {
      this.dispose();
      return false;
    }
  }
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }
  render(snapshot: ArenaSnapshot, semanticTime: number): void {
    if (!this.renderer || !this.entityPool || !this.effectPool) return;
    const entities = snapshot.entities
      .filter((entity) => entity.visible)
      .slice(0, this.maxEntities);
    this.entityPool.count = entities.length;
    for (let index = 0; index < entities.length; index++) {
      const entity = entities[index]!;
      this.marker.position.set((index % 20) / 10 - 0.95, Math.floor(index / 20) / 10 - 0.95, 0);
      this.marker.updateMatrix();
      this.entityPool.setMatrixAt(index, this.marker.matrix);
      this.entityMaterial.color.set(
        entity.kind === 'carrier'
          ? 0x58d4c5
          : entity.kind === 'child-ship'
            ? 0x73a7ee
            : entity.kind === 'fallback'
              ? 0xf6d365
              : entity.status === 'failed'
                ? 0xef6565
                : 0xd7e3e8,
      );
    }
    this.entityPool.instanceMatrix.needsUpdate = true;
    const effectCount = this.reducedMotion ? 0 : Math.min(this.maxEffects, snapshot.effects);
    this.effectPool.count = effectCount;
    this.effectPool.rotation.z = this.reducedMotion ? 0 : semanticTime * 0.0001;
    for (let index = 0; index < effectCount; index++) {
      this.marker.position.set(-0.9 + (index % 30) / 17, -0.85 + Math.floor(index / 30) / 17, 0);
      this.marker.updateMatrix();
      this.effectPool.setMatrixAt(index, this.marker.matrix);
    }
    this.effectPool.instanceMatrix.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
  dispose(): void {
    if (this.entityPool) this.scene.remove(this.entityPool);
    if (this.effectPool) this.scene.remove(this.effectPool);
    this.entityPool = undefined;
    this.effectPool = undefined;
    this.entityGeometry.dispose();
    this.entityMaterial.dispose();
    this.effectGeometry.dispose();
    this.effectMaterial.dispose();
    this.renderer?.dispose();
    this.renderer = undefined;
  }
}
