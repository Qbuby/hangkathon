import { NextResponse } from "next/server";
import { HONOR_LEVELS, platformTotals } from "@/lib/contribution";
import { FACTIONS } from "@/lib/factions";
import { listActivities } from "@/lib/server/activities";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { currentUser } from "@/lib/server/users";

/**
 * 荣誉榜数据（小程序与网页共用同一份）。
 *
 * ── 为什么要单独开一个接口 ──────────────────────────────────────────────
 * 网页版此前是服务端组件直接算 `platformTotals()`，小程序拿不到。
 * 而且网页那边的「已发布活动」用的是 `PUBLISHED_ACTIVITIES.length`
 * —— 那是**代码里写死的预置活动数**，与实际库里的活动条数不是一回事
 * （用户自己建的活动、被下线的活动都不在里）。两边迟早会打架。
 * 现在统一从这里取，网页与小程序数字一致。
 *
 * ── 隐私 ────────────────────────────────────────────────────────────────
 * 只返回贡献值聚合与展示名，不返回 email、openid、unionid。
 * `platformTotals()` 里的 `name` 来自 `lib/display-name.ts` 的口径
 * （微信账号是「微信用户 · XXXXXX」），不会泄露身份键。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    const activities = await listActivities(user?.id ?? null);
    const visible = activities.filter((item) => item.visibility === "public");
    const totals = platformTotals();

    return NextResponse.json({
      totals,
      // 各区统计：与 /leaderboard 页面上的「各区统计」同源
      districts: FACTIONS.map((faction) => ({
        ...faction,
        count: visible.filter((activity) => activity.district === faction.id).length,
      })),
      // 勋章档位给小程序画进度条用，避免前端硬编码 500/2000/6000/15000
      honorLevels: HONOR_LEVELS,
      activityCount: visible.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
