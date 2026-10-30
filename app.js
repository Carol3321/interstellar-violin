/*
 * 星际轨道 · 粒子小提琴
 * 纯 WebGL2 粒子场景，无贴图、无依赖。
 * 结构照参考视频：一把粒子小提琴，琴弦延伸成一条穿过它的五线谱——
 * 谱线上串着 𝄞 谱号、♪ 音符、△ 三角标记；另有几道虚线弧缠在琴上，弧上按等间距串着 ○ □ ◇ 标记点。
 */
(() => {
  'use strict';

  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
  if (!gl) { document.getElementById('nogl').hidden = false; return; }

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* ---------------- 确定性随机 + 噪声 ---------------- */
  let seed = 20261030;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rr = (a, b) => a + (b - a) * rnd();
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };

  const hash3 = (x, y, z) => {
    let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 1274126177;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  };
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const a = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
    const b = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
    const c = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
    const d = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(a, b, v), lerp(c, d, v), w);
  }
  // 参考里那种冰晶 / 大理石斑驳质感
  const fbm = (x, y, z) =>
    vnoise(x, y, z) * 0.60 + vnoise(x * 2.13, y * 2.13, z * 2.13) * 0.27 + vnoise(x * 4.37, y * 4.37, z * 4.37) * 0.13;

  /* ---------------- 调色板（近白 + 冰蓝，几乎不带紫） ---------------- */
  const C = {
    white: [0.98, 0.99, 1.00],
    ice: [0.72, 0.85, 1.00],
    blue: [0.34, 0.50, 1.00],
    steel: [0.20, 0.30, 0.62],
    deep: [0.07, 0.10, 0.26],
  };
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /* ---------------- 几何收集器 ---------------- */
  const mk = () => ({ p: [], c: [], s: [], ph: [] });
  const BATCH = { violin: mk(), ribbon: mk(), mark: mk(), rest: mk() };
  function pt(e, x, y, z, col, size) {
    e.p.push(x, y, z); e.c.push(col[0], col[1], col[2]); e.s.push(size); e.ph.push(rnd());
  }

  /* ================= 小提琴（轴线沿 +Z，面板法线 +Y） ================= */
  const V = { z0: -0.62, len: 1.18, thick: 0.058 };
  const VS = 6.2, TILT = -0.12;
  const BODY_CZ = (V.z0 + V.len / 2) * VS;

  (function violin() {
    const e = BATCH.violin;

    // 半宽控制点：明显的上下琴箱 + 腰部凹进
    const WP = [0.148, 0.238, 0.302, 0.328, 0.286, 0.246, 0.172, 0.242, 0.282, 0.306, 0.288, 0.228, 0.172];
    const n = WP.length - 1;
    const halfW = (u) => {
      const x = clamp(u, 0, 1) * n;
      const i = Math.min(n - 1, Math.floor(x)), f = x - i;
      const p0 = WP[Math.max(0, i - 1)], p1 = WP[i], p2 = WP[i + 1], p3 = WP[Math.min(n, i + 2)];
      return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
    };
    const zAt = (u) => V.z0 + u * V.len;

    // f 孔：两侧对称的斜向长缝
    const inFhole = (u, v) => {
      if (u < 0.345 || u > 0.60) return false;
      const center = 0.086 + (u - 0.47) * 0.20;
      return Math.abs(Math.abs(v) - center) < 0.0155;
    };

    for (let i = 0; i < 88000; i++) {
      const u = rnd();
      const w = halfW(u);
      const v = (rnd() * 2 - 1) * w;
      const z = zAt(u);
      const hole = inFhole(u, v);
      if (hole && rnd() < 0.55) continue;
      const q = Math.min(1, Math.abs(v) / w);
      const surface = Math.sqrt(Math.max(0, 1 - q * q));
      const side = rnd() < 0.5 ? 1 : -1;
      const y = side * (0.012 + V.thick * surface * (0.55 + 0.65 * fbm(z * 9.5, v * 9.5, u * 6)));
      const f1 = fbm(z * 13 + 1.7, v * 13, u * 8 + 3.1);
      const f2 = fbm(z * 37, v * 37 + 9, u * 21);
      let col = mixc(C.steel, C.ice, clamp(0.10 + f1 * 0.85, 0, 1));
      col = mixc(col, C.white, Math.pow(clamp(f2, 0, 1), 2.4) * 1.1 * surface);
      if (rnd() < 0.02) col = C.white;
      if (hole) {
        col = mixc(C.deep, [0.03, 0.04, 0.12], rnd());             // 孔内压暗
      } else {
        const lit = 0.55 + 0.45 * (v / w + 0.35) * 0.6;            // 极简方向光
        col = [col[0] * lit, col[1] * lit, col[2] * lit];
      }
      pt(e, v, y, z, col, (0.005 + Math.pow(rnd(), 2) * 0.018) * (hole ? 0.6 : 1));
    }

    // 面板高光条
    for (let s = 0; s < 7; s++) {
      const v0 = (rnd() * 2 - 1) * 0.62;
      const u0 = rr(0.06, 0.9), u1 = Math.min(1, u0 + rr(0.15, 0.5));
      for (let k = 0; k < 420; k++) {
        const u = lerp(u0, u1, k / 419);
        const w = halfW(u);
        const v = v0 * w + Math.sin(u * 9 + s) * 0.012;
        const q = Math.min(1, Math.abs(v) / w);
        const y = 0.012 + V.thick * Math.sqrt(Math.max(0, 1 - q * q)) * 0.98;
        pt(e, v, y, zAt(u), mixc(C.white, C.ice, rnd() * 0.35), 0.010 + rnd() * 0.006);
      }
    }

    // 琴身柔光（喂泛光）
    for (let i = 0; i < 300; i++) {
      const u = rr(0.05, 0.95);
      const w = halfW(u) * 1.05;
      pt(e, (rnd() * 2 - 1) * w, gauss() * 0.10, zAt(u), mixc(C.blue, C.ice, rnd() * 0.5), 0.10 + rnd() * 0.18);
    }

    // 轮廓高光：两层，越靠边越亮，让轮廓在加法混合里也立得住
    for (let i = 0; i < 16000; i++) {
      const u = rnd(), w = halfW(u), s = rnd() < 0.5 ? 1 : -1;
      const outer = i % 3 !== 0;
      const v = s * w * (outer ? 0.99 + rnd() * 0.008 : 0.93 + rnd() * 0.05);
      pt(e, v, (rnd() * 2 - 1) * 0.03, zAt(u),
        outer ? C.white : mixc(C.white, C.ice, 0.5), outer ? 0.016 + rnd() * 0.010 : 0.012);
    }

    // f 孔亮边 + 孔内暗部
    for (let i = 0; i < 4200; i++) {
      const u = rr(0.345, 0.60);
      const s = rnd() < 0.5 ? 1 : -1;
      const center = 0.086 + (u - 0.47) * 0.20;
      pt(e, s * (center + (rnd() < 0.5 ? 1 : -1) * 0.018), 0.086 + gauss() * 0.002, zAt(u),
        mixc(C.white, C.ice, rnd() * 0.3), 0.010 + rnd() * 0.008);
    }
    for (let i = 0; i < 1800; i++) {
      const u = rr(0.345, 0.60);
      const s = rnd() < 0.5 ? 1 : -1;
      const center = 0.086 + (u - 0.47) * 0.20;
      pt(e, s * (center + gauss() * 0.006), gauss() * 0.01, zAt(u), C.blue, 0.02);
    }

    // 琴桥
    for (let i = 0; i < 2600; i++) {
      pt(e, gauss() * 0.070, 0.130 + gauss() * 0.010, zAt(0.402 + gauss() * 0.005),
        mixc(C.white, C.ice, rnd() * 0.4), 0.008 + rnd() * 0.007);
    }

    // 系弦板
    for (let i = 0; i < 2600; i++) {
      const u = rr(0.03, 0.25);
      const w = 0.044 * (1 - (u - 0.03) * 1.6);
      pt(e, (rnd() * 2 - 1) * w, 0.070 + gauss() * 0.008, zAt(u), mixc(C.blue, C.steel, rnd()), 0.009 + rnd() * 0.007);
    }

    // 指板：暗面 + 亮边
    for (let i = 0; i < 9000; i++) {
      const u = rr(0.58, 1.02);
      const w = 0.062 - 0.014 * (u - 0.58);
      const edge = Math.abs(rnd() * 2 - 1) > 0.93;
      pt(e, (rnd() * 2 - 1) * w, 0.058 + gauss() * 0.005, zAt(u),
        edge ? mixc(C.ice, C.white, rnd()) : mixc(C.deep, C.steel, 0.3 + rnd() * 0.4), 0.006 + rnd() * 0.006);
    }

    // 琴颈
    for (let i = 0; i < 7000; i++) {
      const z = rr(0.54, 1.00);
      const w = 0.042 - 0.010 * (z - 0.54);
      pt(e, (rnd() * 2 - 1) * w, -0.03 + (rnd() * 2 - 1) * 0.020, z,
        mixc(C.steel, C.ice, 0.4 + rnd() * 0.5), 0.006 + rnd() * 0.006);
    }

    // 琴头涡卷
    for (let i = 0; i < 4200; i++) {
      const s = rnd();
      const ang = s * 8.4 - 1.1;
      const rad = 0.062 * (1 - 0.55 * s);
      pt(e, gauss() * 0.024, 0.010 + rad * Math.cos(ang), 1.01 + 0.075 * s + rad * Math.sin(ang),
        mixc(C.ice, C.white, rnd() * 0.7), 0.007 + rnd() * 0.006);
    }

    // 四根琴弦
    for (const sx of [-0.025, -0.0085, 0.0085, 0.025]) {
      for (let i = 0; i < 1200; i++) {
        const z = lerp(-0.44, 1.02, i / 1199);
        const y = 0.135 + 0.012 * Math.sin((z + 0.44) / 1.46 * Math.PI) + (z < 0.40 ? (0.40 - z) * 0.06 : 0);
        pt(e, sx + gauss() * 0.0018, y, z, C.white, 0.0055 + rnd() * 0.004);
      }
      for (let i = 0; i < 70; i++) {
        pt(e, sx + gauss() * 0.004, 0.135 + gauss() * 0.006, rr(-0.44, 1.02), mixc(C.ice, C.white, 0.7), 0.045);
      }
    }

    // 放大 + 倾斜
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    for (let i = 0; i < e.p.length; i += 3) {
      const x = e.p[i] * VS, y = e.p[i + 1] * VS, z = e.p[i + 2] * VS;
      e.p[i] = x * ct - y * st;
      e.p[i + 1] = x * st + y * ct;
      e.p[i + 2] = z;
    }
  })();

  /* ================= 五线谱：5 条平行的细亮线，从琴弦延伸出去并在空间里弯折 ================= */
  // 谱线的中轴（返回 [x,y,z]，s ∈ [-1,1] 沿 +Z 方向）
  const staffAxis = (s) => [
    2.6 * Math.sin(s * 1.15) + 0.9 * Math.sin(s * 3.1),
    1.05 + 2.4 * Math.sin(s * 1.35 + 0.25) + 0.9 * Math.sin(s * 2.6),
    s * 12.5,
  ];
  const STAFF_GAP = 0.62;
  const STAFF_HALF = 2;                       // 5 条线：-2..2

  function staffPoint(line, s) {
    const a = staffAxis(s);
    // 用切线附近的"上方向"做偏移，保证 5 条线始终平行
    const b = staffAxis(s + 0.004);
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let ux = 0, uy = 1, uz = 0;                 // up 取 +Y 在切线法平面上的投影
    const d = uy * ty;
    ux -= tx * d; uy -= ty * d; uz -= tz * d;
    const ul = Math.hypot(ux, uy, uz) || 1;
    const off = line * STAFF_GAP;
    return [a[0] + (ux / ul) * off, a[1] + (uy / ul) * off, a[2] + (uz / ul) * off];
  }

  (function staff() {
    const e = BATCH.ribbon;
    const N = 900;                            // 每条线的点数 → 点链读起来像细实线
    for (let line = -STAFF_HALF; line <= STAFF_HALF; line++) {
      for (let i = 0; i <= N; i++) {
        const s = -1 + (2 * i) / N;
        const p = staffPoint(line, s);
        // 线头的小圆点
        const isEnd = i === 0 || i === N;
        const jitter = 0.012;
        pt(e, p[0] + gauss() * jitter, p[1] + gauss() * jitter, p[2] + gauss() * jitter,
          isEnd ? C.white : mixc(C.white, C.ice, 0.15 + rnd() * 0.3), isEnd ? 0.075 : 0.034 + rnd() * 0.014);
      }
    }
  })();

  /* ================= 标记点：△ ○ □ ◇，按等间距串在谱线和弧线上 ================= */
  const MARK_PTS = {};
  (function buildMarkShapes() {
    const mkShape = (fn, n) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push(fn(i / n));
      return out;
    };
    MARK_PTS.circle = mkShape((t) => [Math.cos(t * TAU) * 0.5, Math.sin(t * TAU) * 0.5], 72);
    MARK_PTS.square = mkShape((t) => {
      const a = t * TAU;
      const k = 0.5 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      return [Math.cos(a) * k, Math.sin(a) * k];
    }, 64);
    MARK_PTS.triangle = mkShape((t) => {
      const a = t * TAU + Math.PI / 2;
      const r = 0.5 / Math.max(Math.cos(((a % (TAU / 3)) + TAU) % (TAU / 3) - Math.PI / 3), -0.5);
      return [Math.cos(a) * Math.min(r, 1), Math.sin(a) * Math.min(r, 1)];
    }, 64);
    MARK_PTS.diamond = mkShape((t) => {
      const a = t * TAU;
      const k = 0.5 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
      return [Math.cos(a) * k, Math.sin(a) * k];
    }, 64);
  })();

  // 在世界坐标 p 处、沿 (right, up) 两个基向量摆一个标记
  function stampMark(p, right, up, shape, size, col) {
    const pts = MARK_PTS[shape];
    for (const g of pts) {
      const x = p[0] + right[0] * g[0] * size + up[0] * g[1] * size;
      const y = p[1] + right[1] * g[0] * size + up[1] * g[1] * size;
      const z = p[2] + right[2] * g[0] * size + up[2] * g[1] * size;
      pt(BATCH.mark, x, y, z, col, 0.040 + rnd() * 0.016);
    }
  }

  // 求谱线在 s 处的局部基（right 沿切线，up 沿谱面法向上方向）
  function staffBasis(s) {
    const a = staffAxis(s), b = staffAxis(s + 0.004);
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let ux = 0, uy = 1, uz = 0;
    const d = ux * tx + uy * ty + uz * tz;
    ux -= tx * d; uy -= ty * d; uz -= tz * d;
    const ul = Math.hypot(ux, uy, uz) || 1;
    return { tangent: [tx, ty, tz], up: [ux / ul, uy / ul, uz / ul] };
  }

  (function staffMarks() {
    // 三角：沿中间那条线等间距（参考里最显眼的一组）
    const triLine = 1;
    for (let i = 0; i < 7; i++) {
      const s = -0.62 + i * 0.20;
      const p = staffPoint(triLine, s);
      const { tangent, up } = staffBasis(s);
      stampMark(p, tangent, up, 'triangle', 0.40, mixc(C.white, C.ice, 0.15));
    }
    // 圆圈：下面那条线
    for (let i = 0; i < 6; i++) {
      const s = -0.70 + i * 0.27;
      const p = staffPoint(-1, s);
      const { tangent, up } = staffBasis(s);
      stampMark(p, tangent, up, 'circle', 0.24, mixc(C.white, C.ice, 0.3));
    }
    // 菱形：最上面那条线
    for (let i = 0; i < 4; i++) {
      const s = -0.35 + i * 0.33;
      const p = staffPoint(2, s);
      const { tangent, up } = staffBasis(s);
      stampMark(p, tangent, up, 'diamond', 0.22, mixc(C.ice, C.white, 0.4));
    }
    // 方块：谱线之外的一圈
    for (let i = 0; i < 3; i++) {
      const s = -0.05 + i * 0.36;
      const p = staffPoint(-2, s);
      const { tangent, up } = staffBasis(s);
      stampMark(p, tangent, up, 'square', 0.20, mixc(C.ice, C.white, 0.3));
    }
  })();

  /* ================= 缠在小提琴上的虚线弧，每道串一种标记 ================= */
  (function arcs() {
    const CENTER = [0, 0.6, BODY_CZ];
    const specs = [
      { R: 3.3, tilt: 0.55, yaw: 0.2, roll: 0.0, mark: 'circle', dots: 220 },
      { R: 4.1, tilt: -0.35, yaw: 1.1, roll: 0.4, mark: 'square', dots: 240 },
      { R: 4.8, tilt: 0.15, yaw: 2.3, roll: -0.3, mark: 'triangle', dots: 260 },
      { R: 2.9, tilt: -0.75, yaw: 0.7, roll: 0.2, mark: 'diamond', dots: 200 },
    ];
    for (const sp of specs) {
      const ct = Math.cos(sp.tilt), st = Math.sin(sp.tilt);
      const cy = Math.cos(sp.yaw), sy = Math.sin(sp.yaw);
      const cr = Math.cos(sp.roll), sr = Math.sin(sp.roll);
      const rot = (v) => {
        // 先绕 X 倾，再绕 Y 偏，最后绕 Z 滚
        let [x, y, z] = v;
        let y1 = y * ct - z * st, z1 = y * st + z * ct;
        let x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
        let x3 = x2 * cr - y1 * sr, y3 = x2 * sr + y1 * cr;
        return [x3, y3, z2];
      };
      const e1 = rot([1, 0, 0]);
      const e2 = rot([0, 1, 0]);
      const at = (a) => [
        CENTER[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * sp.R,
        CENTER[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * sp.R,
        CENTER[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * sp.R,
      ];
      // 虚线：每段只画一部分
      for (let i = 0; i < sp.dots; i++) {
        const a = (i / sp.dots) * TAU;
        if ((i % 10) > 6) continue;                 // 断线，形成虚线
        const p = at(a);
        pt(BATCH.ribbon, p[0], p[1], p[2], mixc(C.white, C.ice, 0.2 + rnd() * 0.3), 0.036 + rnd() * 0.014);
      }
      // 标记点
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + 0.2;
        const p = at(a);
        const p2 = at(a + 0.02);
        let tx = p2[0] - p[0], ty = p2[1] - p[1], tz = p2[2] - p[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const inward = [-p[0] / sp.R, -p[1] / sp.R, -p[2] / sp.R];
        stampMark(p, [tx, ty, tz], [inward[0], inward[1], inward[2]], sp.mark, 0.26, mixc(C.white, C.ice, 0.2));
      }
    }
  })();

  /* ================= 音符 / 谱号：字体采样成粒子 ================= */
  function glyphPoints(ch, sizePx, threshold) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = sizePx;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fff';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.font = '600 ' + Math.round(sizePx * 0.82) + 'px "Segoe UI Symbol", "Apple Symbols", serif';
    cx.fillText(ch, sizePx / 2, sizePx / 2);
    const data = cx.getImageData(0, 0, sizePx, sizePx).data;
    const pts = [];
    for (let y = 0; y < sizePx; y++) {
      for (let x = 0; x < sizePx; x++) {
        if (data[(y * sizePx + x) * 4 + 3] > threshold) pts.push([(x - sizePx / 2) / sizePx, -(y - sizePx / 2) / sizePx]);
      }
    }
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]);
    const bw = Math.max(...xs) - Math.min(...xs);
    return bw > 0.75 ? null : pts;                  // 豆腐块方框丢掉
  }

  const NOTES = ['♪', '♫', '♩'].map((ch) => glyphPoints(ch, 72, 150)).filter(Boolean);

  function placeGlyph(pts, cx, cy, cz, scale, right, up, col, dotSize) {
    for (let i = 0; i < pts.length; i++) {
      const g = pts[i];
      const lx = (g[0] + gauss() * 0.006) * scale;
      const ly = (g[1] + gauss() * 0.006) * scale;
      pt(BATCH.mark,
        cx + right[0] * lx + up[0] * ly,
        cy + right[1] * lx + up[1] * ly,
        cz + right[2] * lx + up[2] * ly,
        col, dotSize + rnd() * 0.008);
    }
  }

  // 手搓一个高音谱号：大螺旋 + 竖杆 + 底部小钩
  const CLEF = (() => {
    const pts = [];
    for (let i = 0; i < 120; i++) {
      const t = i / 119;
      const a = t * TAU * 1.15 - 0.6;
      const r = 0.34 - 0.16 * t;
      pts.push([Math.sin(a) * r * 0.95 + 0.02, Math.cos(a) * r * 1.25 - 0.05]);
    }
    for (let i = 0; i < 40; i++) {                 // 竖杆
      const t = i / 39;
      pts.push([0.03, 0.55 - t * 1.15]);
    }
    for (let i = 0; i < 34; i++) {                 // 底部小钩
      const t = i / 33;
      const a = t * Math.PI * 1.4 + Math.PI * 0.5;
      pts.push([0.03 + Math.sin(a) * 0.16, -0.60 + (1 - Math.cos(a)) * 0.16]);
    }
    for (let i = 0; i < 10; i++) {                 // 顶部小圆点
      const a = (i / 10) * TAU;
      pts.push([0.03 + Math.cos(a) * 0.05, 0.60 + Math.sin(a) * 0.05]);
    }
    return pts;
  })();

  (function music() {
    // 谱号：放在谱线的左端
    const s0 = -0.72;
    const base = staffPoint(0, s0);
    const { tangent, up } = staffBasis(s0);
    placeGlyph(CLEF, base[0], base[1], base[2], 2.3, tangent, up, mixc(C.white, C.ice, 0.25), 0.022);

    // 音符：几颗散落在谱线上
    const spots = [
      [-0.52, 1.6, 0], [-0.28, 0.9, 1], [-0.06, 2.1, 2], [0.16, -0.6, 0],
      [0.34, 1.2, 1], [0.52, 2.4, 2], [0.66, 0.2, 0], [-0.4, -1.1, 1],
    ];
    for (const [s, line, gi] of spots) {
      const p = staffPoint(line, s);
      const { tangent, up } = staffBasis(s);
      const g = NOTES[gi % NOTES.length];
      placeGlyph(g, p[0], p[1] + 0.4, p[2], 1.35, tangent, up, mixc(C.white, C.ice, 0.25), 0.026);
    }
  })();

  /* ================= 星点（极少量，别抢主体） ================= */
  (function stars() {
    for (let i = 0; i < 1600; i++) {
      const r = rr(18, 70);
      const a = rnd() * TAU, b = Math.acos(rr(-1, 1));
      pt(BATCH.rest,
        Math.sin(b) * Math.cos(a) * r,
        Math.cos(b) * r * 0.7,
        Math.sin(b) * Math.sin(a) * r,
        mixc(C.ice, C.white, rnd()), 0.03 + Math.pow(rnd(), 3) * 0.10);
    }
  })();

  /* ================= WebGL ================= */
  const vsPoints = `#version 300 es
  precision highp float;
  in vec3 aPos; in vec3 aCol; in float aSize; in float aPhase;
  uniform mat4 uVP; uniform vec3 uCam;
  uniform float uTime, uSpin, uTwist, uPx, uAlpha, uScale;
  out vec3 vCol; out float vA;
  void main() {
    // 绕 Z 轴自转 + 随 z 缓慢扭转（谱线像被"编织"一样慢慢卷起来）
    float ang = uSpin + uTwist * aPos.z;
    float c = cos(ang), s = sin(ang);
    vec3 p = vec3(aPos.x * c - aPos.y * s, aPos.x * s + aPos.y * c, aPos.z);
    gl_Position = uVP * vec4(p, 1.0);
    float dist = max(length(p - uCam), 0.001);
    float tw = 0.80 + 0.20 * sin(uTime * 2.3 + aPhase * 6.2832);
    gl_PointSize = clamp(aSize * uScale / dist * tw, 1.0, 120.0) * uPx;
    vA = smoothstep(0.0, 3.0, dist) * (1.0 - smoothstep(60.0, 150.0, dist)) * uAlpha;
    vCol = aCol;
  }`;
  const fsPoints = `#version 300 es
  precision highp float;
  in vec3 vCol; in float vA;
  out vec4 o;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(q, q);
    if (d2 > 1.0) discard;
    float a = (exp(-d2 * 7.0) + exp(-d2 * 2.0) * 0.12) * vA;
    o = vec4(vCol * a, a);
  }`;
  const vsQuad = `#version 300 es
  in vec2 aPos; out vec2 vUv;
  void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const fsThreshold = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 o;
  uniform sampler2D uTex;
  void main() {
    vec3 c = texture(uTex, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    o = vec4(c * smoothstep(0.42, 0.90, l), 1.0);
  }`;
  const fsBlur = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 o;
  uniform sampler2D uTex; uniform vec2 uDir;
  void main() {
    vec3 s = texture(uTex, vUv).rgb * 0.227;
    s += (texture(uTex, vUv + uDir * 1.385).rgb + texture(uTex, vUv - uDir * 1.385).rgb) * 0.316;
    s += (texture(uTex, vUv + uDir * 3.231).rgb + texture(uTex, vUv - uDir * 3.231).rgb) * 0.070;
    o = vec4(s, 1.0);
  }`;
  const fsComposite = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 o;
  uniform sampler2D uScene, uBloom;
  uniform float uAspect, uTime, uFade;
  void main() {
    vec3 s = texture(uScene, vUv).rgb;
    vec3 b = texture(uBloom, vUv).rgb;
    vec3 c = s + b * 0.42;
    c = vec3(1.0) - exp(-c * 1.15);
    vec2 q = vUv - 0.5; q.x *= uAspect;
    c *= 0.66 + 0.34 * smoothstep(1.05, 0.15, length(q));
    float g = fract(sin(dot(vUv * vec2(1234.5, 8765.4) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
    c += (g - 0.5) * 0.012;
    o = vec4(max(c, 0.0) * uFade, 1.0);
  }`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + src);
    return sh;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  const progPoints = program(vsPoints, fsPoints);
  const progThreshold = program(vsQuad, fsThreshold);
  const progBlur = program(vsQuad, fsBlur);
  const progComposite = program(vsQuad, fsComposite);

  /* ---------------- 打包 ---------------- */
  function packPoints(batches) {
    let total = 0;
    for (const b of batches) total += b.s.length;
    const data = new Float32Array(total * 8);
    const ranges = [];
    let o = 0;
    for (const b of batches) {
      const n = b.s.length;
      for (let i = 0; i < n; i++) {
        data[(o + i) * 8 + 0] = b.p[i * 3];
        data[(o + i) * 8 + 1] = b.p[i * 3 + 1];
        data[(o + i) * 8 + 2] = b.p[i * 3 + 2];
        data[(o + i) * 8 + 3] = b.c[i * 3];
        data[(o + i) * 8 + 4] = b.c[i * 3 + 1];
        data[(o + i) * 8 + 5] = b.c[i * 3 + 2];
        data[(o + i) * 8 + 6] = b.s[i];
        data[(o + i) * 8 + 7] = b.ph[i];
      }
      ranges.push({ first: o, count: n });
      o += n;
    }
    return { data, ranges, total };
  }

  const packed = packPoints([BATCH.violin, BATCH.ribbon, BATCH.mark, BATCH.rest]);
  const pointCount = packed.total;

  const vaoPoints = gl.createVertexArray();
  gl.bindVertexArray(vaoPoints);
  const vboPoints = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vboPoints);
  gl.bufferData(gl.ARRAY_BUFFER, packed.data, gl.STATIC_DRAW);
  const STRIDE = 8 * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 28);
  gl.bindVertexArray(null);

  const vaoQuad = gl.createVertexArray();
  gl.bindVertexArray(vaoQuad);
  const vboQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  /* ---------------- 帧缓冲 ---------------- */
  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }
  let sceneT = null, bloomA = null, bloomB = null;
  let W = 1, H = 1, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    W = Math.max(2, Math.round(cssW * DPR));
    H = Math.max(2, Math.round(cssH * DPR));
    canvas.width = W; canvas.height = H;
    if (sceneT) { gl.deleteTexture(sceneT.tex); gl.deleteFramebuffer(sceneT.fb); }
    if (bloomA) { gl.deleteTexture(bloomA.tex); gl.deleteFramebuffer(bloomA.fb); }
    if (bloomB) { gl.deleteTexture(bloomB.tex); gl.deleteFramebuffer(bloomB.fb); }
    sceneT = makeTarget(W, H);
    bloomA = makeTarget(Math.max(2, W >> 2), Math.max(2, H >> 2));
    bloomB = makeTarget(Math.max(2, W >> 2), Math.max(2, H >> 2));
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---------------- 矩阵 ---------------- */
  function perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near / (near - far); out[15] = 0;
    return out;
  }
  function lookAt(out, eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1; zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1; xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  }
  function multiply(out, a, b) {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  const proj = new Float32Array(16), view = new Float32Array(16), vp = new Float32Array(16);
  const FOV = 52 * Math.PI / 180;
  const LOOP = 26;
  const cam = { x: 0, y: 0, z: 0 };
  const TARGET = [0, 1.0, BODY_CZ];

  function fovY() {
    const aspect = W / H;
    if (aspect >= 1) return FOV;
    return Math.min(78 * Math.PI / 180, 2 * Math.atan(Math.tan(FOV / 2) / aspect));
  }

  // 慢速环绕：近距离掠过琴身，再退到全景（参考里也是围着琴转 + 推拉）
  function camera(t, dragX, dragY, zoom) {
    if (FRONT) {
      const d = 16 * zoom;
      if (FRONT === 'face') {                       // 正上方俯视，检查琴的轮廓
        cam.x = TARGET[0]; cam.y = TARGET[1] + d * 1.6; cam.z = TARGET[2] + 0.001;
        lookAt(view, [cam.x, cam.y, cam.z], TARGET, [0, 0, 1]);
      } else {
        cam.x = 0; cam.y = TARGET[1] + 0.6 * d; cam.z = TARGET[2] + d;
        lookAt(view, [cam.x, cam.y, cam.z], TARGET, [0, 1, 0]);
      }
      perspective(proj, fovY(), W / H, 0.05, 320);
      multiply(vp, proj, view);
      return;
    }
    const az = (t / LOOP) * TAU + dragX;
    const r = 7.8 - 2.6 * Math.cos(az) + 0.8 * Math.sin(az * 2);    // 4.4 .. 11.2
    cam.x = r * Math.sin(az) * zoom;
    cam.z = TARGET[2] - r * Math.cos(az) * zoom;
    cam.y = TARGET[1] + 1.55 * r + 1.0 + dragY * 12;                 // 约 55° 俯视，琴的面板才立得住
    const roll = 0.20 * Math.sin(az * 1.5 + 0.4);
    lookAt(view, [cam.x, cam.y, cam.z], TARGET, [Math.sin(roll), Math.cos(roll), 0]);
    perspective(proj, fovY(), W / H, 0.05, 320);
    multiply(vp, proj, view);
  }

  /* ---------------- 交互 ---------------- */
  const drag = { x: 0, y: 0 }, want = { x: 0, y: 0 };
  let zoom = 1, zoomWant = 1;
  let dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    want.x += (e.clientX - lastX) * 0.005;
    want.y = clamp(want.y - (e.clientY - lastY) * 0.004, -0.5, 0.9);
    lastX = e.clientX; lastY = e.clientY;
  });
  const stopDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomWant = clamp(zoomWant * (1 + e.deltaY * 0.0009), 0.5, 1.6);
  }, { passive: false });

  /* ---------------- 渲染 ---------------- */
  const params = new URLSearchParams(location.search);
  const freeze = params.has('t') ? parseFloat(params.get('t')) : null;
  const FRONT = params.get('view');
  const t0 = performance.now();

  function render(now) {
    const t = freeze !== null ? freeze : (now - t0) / 1000;

    drag.x += (want.x - drag.x) * 0.06;
    drag.y += (want.y - drag.y) * 0.06;
    zoom += (zoomWant - zoom) * 0.06;
    camera(t, drag.x, drag.y, zoom);

    const pxScale = (H * 0.5) / Math.tan(fovY() / 2);

    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fb);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.040, 0.043, 0.050, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(progPoints.p);
    gl.uniformMatrix4fv(progPoints.u.uVP, false, vp);
    gl.uniform3f(progPoints.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform1f(progPoints.u.uTime, t);
    gl.uniform1f(progPoints.u.uPx, 1.0);
    gl.uniform1f(progPoints.u.uScale, pxScale);
    gl.bindVertexArray(vaoPoints);

    // 小提琴：极慢自转；谱线与标记：随 z 扭转，像被一点点编织起来
    const batches = [
      { spin: t * 0.10, twist: 0, alpha: 1.25 },
      { spin: 0, twist: 0.055 * Math.sin(t * 0.22), alpha: 0.95 },
      { spin: 0, twist: 0.055 * Math.sin(t * 0.22), alpha: 1.0 },
      { spin: 0, twist: 0, alpha: 0.7 },
    ];
    for (let b = 0; b < 4; b++) {
      gl.uniform1f(progPoints.u.uSpin, batches[b].spin);
      gl.uniform1f(progPoints.u.uTwist, batches[b].twist);
      gl.uniform1f(progPoints.u.uAlpha, batches[b].alpha);
      gl.drawArrays(gl.POINTS, packed.ranges[b].first, packed.ranges[b].count);
    }

    gl.bindVertexArray(vaoQuad);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
    gl.viewport(0, 0, bloomA.w, bloomA.h);
    gl.useProgram(progThreshold.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(progThreshold.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.useProgram(progBlur.p);
    gl.uniform1i(progBlur.u.uTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fb);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform2f(progBlur.u.uDir, 1.3 / bloomA.w, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
    gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
    gl.uniform2f(progBlur.u.uDir, 0, 1.3 / bloomA.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progComposite.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(progComposite.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform1i(progComposite.u.uBloom, 1);
    gl.uniform1f(progComposite.u.uAspect, W / H);
    gl.uniform1f(progComposite.u.uTime, t);
    gl.uniform1f(progComposite.u.uFade, smoothstep(0, 1.4, t));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
  setTimeout(() => {
    document.getElementById('hud').classList.add('on');
    document.getElementById('tag').classList.add('on');
  }, 60);

  document.getElementById('tag').textContent =
    'WEBGL2 · ' + Math.round(pointCount / 1000) + 'K PARTICLES · 拖拽可转视角';
  window.__scene = { points: pointCount, batches: packed.ranges.map((r) => r.count) };
})();
