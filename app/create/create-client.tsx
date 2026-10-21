"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Rocket, ShieldCheck } from "lucide-react";
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
import { displayName, isWechatPlaceholderEmail } from "@/lib/display-name";
import FieldControl from "./fields";
import SiteHeader from "../site-header";
import { LoginPanel } from "../login-panel";
import { usePageMotion } from "../motion-scope";
import "./create.css";

/** /create 的身份门禁状态：loading 校验中；local 无数据库部署（不做门禁）；login 未登录；apply 非代理商；form 放行。 */
type GatePhase = "loading" | "local" | "login" | "apply" | "form";

type AgentApplication = {
  id: string;
  status: "pending" | "approved" | "rejected";
  contactName: string;
  organization: string;
  phone: string;
  email: string;
  statement: string;
  reviewNote: string | null;
  updatedAt: string;
};

const EMPTY_APPLY = { contactName: "", organization: "", phone: "", email: "", statement: "" };

export default function CreateActivityPage() {
  const [values, setValues] = useState<Draft>(() => initialDraft());
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [slugTouched, setSlugTouched] = useState(false);
  const [published, setPublished] = useState<Activity | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [mode, setMode] = useState<"local" | "server">("local");

  // 代理商门禁：有数据库的部署里只有代理商（和管理员）能发布。
  // loading → local（无库，直接放行）/ login（未登录）/ apply（非代理商）/ form（放行）。
  const [gate, setGate] = useState<GatePhase>("loading");
  const [providers, setProviders] = useState<{ id: string; name: string; configured: boolean }[]>([]);
  const [loginConfigured, setLoginConfigured] = useState(true);
  const [application, setApplication] = useState<AgentApplication | null>(null);
  const [applyForm, setApplyForm] = useState(EMPTY_APPLY);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyEditing, setApplyEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const server = await hasServerData();
      if (cancelled) return;
      setMode(server ? "server" : "local");
      // 无数据库的部署没有角色系统（活动在本机），保持原有直接进入的行为
      if (!server) {
        setGate("local");
        return;
      }
      try {
        const response = await fetch("/api/agent/session");
        const data = (await response.json()) as {
          user?: { email: string | null; name: string | null } | null;
          role?: string | null;
          canPublish?: boolean;
          application?: AgentApplication | null;
        };
        if (cancelled) return;
        if (!data.user) {
          // 未登录：取登录按钮列表（与 /manage 的登录引导同一套）
          const sessionResponse = await fetch("/api/session");
          const sessionData = (await sessionResponse.json()) as {
            configured: boolean;
            providers: { id: string; name: string; configured: boolean }[];
          };
          if (!cancelled) {
            setProviders(sessionData.providers ?? []);
            setLoginConfigured(Boolean(sessionData.configured));
            setGate("login");
          }
          return;
        }
        setApplication(data.application ?? null);
        if (data.application && data.application.status !== "approved") {
          setApplyForm({
            contactName: data.application.contactName,
            organization: data.application.organization,
            phone: data.application.phone,
            email: data.application.email,
            statement: data.application.statement,
          });
        }
        setGate(data.canPublish ? "form" : "apply");
      } catch {
        if (!cancelled) setGate("apply");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
        /**
         * 主持人名预填：用展示名，不要把微信占位邮箱（openid）填进可公开的活动字段。
         * 微信账号的展示名是「微信用户 · XXXX」—— 当主持人名不像话，留空让用户自己填。
         */
        const name = data.user && !isWechatPlaceholderEmail(data.user.email) ? displayName(data.user, "") : "";
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

  /** 提交代理商申请：成功后回到「审核中」视图。 */
  async function submitApply() {
    setApplyBusy(true);
    setApplyError(null);
    try {
      const response = await fetch("/api/agent/application", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(applyForm),
      });
      const data = (await response.json().catch(() => null)) as { application?: AgentApplication; error?: string } | null;
      if (!response.ok) {
        setApplyError(data?.error ?? "提交失败，请稍后重试。");
        return;
      }
      if (data?.application) setApplication(data.application);
      setApplyEditing(false);
    } catch {
      setApplyError("提交失败，请检查网络后重试。");
    } finally {
      setApplyBusy(false);
    }
  }

  if (gate === "loading") {
    return (
      <main className="create-page">
        <SiteHeader />
        <div className="agent-gate" data-reveal="block">
          <p className="detail-placeholder">正在校验发布身份…</p>
        </div>
      </main>
    );
  }

  if (gate === "login") {
    return (
      <main className="create-page">
        <SiteHeader />
        <div className="agent-gate" data-reveal="block">
          <span className="agent-gate-icon"><ShieldCheck size={30} /></span>
          <h1>先登录，再发起活动</h1>
          {/*
            统一登录面板：手机端自动切到公众号验证码，与首页完全同一套。
            之前这里手写了一排「使用 微信 登录」按钮，手机点下去会跳到 qrconnect
            ——手机上那张二维码永远扫不掉。
          */}
          <LoginPanel
            providers={providers}
            configured={loginConfigured}
            callbackUrl="/create"
            hint="发起活动需要平台授权的代理商身份。登录后我们会校验你的账号；如果你还不是代理商，可以直接在下一步提交申请。"
          />
        </div>
      </main>
    );
  }

  if (gate === "apply") {
    const pending = application?.status === "pending" && !applyEditing;
    const rejected = application?.status === "rejected";
    return (
      <main className="create-page">
        <SiteHeader />
        <div className="agent-gate" data-reveal="block">
          <span className="agent-gate-icon"><Rocket size={30} /></span>
          <h1>发起活动需要代理商身份</h1>
          <p>
            平台的活动发布权只对<b>代理商</b>开放：代理商负责发起和运营活动，参与者以个人身份报名参赛。
            如果你想成为代理商，请填写下面的身份声明与联系方式提交审核，通过后即可发起活动。
          </p>

          {pending ? (
            <div className="agent-apply-status">
              <p className="agent-apply-state is-pending">审核中</p>
              <p>
                你的申请已在 {new Date(application!.updatedAt).toLocaleString("zh-CN")} 提交，平台会尽快处理。
                审核通过后刷新本页即可开始创建活动。
              </p>
              <dl className="agent-apply-meta">
                <div><dt>联系人</dt><dd>{application!.contactName}</dd></div>
                <div><dt>机构</dt><dd>{application!.organization || "—"}</dd></div>
                <div><dt>电话</dt><dd>{application!.phone}</dd></div>
              </dl>
              <button className="secondary-action" type="button" onClick={() => setApplyEditing(true)}>
                修改申请
              </button>
            </div>
          ) : (
            <form
              className="agent-apply-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitApply();
              }}
            >
              {rejected && (
                <p className="agent-apply-state is-rejected">
                  上次申请未通过{application?.reviewNote ? `：${application.reviewNote}` : ""}。你可以修改后重新提交。
                </p>
              )}
              <label className="agent-field">
                <span>联系人姓名 *</span>
                <input
                  value={applyForm.contactName}
                  onChange={(event) => setApplyForm({ ...applyForm, contactName: event.target.value })}
                  placeholder="真实姓名"
                  required
                />
              </label>
              <label className="agent-field">
                <span>机构 / 组织</span>
                <input
                  value={applyForm.organization}
                  onChange={(event) => setApplyForm({ ...applyForm, organization: event.target.value })}
                  placeholder="公司、社团或团队名称（没有可留空）"
                />
              </label>
              <label className="agent-field">
                <span>联系电话 *</span>
                <input
                  value={applyForm.phone}
                  onChange={(event) => setApplyForm({ ...applyForm, phone: event.target.value })}
                  placeholder="手机号或固话"
                  required
                />
              </label>
              <label className="agent-field">
                <span>电子邮箱</span>
                <input
                  type="email"
                  value={applyForm.email}
                  onChange={(event) => setApplyForm({ ...applyForm, email: event.target.value })}
                  placeholder="接收审核结果的邮箱"
                />
              </label>
              <label className="agent-field">
                <span>身份声明 *</span>
                <textarea
                  value={applyForm.statement}
                  onChange={(event) => setApplyForm({ ...applyForm, statement: event.target.value })}
                  placeholder="你是谁、代表什么组织、计划发起什么类型的活动（至少 10 个字）"
                  rows={5}
                  required
                />
              </label>
              {applyError && <p className="agent-apply-error">{applyError}</p>}
              <div className="agent-apply-actions">
                <button className="primary-action" type="submit" disabled={applyBusy}>
                  {applyBusy ? "提交中…" : pending || rejected ? "重新提交申请" : "提交申请"}
                </button>
                {pending && (
                  <button className="secondary-action" type="button" onClick={() => setApplyEditing(false)}>
                    取消
                  </button>
                )}
              </div>
            </form>
          )}
          <p className="agent-gate-note">
            已有代理商身份？<Link href="/create">刷新页面</Link>即可进入创建流程。有疑问请通过活动页公示的联系方式联系平台方。
          </p>
        </div>
      </main>
    );
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
