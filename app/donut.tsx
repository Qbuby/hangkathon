"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type DonutSlice = { id: string; label: string; value: number; color: string };

type DonutProps = {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerValue: string;
  onActive?: (id: string | null) => void;
};

/** 阵营名去掉行政区后缀，便于在盘外紧凑标注（拱墅区 → 拱墅）。 */
const shortName = (label: string) => label.replace(/[区县市]$/, "");

type Particle = {
  faction: number; // 阵营下标
  theta: number; // 当前轨道角（盘面坐标系，12 点方向为 0，顺时针）
  radius: number; // 轨道半径（归一化到盘内缘–外缘）
  speed: number; // 角速度（rad/s，内圈更快）
  size: number; // 粒子基础尺寸
};

const TILT = 0.34; // 吸积盘 y 压缩：侧视倾角
const DISK_INNER = 0.52; // 盘内缘（相对半径）
const DISK_OUTER = 1.0; // 盘外缘

/**
 * 黑洞形态的阵营贡献图：
 * 中心事件视界 + 光子环，阵营粒子按贡献占比分配到倾斜吸积盘的扇区沿轨流动。
 * Canvas 2D + 预渲染光晕贴图 + 前后两层离屏拖尾（后半被核心遮挡），
 * 离屏/后台暂停，移动端限帧，prefers-reduced-motion 出静帧。
 */
export default function Donut({ slices, size = 320, centerLabel, centerValue, onActive }: DonutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const activeRef = useRef<string | null>(null);
  const activeIndexRef = useRef(-1);

  // 父组件每次渲染都会传入新的 slices 数组引用；按内容序列化做 key，
  // 让粒子系统只在数据真正变化时重建（悬停高亮不会重排粒子）。
  const visibleKey = slices.map((slice) => `${slice.id}:${slice.value}:${slice.color}`).join("|");
  const visible = useMemo(() => slices.filter((slice) => slice.value > 0), [visibleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => visible.reduce((sum, slice) => sum + slice.value, 0), [visible]);
  const activeIndex = visible.findIndex((slice) => slice.id === active);
  const activeSlice = activeIndex >= 0 ? visible[activeIndex] : null;

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const activate = (id: string | null) => {
    if (activeRef.current !== id) {
      activeRef.current = id;
      setActive(id);
      onActive?.(id);
    }
  };

  // 盘外标签：各扇区中点角度 → HTML 覆盖层坐标。
  const labelSpots = useMemo(() => {
    const cumulative = visible.reduce<number[]>((sums, slice, index) => [...sums, (sums[index - 1] ?? 0) + slice.value], []);
    return visible.map((slice, index) => {
      const mid = ((cumulative[index] - slice.value / 2) / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
      const r = size / 2 + 6;
      return {
        id: slice.id,
        color: slice.color,
        text: `${shortName(slice.label)} ${total > 0 ? Math.round((slice.value / total) * 100) : 0}%`,
        x: Math.cos(mid) * r,
        y: Math.sin(mid) * r * TILT,
        dim: active !== null && active !== slice.id,
      };
    });
  }, [visible, total, size, active]);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visible.length === 0 || total <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const cx = size / 2;
    const cy = size / 2;
    const diskRadius = size / 2 - 6;
    const coreRadius = diskRadius * DISK_INNER * 0.66;

    // 光晕贴图：每个阵营色一张，避免逐帧建渐变/阴影。
    const sprites = visible.map((slice) => {
      const sprite = document.createElement("canvas");
      const s = 32;
      sprite.width = s;
      sprite.height = s;
      const sctx = sprite.getContext("2d");
      if (sctx) {
        const grad = sctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.25, slice.color);
        grad.addColorStop(1, `${slice.color}00`);
        sctx.fillStyle = grad;
        sctx.fillRect(0, 0, s, s);
      }
      return sprite;
    });

    // 粒子：按占比分配到各阵营扇区，半径带抖动，内圈角速度更快（开普勒感）。
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const count = coarse ? 150 : 350;
    const particles: Particle[] = [];
    visible.forEach((slice, faction) => {
      const share = slice.value / total;
      const n = Math.max(2, Math.round(share * count));
      const startAngle = (visible.slice(0, faction).reduce((sum, item) => sum + item.value, 0) / total) * Math.PI * 2;
      const span = share * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const radius = DISK_INNER + Math.random() * (DISK_OUTER - DISK_INNER);
        particles.push({
          faction,
          theta: startAngle + Math.random() * span,
          radius,
          speed: (0.55 / Math.pow(radius, 1.5)) * (0.85 + Math.random() * 0.3),
          size: 1.6 + Math.random() * 2.6,
        });
      }
    });

    // 前后两层拖尾：后半粒子被黑洞核心遮挡，前半盖在核心之上。
    const backTrail = document.createElement("canvas");
    const frontTrail = document.createElement("canvas");
    for (const layer of [backTrail, frontTrail]) {
      layer.width = canvas.width;
      layer.height = canvas.height;
    }
    const backCtx = backTrail.getContext("2d");
    const frontCtx = frontTrail.getContext("2d");
    if (!backCtx || !frontCtx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let running = false;
    let last = performance.now();
    let frame = 0;

    const fade = (layer: CanvasRenderingContext2D) => {
      layer.globalCompositeOperation = "destination-out";
      layer.fillStyle = "rgba(0,0,0,0.25)";
      layer.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.globalCompositeOperation = "source-over";
    };

    const drawParticle = (layer: CanvasRenderingContext2D, p: Particle, dimOthers: boolean, t: number) => {
      const x = cx + Math.cos(p.theta) * p.radius * diskRadius;
      const y = cy + Math.sin(p.theta) * p.radius * diskRadius * TILT;
      const isActiveFaction = activeIndexRef.current === p.faction;
      const isDim = dimOthers && !isActiveFaction;
      const doppler = 0.45 + 0.55 * ((Math.sin(p.theta) + 1) / 2); // 朝向观察者一侧更亮
      const twinkle = 0.75 + 0.25 * Math.sin(t * 2 + p.radius * 9);
      const alpha = (isDim ? 0.14 : 1) * doppler * twinkle * 0.95;
      const s = p.size * (isActiveFaction ? 1.18 : 1) * dpr;
      const sprite = sprites[p.faction];
      if (!sprite) return;
      layer.globalAlpha = Math.max(alpha, 0.04);
      const w = s * 4.2;
      layer.drawImage(sprite, x * dpr - w / 2, y * dpr - w / 2, w, w);
    };

    const render = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = now / 1000;
      const dimOthers = activeIndexRef.current >= 0;
      const speedBoost = activeIndexRef.current >= 0 ? 1.6 : 1;

      fade(backCtx);
      fade(frontCtx);

      // 盘后半（sin<0）进 back 层，前半进 front 层
      for (const p of particles) {
        const front = Math.sin(p.theta) > 0;
        drawParticle(front ? frontCtx : backCtx, p, dimOthers, t);
      }

      // 主画布：底光 → 后半（被核心遮挡）→ 事件视界 → 前半 → 光子环
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const halo = ctx.createRadialGradient(cx * dpr, cy * dpr, coreRadius * 0.4 * dpr, cx * dpr, cy * dpr, diskRadius * dpr);
      halo.addColorStop(0, "#36d4f516");
      halo.addColorStop(1, "#36d4f500");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(backTrail, 0, 0);

      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(cx * dpr, cy * dpr, coreRadius * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "#02070d";
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(frontTrail, 0, 0);

      ctx.globalCompositeOperation = "source-over";
      const ringGrad = ctx.createLinearGradient(0, (cy - coreRadius) * dpr, 0, (cy + coreRadius) * dpr);
      ringGrad.addColorStop(0, "#9fe8ffcc");
      ringGrad.addColorStop(0.5, "#eaf6ff");
      ringGrad.addColorStop(1, "#9fe8ffcc");
      ctx.beginPath();
      ctx.arc(cx * dpr, cy * dpr, coreRadius * dpr + 1.2 * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = ringGrad;
      ctx.lineWidth = 1.6 * dpr;
      ctx.stroke();

      if (!reduced) {
        for (const p of particles) p.theta += p.speed * speedBoost * dt;
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      if (!coarse || frame % 2 === 0) render(now); // 移动端 30fps
      frame++;
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (running || reduced) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) start();
      else stop();
    }, { threshold: 0.05 });
    observer.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (reduced) render(performance.now());
    else start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [visibleKey, size, visible, total]);

  // 悬停命中：按盘面坐标角度+半径判定所属扇区。
  const hitTest = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - rect.left - rect.width / 2;
    const dy = (clientY - rect.top - rect.height / 2) / TILT;
    const radius = Math.hypot(dx, dy) / (rect.width / 2 - 6);
    if (radius < DISK_INNER * 0.8 || radius > DISK_OUTER * 1.12) return null;
    let angle = Math.atan2(dx, -dy); // 12 点为 0，顺时针
    if (angle < 0) angle += Math.PI * 2;
    let acc = 0;
    for (const slice of visible) {
      const span = (slice.value / Math.max(total, 1)) * Math.PI * 2;
      if (angle >= acc && angle < acc + span) return slice.id;
      acc += span;
    }
    return null;
  };

  return (
    <div
      className="donut-wrap"
      style={{ width: size, height: size }}
      onPointerMove={(event) => activate(hitTest(event.clientX, event.clientY))}
      onPointerLeave={() => activate(null)}
    >
      <div className="donut-fallback" aria-hidden style={{ background: conicFallback(visible, total), opacity: mounted ? 0 : 1 }} />
      <canvas
        ref={canvasRef}
        className="donut-canvas"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${centerLabel}：${centerValue}。${visible.map((slice) => `${slice.label} ${total > 0 ? Math.round((slice.value / total) * 100) : 0}%`).join("，")}`}
      />
      {labelSpots.map((spot) => (
        <span
          key={spot.id}
          className={`donut-spot${spot.dim ? " is-dim" : ""}${active === spot.id ? " is-active" : ""}`}
          style={{ left: `calc(50% + ${spot.x}px)`, top: `calc(50% + ${spot.y}px)`, color: spot.color }}
          onPointerEnter={() => activate(spot.id)}
        >
          {spot.text}
        </span>
      ))}
      <div className="donut-center" aria-hidden>
        {activeSlice ? (
          <>
            <strong className="donut-center-value">{total > 0 ? ((activeSlice.value / total) * 100).toFixed(1) : 0}%</strong>
            <span className="donut-center-label">{activeSlice.label}</span>
          </>
        ) : (
          <>
            <strong className="donut-center-value">{centerValue}</strong>
            <span className="donut-center-label">{centerLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** JS 生效前的静态兜底环：阵营色 conic-gradient。 */
function conicFallback(slices: DonutSlice[], total: number) {
  if (total <= 0) return "transparent";
  let acc = 0;
  const parts = slices.map((slice) => {
    const from = (acc / total) * 360;
    acc += slice.value;
    const to = (acc / total) * 360;
    return `${slice.color} ${from}deg ${to}deg`;
  });
  return `conic-gradient(from 0deg, ${parts.join(", ")})`;
}
