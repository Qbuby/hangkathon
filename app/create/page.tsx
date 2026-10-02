"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  STEPS,
  initialDraft,
  slugify,
  validateAll,
  validateStep,
  type Activity,
  type Award,
  type Criterion,
  type Draft,
} from "@/lib/activity";
import { createActivity } from "@/lib/api/data";
import { hasServerData } from "@/lib/api/client";
import FieldControl from "./fields";
import SiteHeader from "../site-header";
import { usePageMotion } from "../motion-scope";
import "./create.css";

export default function CreateActivityPage() {
  const [values, setValues] = useState<Draft>(() => initialDraft());
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [slugTouched, setSlugTouched] = useState(false);
  const [published, setPublished] = useState<Activity | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [mode, setMode] = useState<"local" | "server">("local");

  // 入场动效：步骤卡与表单面板依次入场；切步骤或发布成功时表单/成功页重新入场。
  usePageMotion("create", { signature: `${stepIndex}:${published ? "done" : "edit"}` });

  useEffect(() => {
    void hasServerData().then((server) => setMode(server ? "server" : "local"));
  }, []);

  // Signed-in hosts get their name prefilled; the flow stays usable without it.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/session");
        const data = (await response.json()) as { user?: { name: string | null; email: string | null } | null };
        const name = data.user?.name ?? data.user?.email ?? "";
        if (!cancelled && name) setValues((prev) => (prev.host ? prev : { ...prev, host: name }));
      } catch {
        /* the field stays empty and the host types it */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const step = STEPS[stepIndex];
  const visibleFields = useMemo(
    () => step.fields.filter((field) => !field.showIf || field.showIf(values)),
    [step, values],
  );

  function update(name: string, value: unknown) {
    if (name === "slug") setSlugTouched(true);
    setValues((prev) => {
      const next: Draft = { ...prev, [name]: value };
      if (name === "title" && !slugTouched) {
        // A Chinese title leaves almost nothing behind after stripping to ASCII,
        // so only auto-fill when the result is actually usable as a URL.
        const candidate = slugify(String(value));
        next.slug = candidate.length >= 3 ? candidate : "";
      }
      return next;
    });
    setErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
  }

  function goNext() {
    const stepErrors = validateStep(step, values);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  }

  function goBack() {
    setErrors({});
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  async function publish() {
    const all = validateAll(values);
    if (Object.keys(all).length > 0) {
      setErrors(all);
      const firstBad = STEPS.findIndex((s) => s.fields.some((field) => all[field.name]));
      if (firstBad >= 0) setStepIndex(firstBad);
      return;
    }
    setPublishing(true);
    setPublishError(null);
    try {
      // 有数据库的部署 POST /api/activities（归属当前登录用户）；没有数据库的写本机。
      const activity = await createActivity(values);
      setPublished(activity);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "创建失败，请稍后重试。");
    } finally {
      setPublishing(false);
    }
  }

  if (published) {
    return (
      <main className="create-page">
        <div className="create-done" data-reveal="item">
          <span className="create-done-mark"><Check size={26} /></span>
          <h1>活动已创建</h1>
          <p>
            {mode === "server"
              ? published.reviewStatus === "pending"
                ? `「${published.title}」已提交，进入审核，通过后会出现在活动看板。`
                : `「${published.title}」已经发布到平台，所有人都能在活动看板看到它。`
              : `「${published.title}」已经加入活动列表。当前版本把活动保存在这台设备的浏览器里，换设备或清理数据后会消失。`}
          </p>
          <div className="create-done-actions">
            <Button asChild className="primary-action"><Link href={`/activities/${published.slug}`}>查看活动页 <ArrowRight size={18} /></Link></Button>
            <Button variant="ghost" className="secondary-action"><Link href="/#activities">回到活动看板</Link></Button>
            <Button variant="ghost" className="secondary-action" onClick={() => { setPublished(null); setValues(initialDraft()); setStepIndex(0); setSlugTouched(false); }}>
              再办一场
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const criteria = (values.criteria as Criterion[]) ?? [];
  const awards = (values.awards as Award[]) ?? [];

  return (
    <main className="create-page">
      <SiteHeader />

      <div className="create-body">
        <nav className="create-steps" aria-label="创建步骤">
          {STEPS.map((item, index) => {
            const state = index === stepIndex ? "current" : index < stepIndex ? "done" : "todo";
            return (
              <button
                key={item.id}
                type="button"
                className={`create-step is-${state}`}
                data-reveal="block"
                aria-current={state === "current" ? "step" : undefined}
                onClick={() => { setErrors({}); setStepIndex(index); }}
              >
                <span className="create-step-index">{state === "done" ? <Check size={13} /> : index + 1}</span>
                <span className="create-step-text">
                  <strong>{item.title}</strong>
                  <small>{item.summary}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <section className="create-form" aria-labelledby="create-step-title" data-reveal="item">
          <div className="create-form-head">
            <div>
              <h2 id="create-step-title">{step.title}</h2>
              <p>{step.summary}</p>
            </div>
            <span className="create-top-step">
              第 {stepIndex + 1} / {STEPS.length} 步
            </span>
          </div>

          <div className="cf-grid">
            {visibleFields.map((field) => (
              <FieldControl
                key={field.name}
                field={field}
                value={values[field.name]}
                error={errors[field.name]}
                onChange={update}
              />
            ))}
          </div>

          <div className="create-actions">
            <Button variant="ghost" className="create-secondary" onClick={goBack} disabled={stepIndex === 0}>
              <ArrowLeft size={17} /> 上一步
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button className="create-primary" onClick={goNext}>
                下一步 <ArrowRight size={17} />
              </Button>
            ) : (
              <Button className="create-primary" onClick={() => void publish()} disabled={publishing}>
                <Rocket size={17} /> {publishing ? "发布中…" : "创建活动"}
              </Button>
            )}
          </div>
          {publishError && (
            <p className="cf-error" role="alert">
              {publishError}
              {mode === "server" && publishError.includes("登录") && (
                <> —— 请先用右上角入口登录后再发起活动。</>
              )}
            </p>
          )}
        </section>

        <aside className="create-preview" aria-label="活动预览">
          <span className="create-preview-label" data-reveal="block">预览</span>
          <div className="create-card" data-reveal="block">
            <div className="create-card-tags">
              <span>{values.format === "online" ? "线上" : "线下"}</span>
              <span>{values.pricing === "paid" ? "收费" : "免费"}</span>
              {values.visibility === "unlisted" && <span>不公开</span>}
            </div>
            <h3>{String(values.title || "未命名活动")}</h3>
            <p className="create-card-sub">{String(values.subtitle || "还没有写一句话说明")}</p>
            <dl className="create-card-meta">
              <div><dt>主办方</dt><dd>{String(values.host || "—")}</dd></div>
              <div><dt>联系方式</dt><dd>{String(values.contact || "—")}</dd></div>
              <div><dt>时间</dt><dd>{values.startsAt ? `${values.startsAt} → ${values.endsAt || "待定"}` : "—"}</dd></div>
              <div><dt>评审</dt><dd>{criteria.filter((c) => c.name).length} 个维度</dd></div>
              <div><dt>奖项</dt><dd>{values.awardsEnabled ? `${awards.filter((a) => a.name).length} 项` : "不设奖"}</dd></div>
              <div><dt>活动代号</dt><dd>{String(values.slug || "…")}</dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}
