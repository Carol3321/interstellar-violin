/*
 * 星际轨道 · 粒子小提琴
 * 纯 WebGL2 粒子场景：小提琴 / 星河 / 星际隧道 / 音符 / 轨迹线，全部由代码生成，无贴图、无依赖。
 * 视觉参考抖音 @可乐鸡翅^O^ 的 Python(NumPy 手写透视投影 + 粒子) 作品，在浏览器里复刻其构图与运镜。
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
  // 参考视频里那种"冰晶 / 大理石"斑驳质感
  const fbm = (x, y, z) =>
    vnoise(x, y, z) * 0.60 + vnoise(x * 2.13, y * 2.13, z * 2.13) * 0.27 + vnoise(x * 4.37, y * 4.37, z * 4.37) * 0.13;

  /* ---------------- 调色板（取自参考视频的青蓝-紫） ---------------- */
  const C = {
    white: [0.97, 0.98, 1.00],
    ice: [0.62, 0.80, 1.00],
    blue: [0.26, 0.42, 1.00],
    violet: [0.55, 0.36, 1.00],
    deep: [0.09, 0.13, 0.50],
  };
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  /* ---------------- 几何收集器：四批，各自不同自转轴与速度 ---------------- */
  const mk = () => ({ p: [], c: [], s: [], ph: [] });
  const BATCH = { violin: mk(), galaxy: mk(), tunnel: mk(), rest: mk() };
  function pt(e, x, y, z, col, size) {
    e.p.push(x, y, z); e.c.push(col[0], col[1], col[2]); e.s.push(size); e.ph.push(rnd());
  }
  const L = { p: [], c: [], a: [] };
  function seg(a, b, ca, cb, aa, ab) {
    L.p.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    L.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]);
    L.a.push(aa, ab);
  }
  function polyline(points, colA, colB, alpha) {
    for (let i = 0; i < points.length - 1; i++) {
      const t0 = i / (points.length - 1), t1 = (i + 1) / (points.length - 1);
      seg(points[i], points[i + 1], mixc(colA, colB, t0), mixc(colA, colB, t1),
        alpha * (1 - t0 * 0.8), alpha * (1 - t1 * 0.8));
    }
  }

  /* ================= 小提琴 =================
     轴线沿 +Z：琴尾 z=-0.62 → 琴头 z≈1.1；面板法线 +Y。
     生成后统一放大 VS 倍并绕 Z 倾斜 TILT，让镜头以 3/4 视角看到面板。 */
  const V = { z0: -0.62, len: 1.18, thick: 0.058 };
  const VS = 7.0, TILT = -0.42;

  (function violin() {
    const e = BATCH.violin;

    // 半宽控制点：明显的上下琴箱 + 腰部凹进
    const WP = [0.148, 0.238, 0.300, 0.324, 0.288, 0.226, 0.212, 0.232, 0.276, 0.300, 0.284, 0.228, 0.172];
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

    // 面板 + 背板（透镜壳体），fbm 冰晶质感，边缘提亮
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
      let col = mixc(C.deep, C.ice, clamp(0.20 + f1 * 1.05, 0, 1));
      col = mixc(col, C.white, Math.pow(clamp(f2, 0, 1), 2.2) * 1.1 * surface);
      col = mixc(col, C.white, Math.pow(q, 7) * 0.95);            // 亮边
      if (rnd() < 0.03) col = C.white;
      if (hole) {
        col = mixc(C.deep, [0.05, 0.05, 0.22], rnd());             // 孔内压暗
      } else {
        // 极简方向光：沿 v 方向压暗 / 提亮，让平板面板有体积感
        const lit = 0.58 + 0.55 * (v / w + 0.35) * 0.6;
        col = [col[0] * lit, col[1] * lit, col[2] * lit];
      }
      pt(e, v, y, z, col, (0.005 + Math.pow(rnd(), 2) * 0.020) * (hole ? 0.6 : 1));
    }

    // 面板上的高光条：几道沿琴身走向的亮线，制造金属 / 冰面反射感
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

    // 琴身周围的大颗粒柔光，喂给泛光，让主体自带光晕
    for (let i = 0; i < 900; i++) {
      const u = rr(0.05, 0.95);
      const w = halfW(u) * 1.05;
      pt(e, (rnd() * 2 - 1) * w, gauss() * 0.10, zAt(u), mixc(C.blue, C.ice, rnd() * 0.5), 0.10 + rnd() * 0.18);
    }

    // 轮廓线（更硬的高光边）
    for (let i = 0; i < 9000; i++) {
      const u = rnd(), w = halfW(u), s = rnd() < 0.5 ? 1 : -1;
      const v = s * w * (0.995 + rnd() * 0.008);
      pt(e, v, (rnd() * 2 - 1) * 0.026, zAt(u), mixc(C.white, C.ice, rnd() * 0.5), 0.008 + rnd() * 0.008);
    }

    // f 孔亮边 + 孔内暗部
    for (let i = 0; i < 4200; i++) {
      const u = rr(0.345, 0.60);
      const s = rnd() < 0.5 ? 1 : -1;
      const center = 0.086 + (u - 0.47) * 0.20;
      const edge = s * (center + (rnd() < 0.5 ? 1 : -1) * 0.018);
      pt(e, edge, 0.086 + gauss() * 0.002, zAt(u), mixc(C.white, C.ice, rnd() * 0.4), 0.010 + rnd() * 0.008);
    }
    for (let i = 0; i < 2200; i++) {
      const u = rr(0.345, 0.60);
      const s = rnd() < 0.5 ? 1 : -1;
      const center = 0.086 + (u - 0.47) * 0.20;
      pt(e, s * (center + gauss() * 0.006), gauss() * 0.01, zAt(u), C.violet, 0.02);
    }

    // 琴桥
    for (let i = 0; i < 2600; i++) {
      const u = 0.402 + gauss() * 0.005;
      const v = gauss() * 0.070;
      pt(e, v, 0.130 + gauss() * 0.010, zAt(u), mixc(C.white, C.ice, rnd() * 0.5), 0.008 + rnd() * 0.007);
    }

    // 系弦板
    for (let i = 0; i < 2600; i++) {
      const u = rr(0.03, 0.25);
      const w = 0.044 * (1 - (u - 0.03) * 1.6);
      pt(e, (rnd() * 2 - 1) * w, 0.070 + gauss() * 0.008, zAt(u), mixc(C.blue, C.violet, rnd()), 0.009 + rnd() * 0.007);
    }

    // 指板：明显更宽的暗面，两侧带亮边
    for (let i = 0; i < 9000; i++) {
      const u = rr(0.58, 1.02);
      const w = 0.062 - 0.014 * (u - 0.58);
      const edge = Math.abs(rnd() * 2 - 1) > 0.93;
      pt(e, (rnd() * 2 - 1) * w, 0.058 + gauss() * 0.005, zAt(u),
        edge ? mixc(C.ice, C.white, rnd()) : mixc(C.deep, C.blue, 0.25 + rnd() * 0.35), 0.006 + rnd() * 0.006);
    }

    // 琴颈
    for (let i = 0; i < 7000; i++) {
      const z = rr(0.54, 1.00);
      const w = 0.042 - 0.010 * (z - 0.54);
      pt(e, (rnd() * 2 - 1) * w, -0.03 + (rnd() * 2 - 1) * 0.020, z,
        mixc(C.deep, C.ice, 0.35 + rnd() * 0.55), 0.006 + rnd() * 0.006);
    }

    // 琴头涡卷（YZ 平面内卷曲）
    for (let i = 0; i < 4200; i++) {
      const s = rnd();
      const ang = s * 8.4 - 1.1;
      const rad = 0.062 * (1 - 0.55 * s);
      pt(e, gauss() * 0.024, 0.010 + rad * Math.cos(ang), 1.01 + 0.075 * s + rad * Math.sin(ang),
        mixc(C.ice, C.white, rnd() * 0.7), 0.007 + rnd() * 0.006);
    }

    // 四根琴弦（最亮的部分，视觉命脉）
    const strX = [-0.025, -0.0085, 0.0085, 0.025];
    for (const sx of strX) {
      for (let i = 0; i < 1100; i++) {
        const z = lerp(-0.44, 1.00, i / 1099);
        const y = 0.135 + 0.012 * Math.sin((z + 0.44) / 1.44 * Math.PI) + (z < 0.40 ? (0.40 - z) * 0.06 : 0);
        pt(e, sx + gauss() * 0.0018, y, z, C.white, 0.0055 + rnd() * 0.004);
      }
      for (let i = 0; i < 90; i++) {   // 弦的柔光
        const z = rr(-0.44, 1.00);
        pt(e, sx + gauss() * 0.004, 0.135 + gauss() * 0.006, z, mixc(C.ice, C.white, 0.7), 0.045);
      }
    }

    // 琴弓：横跨琴弦的细长弓杆 + 弓毛
    const A = [-0.78, 0.155, 0.44], B = [0.74, 0.135, -0.30], K = [0.0, 0.215, 0.06];
    const bez = (s) => {
      const m = 1 - s;
      return [
        m * m * A[0] + 2 * m * s * K[0] + s * s * B[0],
        m * m * A[1] + 2 * m * s * K[1] + s * s * B[1],
        m * m * A[2] + 2 * m * s * K[2] + s * s * B[2],
      ];
    };
    for (let i = 0; i < 3600; i++) {
      const p = bez(rnd());
      pt(e, p[0] + gauss() * 0.007, p[1] + gauss() * 0.007, p[2] + gauss() * 0.007,
        mixc(C.ice, C.white, rnd() * 0.85), 0.007 + rnd() * 0.006);
    }
    for (let i = 0; i < 1400; i++) {          // 弓毛：弓杆下方一条直线
      const s = rnd();
      const p = bez(s);
      pt(e, p[0] * 0.99 + gauss() * 0.002, p[1] - 0.030 + gauss() * 0.002, p[2] * 0.99 + gauss() * 0.002,
        mixc(C.blue, C.ice, rnd()), 0.0045);
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

  /* ================= 星河（XZ 平面旋涡盘，绕 Y 自转） ================= */
  (function galaxy() {
    const e = BATCH.galaxy;
    const ARMS = 3;

    // 内圈星尘
    for (let i = 0; i < 9000; i++) {
      const r = 9 + Math.pow(rnd(), 1.7) * 15;
      const a = rnd() * TAU;
      pt(e, Math.cos(a) * r, gauss() * 0.7, Math.sin(a) * r, mixc(C.ice, C.white, rnd() * 0.7), 0.02 + rnd() * 0.05);
    }

    // 旋臂
    for (let i = 0; i < 46000; i++) {
      const t = Math.pow(rnd(), 0.55);
      const r = 12 + t * 56;
      const arm = i % ARMS;
      const ang = (r / 68) * 4.9 + arm * (TAU / ARMS) + gauss() * 0.12 * (1.25 - 0.7 * t);
      const spread = (1 - t) * 0.8 + 0.22;
      const x = Math.cos(ang) * r + gauss() * spread;
      const z = Math.sin(ang) * r + gauss() * spread;
      const y = gauss() * (0.4 + r * 0.02);
      const near = clamp(1 - t * 0.5, 0, 1);
      let col = mixc(C.blue, C.ice, near * (0.5 + 0.5 * rnd()));
      if (rnd() < 0.07) col = mixc(col, C.white, 0.85);
      if (rnd() < 0.02) col = C.violet;
      pt(e, x, y, z, col, 0.015 + Math.pow(rnd(), 2) * 0.09);
    }

    // 极淡星云，补旋臂之间的层次
    for (let i = 0; i < 5000; i++) {
      const r = 14 + Math.pow(rnd(), 0.5) * 54;
      const a = rnd() * TAU;
      pt(e, Math.cos(a) * r, gauss() * 1.4, Math.sin(a) * r, mixc(C.deep, C.violet, rnd() * 0.4), 0.07 + rnd() * 0.12);
    }
  })();

  /* ================= 星际隧道：沿 Z 轴的一串粒子环（三层同心的发光线圈） ================= */
  (function tunnel() {
    const e = BATCH.tunnel;
    const RINGS = 34;
    for (let i = 0; i < RINGS; i++) {
      const z = -58 + i * 3.4;
      const R = 11.5 + 8.5 * Math.pow(0.5 + 0.5 * Math.sin(i * 0.62 + 1.1), 1.5);
      const bright = 0.65 + 0.35 * Math.sin(i * 1.3);
      for (let k = 0; k < 1000; k++) {
        const a = (k / 1000) * TAU * 3 + rr(-0.01, 0.01);
        const strand = k % 3;
        const rad = R * (1 + strand * 0.012) * (1 + gauss() * 0.006);
        const x = Math.cos(a) * rad + gauss() * 0.10;
        const y = Math.sin(a) * rad + gauss() * 0.10;
        const zz = z + 0.35 * Math.sin(a * 5 + i * 0.5) + gauss() * 0.10;
        let col = mixc(C.ice, C.white, 0.25 + 0.45 * bright);
        if (rnd() < 0.05) col = C.violet;
        pt(e, x, y, zz, col, 0.10 + rnd() * 0.16);
      }
      // 环上更亮的节点
      for (let k = 0; k < 40; k++) {
        const a = rnd() * TAU;
        pt(e, Math.cos(a) * R, Math.sin(a) * R, z + gauss() * 0.15, C.white, 0.16 + rnd() * 0.18);
      }
    }

    // 隧道内的浮尘
    for (let i = 0; i < 10000; i++) {
      const z = rr(-62, 62);
      const a = rnd() * TAU;
      const r = 5 + Math.pow(rnd(), 0.7) * 22;
      pt(e, Math.cos(a) * r, Math.sin(a) * r, z, mixc(C.ice, C.blue, rnd() * 0.7), 0.02 + rnd() * 0.07);
    }

    // 远景星点
    for (let i = 0; i < 7000; i++) {
      const x = rr(-150, 150), y = rr(-150, 150), z = rr(-150, 150);
      if (Math.hypot(x, y, z) < 45) continue;
      pt(e, x, y, z, mixc(C.ice, C.white, rnd()), 0.06 + Math.pow(rnd(), 3) * 0.45);
    }
  })();

  /* ================= 音符：从字体取字形做粒子采样 ================= */
  (function notes() {
    const e = BATCH.rest;
    const glyphs = ['♪', '♫', '♩'];
    const samples = [];
    for (const ch of glyphs) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 72;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = '#fff';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.font = '600 58px "Segoe UI Symbol", "Apple Symbols", serif';
      cx.fillText(ch, 36, 36);
      const data = cx.getImageData(0, 0, 72, 72).data;
      const pts = [];
      for (let y = 0; y < 72; y++) {
        for (let x = 0; x < 72; x++) {
          if (data[(y * 72 + x) * 4 + 3] > 150) {
            pts.push([(x - 36) / 36, -(y - 36) / 36]);
            pts.push([(x - 35.5) / 36, -(y - 35.5) / 36]);
          }
        }
      }
      // 字形缺失时浏览器会画"豆腐块"方框：太方正的就丢掉
      const xs = pts.map((p) => p[0]);
      const bw = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
      samples.push(pts.length > 60 && bw < 1.5 ? pts : null);
    }
    const valid = samples.filter(Boolean);
    if (!valid.length) return;

    // 音符散布在小提琴周围，略偏向面板一侧
    for (let n = 0; n < 10; n++) {
      const glyph = valid[n % valid.length];
      const ang = rnd() * TAU;
      const rad = rr(6.5, 11.5);
      const cx = Math.cos(ang) * rad;
      const cz = Math.sin(ang) * rad * 1.3;
      const cy = rr(-4, 7);
      const scale = rr(1.2, 2.4);
      const spin = rnd() * TAU, tilt = rr(-0.5, 0.5);
      const cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
      const col = mixc(mixc(C.ice, C.white, 0.55), C.violet, rnd() * 0.3);
      for (let i = 0; i < glyph.length; i += 1) {
        const g = glyph[i];
        const lx = (g[0] + gauss() * 0.010) * scale;
        const ly = (g[1] + gauss() * 0.010) * scale;
        const lz = gauss() * 0.03;
        const ry = ly * ct - lz * st;
        const rz = ly * st + lz * ct;
        pt(e, cx + lx * cs - ry * sn, cy + ry, cz + lx * sn + ry * cs + rz, col, 0.05 + rnd() * 0.03);
      }
    }
  })();

  /* ================= 轨迹线：从琴身甩出的细长曲线 + 轨道弧 + 星芒 ================= */
  (function lines() {
    // 甩出的轨迹（少而细，参考里它们是点缀不是主角）
    for (let c = 0; c < 8; c++) {
      const ang = rnd() * TAU;
      const start = [Math.cos(ang) * 8.5, rr(-3, 3), Math.sin(ang) * 8.5];
      const dir = [Math.cos(ang), gauss() * 0.25, Math.sin(ang)];
      const len = rr(8, 22);
      const curl = rr(-9, 9);
      const pts = [];
      const N = 120;
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1);
        const b = s * s * len * 0.55 + s * len * 0.45;
        const bend = Math.sin(s * Math.PI * 1.3) * curl;
        pts.push([
          start[0] + dir[0] * b - bend * dir[2],
          start[1] + dir[1] * b + Math.sin(s * 6 + c) * 1.2,
          start[2] + dir[2] * b + bend * dir[0],
        ]);
      }
      polyline(pts, mixc(C.ice, C.white, 0.5), C.blue, 0.20);
      for (let i = 5; i < N; i += 11) {
        const p = pts[i];
        for (let k = 0; k < 12; k++) {
          pt(BATCH.rest, p[0] + gauss() * 0.03, p[1] + gauss() * 0.03, p[2] + gauss() * 0.03,
            mixc(C.white, C.ice, rnd()), 0.05 + rnd() * 0.03);
        }
      }
    }

    // 环绕小提琴的轨道弧
    for (let r = 0; r < 3; r++) {
      const rad = rr(11, 17);
      const tilt = rr(-0.7, 0.7), yaw = rnd() * TAU;
      const pts = [];
      const N = 160;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad * 0.92, z = 0;
        const x1 = x * Math.cos(yaw) - z * Math.sin(yaw);
        const z1 = x * Math.sin(yaw) + z * Math.cos(yaw);
        const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
        pts.push([x1, y2, z2]);
      }
      polyline(pts, mixc(C.ice, C.white, 0.5), mixc(C.violet, C.ice, 0.5), 0.16);
    }

    // 星芒（四角星）
    for (let i = 0; i < 130; i++) {
      const r = rr(10, 44);
      const a = rnd() * TAU;
      const p = [Math.cos(a) * r, gauss() * 7, Math.sin(a) * r];
      const s = rr(0.4, 1.1);
      seg([p[0] - s, p[1], p[2]], [p[0] + s, p[1], p[2]], C.white, C.white, 0, 0.5);
      seg([p[0], p[1] - s, p[2]], [p[0], p[1] + s, p[2]], C.white, C.white, 0, 0.5);
      pt(BATCH.rest, p[0], p[1], p[2], C.white, 0.08 + s * 0.14);
    }
  })();

  /* ================= WebGL 资源 ================= */
  const vsPoints = `#version 300 es
  precision highp float;
  in vec3 aPos; in vec3 aCol; in float aSize; in float aPhase;
  uniform mat4 uVP; uniform vec3 uCam;
  uniform float uTime, uSpin, uAxisY, uPx, uAlpha, uScale;
  out vec3 vCol; out float vA;
  void main() {
    float c = cos(uSpin), s = sin(uSpin);
    vec3 pz = vec3(aPos.x * c - aPos.y * s, aPos.x * s + aPos.y * c, aPos.z);
    vec3 py = vec3(aPos.x * c + aPos.z * s, aPos.y, -aPos.x * s + aPos.z * c);
    vec3 p = mix(pz, py, uAxisY);
    gl_Position = uVP * vec4(p, 1.0);
    float dist = max(length(p - uCam), 0.001);
    float tw = 0.78 + 0.22 * sin(uTime * 1.9 + aPhase * 6.2832);
    gl_PointSize = clamp(aSize * uScale / dist * tw, 1.0, 140.0) * uPx;
    vA = smoothstep(0.0, 4.0, dist) * (1.0 - smoothstep(45.0, 150.0, dist)) * uAlpha;
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
    float a = (exp(-d2 * 8.0) + exp(-d2 * 2.2) * 0.14) * vA;
    o = vec4(vCol * a, a);
  }`;
  const vsLines = `#version 300 es
  precision highp float;
  in vec3 aPos; in vec3 aCol; in float aA;
  uniform mat4 uVP; uniform vec3 uCam;
  uniform float uSpin, uAlpha;
  out vec3 vCol; out float vA;
  void main() {
    float c = cos(uSpin), s = sin(uSpin);
    vec3 p = vec3(aPos.x * c - aPos.y * s, aPos.x * s + aPos.y * c, aPos.z);
    gl_Position = uVP * vec4(p, 1.0);
    float dist = max(length(p - uCam), 0.001);
    vA = aA * uAlpha * smoothstep(0.0, 4.0, dist) * (1.0 - smoothstep(90.0, 220.0, dist));
    vCol = aCol;
  }`;
  const fsLines = `#version 300 es
  precision highp float;
  in vec3 vCol; in float vA;
  out vec4 o;
  void main() { o = vec4(vCol * vA, vA); }`;
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
    o = vec4(c * smoothstep(0.22, 0.72, l), 1.0);
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
    vec3 c = s + b * 0.82;
    c = vec3(1.0) - exp(-c * 1.25);              // 柔和高光压缩
    c += b * 0.22 * vec3(0.5, 0.7, 1.0);         // 冷色泛光
    vec2 q = vUv - 0.5; q.x *= uAspect;
    c *= 0.60 + 0.40 * smoothstep(1.0, 0.20, length(q));
    float g = fract(sin(dot(vUv * vec2(1234.5, 8765.4) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
    c += (g - 0.5) * 0.014;
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
  const progLines = program(vsLines, fsLines);
  const progThreshold = program(vsQuad, fsThreshold);
  const progBlur = program(vsQuad, fsBlur);
  const progComposite = program(vsQuad, fsComposite);

  /* ---------------- 打包顶点 ---------------- */
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

  const packed = packPoints([BATCH.violin, BATCH.galaxy, BATCH.tunnel, BATCH.rest]);
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

  const lineVerts = L.a.length;
  const vaoLines = gl.createVertexArray();
  gl.bindVertexArray(vaoLines);
  const vboLines = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vboLines);
  const lineData = new Float32Array(lineVerts * 7);
  for (let i = 0; i < lineVerts; i++) {
    lineData[i * 7 + 0] = L.p[i * 3];
    lineData[i * 7 + 1] = L.p[i * 3 + 1];
    lineData[i * 7 + 2] = L.p[i * 3 + 2];
    lineData[i * 7 + 3] = L.c[i * 3];
    lineData[i * 7 + 4] = L.c[i * 3 + 1];
    lineData[i * 7 + 5] = L.c[i * 3 + 2];
    lineData[i * 7 + 6] = L.a[i];
  }
  gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  gl.bindVertexArray(null);

  const vaoQuad = gl.createVertexArray();
  gl.bindVertexArray(vaoQuad);
  const vboQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  /* ---------------- 帧缓冲：场景 + 1/4 分辨率泛光 ---------------- */
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

  /* ---------------- 相机矩阵 ---------------- */
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
  const FOV = 54 * Math.PI / 180;
  const LOOP = 24;                     // 一次完整运镜的秒数
  const cam = { x: 0, y: 0, z: 0 };

  // 竖屏时横向视野会变窄把琴裁掉，按宽高比放大纵向 FOV
  function fovY() {
    const aspect = W / H;
    if (aspect >= 1) return FOV;
    return Math.min(80 * Math.PI / 180, 2 * Math.atan(Math.tan(FOV / 2) / aspect));
  }

  // 椭圆轨道：侧面近距离（看面板）/ 轴线远距离（穿隧道）
  function camera(t, dragX, dragY, zoom) {
    if (FRONT) {                       // 调试 / 展示用：固定机位正视小提琴
      const n = FRONT === 'side' ? [0, 1, 0] : [0, 0.55, 1];
      const d = 15 * zoom;
      cam.x = n[0] * d; cam.y = 1.5 + n[1] * d; cam.z = n[2] * d;
      lookAt(view, [cam.x, cam.y, cam.z], [0, 0.5, 0.5], [0, 1, 0]);
      perspective(proj, fovY(), W / H, 0.05, 340);
      multiply(vp, proj, view);
      return;
    }
    const az = (t / LOOP) * TAU + dragX;
    const A = 12.5, B = 46;                                     // 侧向 / 轴向半径
    const r = 1 / Math.hypot(Math.sin(az) / A, Math.cos(az) / B);
    cam.x = r * Math.sin(az) * zoom;
    cam.z = -r * Math.cos(az) * zoom;
    cam.y = 15 * Math.sin(az) + 1.5 + dragY * 16;
    const roll = 0.5 * Math.sin(az * 2 + 0.6);
    const up = [Math.sin(roll), Math.cos(roll), 0];
    const target = [0, -1.5, 0.6 * Math.cos(az)];
    lookAt(view, [cam.x, cam.y, cam.z], target, up);
    perspective(proj, fovY(), W / H, 0.05, 340);
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
  const stop = () => { dragging = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomWant = clamp(zoomWant * (1 + e.deltaY * 0.0009), 0.55, 1.6);
  }, { passive: false });

  /* ---------------- 渲染循环 ---------------- */
  const params = new URLSearchParams(location.search);
  const freeze = params.has('t') ? parseFloat(params.get('t')) : null;
  const FRONT = params.get('view');        // 'top' | 'side'：固定机位看琴（调试 / 展示用）
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
    gl.clearColor(0.007, 0.010, 0.022, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(progLines.p);
    gl.uniformMatrix4fv(progLines.u.uVP, false, vp);
    gl.uniform3f(progLines.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform1f(progLines.u.uSpin, t * 0.03);
    gl.uniform1f(progLines.u.uAlpha, 1.0);
    gl.bindVertexArray(vaoLines);
    gl.drawArrays(gl.LINES, 0, lineVerts);

    // 四批粒子：小提琴（轻微摇摆）/ 星河（绕 Y 自转）/ 隧道环 / 其余（慢转）
    // 隧道环只在镜头贴近中轴（穿隧道）时全亮；侧看时压暗，避免变成一排竖帘
    const camR = Math.hypot(cam.x, cam.y);
    const ringDim = lerp(0.02, 1.0, smoothstep(24, 8, camR));
    const spins = [0.09 * Math.sin(t * 0.45), t * 0.28, t * 0.05, t * 0.03];
    const axes = [0, 1, 0, 0];
    const alphas = FRONT ? [0.55, 0.05, 0, 0.05] : [0.55, 0.58, 0.9 * ringDim, 0.8];
    gl.useProgram(progPoints.p);
    gl.uniformMatrix4fv(progPoints.u.uVP, false, vp);
    gl.uniform3f(progPoints.u.uCam, cam.x, cam.y, cam.z);
    gl.uniform1f(progPoints.u.uTime, t);
    gl.uniform1f(progPoints.u.uPx, 1.0);
    gl.uniform1f(progPoints.u.uScale, pxScale);
    gl.bindVertexArray(vaoPoints);
    for (let b = 0; b < 4; b++) {
      gl.uniform1f(progPoints.u.uSpin, spins[b]);
      gl.uniform1f(progPoints.u.uAxisY, axes[b]);
      gl.uniform1f(progPoints.u.uAlpha, alphas[b]);
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
    gl.uniform2f(progBlur.u.uDir, 1.4 / bloomA.w, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
    gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
    gl.uniform2f(progBlur.u.uDir, 0, 1.4 / bloomA.h);
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
    gl.uniform1f(progComposite.u.uFade, smoothstep(0, 1.6, t));
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
  window.__scene = { points: pointCount, lines: lineVerts, batches: packed.ranges.map((r) => r.count) };
})();
