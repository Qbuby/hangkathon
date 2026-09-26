"use client";

import {
  findActivityBySlug as findLocalActivity,
  loadActivities as loadLocalActivities,
  saveActivity as saveLocalActivity,
  toActivity,
  type Activity,
  type Draft,
} from "../activity";
import {
  loadActivitySubmissions as loadLocalSubmissions,
  addSubmission as addLocalSubmission,
  type SubmissionRecord,
} from "../submission";
import {
  loadJoin as loadLocalJoin,
  loadJoins as loadLocalJoins,
  saveJoin as saveLocalJoin,
  type JoinRecord,
} from "../contribution";
import {
  loadInviteEvents as loadLocalInviteEvents,
  recordInviteEvent as recordLocalInviteEvent,
  type InviteEvent,
} from "../invites";
import { PUBLISHED_ACTIVITIES } from "../published-activities";
import {
  filterByWindow,
  type ExternalEvent,
} from "../external-events";
import { ApiError, apiFetch, hasServerData } from "./client";

/**
 * 页面统一从这里取数：有数据库走 API，没有就回落到 localStorage。
 * 返回值形状刻意与原来保持一致，页面改动尽量小。
 */

export type ActivityView = Activity & {
  mine?: boolean;
  seeded?: boolean;
  ownerName?: string | null;
};

export type ActivityDetail = {
  activity: ActivityView;
  joined: boolean;
  joinedAt: string | null;
  joinCount: number;
};

export async function listActivities(): Promise<ActivityView[]> {
  if (await hasServerData()) {
    const { activities } = await apiFetch<{ activities: ActivityView[] }>("/api/activities");
    return activities;
  }
  return [...PUBLISHED_ACTIVITIES, ...loadLocalActivities()];
}

export async function getActivity(slug: string): Promise<ActivityDetail | null> {
  if (await hasServerData()) {
    try {
      return await apiFetch<ActivityDetail>(`/api/activities/${encodeURIComponent(slug)}`);
    } catch {
      return null;
    }
  }
  const activity = findLocalActivity(slug, PUBLISHED_ACTIVITIES);
  if (!activity) return null;
  const join = loadLocalJoin(activity.id);
  return { activity, joined: Boolean(join), joinedAt: join?.joinedAt ?? null, joinCount: 0 };
}

export async function createActivity(values: Draft): Promise<ActivityView> {
  if (await hasServerData()) {
    const { activity } = await apiFetch<{ activity: ActivityView }>("/api/activities", {
      method: "POST",
      body: JSON.stringify(values),
    });
    return activity;
  }
  const activity = toActivity(values);
  saveLocalActivity(activity);
  return activity;
}

export async function joinActivity(activity: ActivityView, invitedBy?: string): Promise<void> {
  if (await hasServerData()) {
    await apiFetch(`/api/activities/${encodeURIComponent(activity.slug)}/join`, {
      method: "POST",
      body: JSON.stringify(invitedBy ? { invitedBy } : {}),
    });
    return;
  }
  saveLocalJoin(activity.id, invitedBy ? { invitedBy } : undefined);
}

export async function listMyJoins(): Promise<Record<string, JoinRecord>> {
  if (await hasServerData()) {
    const { joins } = await apiFetch<{ joins: { activityId: string; joinedAt: string; invitedBy: string | null }[] }>("/api/me");
    const map: Record<string, JoinRecord> = {};
    for (const join of joins) map[join.activityId] = { joinedAt: join.joinedAt, invitedBy: join.invitedBy ?? undefined };
    return map;
  }
  return loadLocalJoins();
}

/**
 * 未登录时的读接口会返回 401，这里降级成空列表：
 * 匿名访客本来就没有作品和邀请记录，不该因此让整个详情页加载失败。
 */
async function optionalServerRead<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return fallback;
    throw error;
  }
}

export async function listMySubmissions(activity: ActivityView): Promise<SubmissionRecord[]> {
  if (await hasServerData()) {
    return optionalServerRead(async () => {
      const { submissions } = await apiFetch<{ submissions: SubmissionRecord[] }>(
        `/api/activities/${encodeURIComponent(activity.slug)}/submissions`,
      );
      return submissions;
    }, []);
  }
  return loadLocalSubmissions(activity.id);
}

export async function submitWork(activity: ActivityView, url: string): Promise<SubmissionRecord> {
  if (await hasServerData()) {
    const { submission } = await apiFetch<{ submission: SubmissionRecord }>(
      `/api/activities/${encodeURIComponent(activity.slug)}/submissions`,
      { method: "POST", body: JSON.stringify({ url }) },
    );
    return submission;
  }
  const list = addLocalSubmission(activity.id, url);
  return list[list.length - 1];
}

/**
 * 手动刷新一条提交的作品数据，返回刷新后的整份列表。
 * localStorage 那份没有抓取（也就没有指标），原样返回即可。
 */
export async function refreshSubmission(activity: ActivityView, url: string): Promise<SubmissionRecord[]> {
  if (await hasServerData()) {
    const { submissions } = await apiFetch<{ submissions: SubmissionRecord[] }>(
      `/api/activities/${encodeURIComponent(activity.slug)}/submissions/refresh`,
      { method: "POST", body: JSON.stringify({ url }) },
    );
    return submissions;
  }
  return loadLocalSubmissions(activity.id);
}

export async function listMyInviteEvents(): Promise<InviteEvent[]> {
  if (await hasServerData()) {
    return optionalServerRead(async () => {
      const { events } = await apiFetch<{ events: InviteEvent[] }>("/api/invites");
      return events;
    }, []);
  }
  return loadLocalInviteEvents();
}

export async function recordInvite(event: InviteEvent): Promise<void> {
  if (await hasServerData()) {
    await apiFetch("/api/invites", { method: "POST", body: JSON.stringify(event) });
    return;
  }
  recordLocalInviteEvent(event);
}

/**
 * 全球赛事：只有服务端部署才有（每日抓取入库）。localStorage 模式没有这个数据源，
 * 返回空列表，页面整块不渲染。抓一把失败也返回空 —— 这个板块不该把活动页拖挂。
 */
export async function listGlobalEvents(): Promise<ExternalEvent[]> {
  if (await hasServerData()) {
    try {
      const { events } = await apiFetch<{ events: ExternalEvent[] }>("/api/events");
      return filterByWindow(events);
    } catch {
      return [];
    }
  }
  return [];
}

/** 单条全球赛事（详情页用）。localStorage 模式或查询失败返回 null。 */
export async function getGlobalEvent(id: string): Promise<ExternalEvent | null> {
  if (await hasServerData()) {
    try {
      const { event } = await apiFetch<{ event: ExternalEvent | null }>(`/api/events/${encodeURIComponent(id)}`);
      return event ?? null;
    } catch {
      return null;
    }
  }
  return null;
}
