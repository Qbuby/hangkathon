-- 归一化占位邮箱并合并大小写造成的重复账号（2026-10-21）
--
-- 问题：openid 是大小写敏感的（`oe8Tr3AQMIN1...` 里就带大写），而
-- `currentUser()` 读会话时把 email 转小写再按 email upsert。建号时若保留原始
-- 大小写，下一次任何接口调用都会因为精确匹配查不到而**再建一行**。
-- 线上已经出现：同一个微信用户两行，一行有 unionid、另一行是空的。
--
-- 处理顺序（单事务，全部可重入）：
--   1. 把 users.email 里所有 `@wechat.user` 的行改成小写；若目标小写已存在，
--      先按合并规则把业务数据迁到"更早注册"的那一行，再删掉重复行。
--   2. 清理历史遗留：大小写不同但实质相同、且都没 unionid 的重复行。
--
-- 合并规则与 lib/server/wechat-identity.ts 的 mergeUsers 一致：
-- keeper = 更早注册的那行；joins 同活动去重；黑名单按 email 迁；角色只升不降。

-- ── 1) 先把重复行上的 union_id 挪走，避免唯一索引阻塞合并 ──────────────────
-- 规则：keeper（更早注册）没 unionid 时，从 loser 抄一个；keeper 已有就清掉 loser 的，
-- 否则下一步改 email 时不会撞索引、合并也不会因为唯一约束失败。
WITH ranked AS (
	SELECT id, lower(email) AS norm,
		row_number() OVER (PARTITION BY lower(email) ORDER BY created_at ASC, id ASC) AS rn
	FROM "users"
	WHERE lower(email) LIKE '%@wechat.user'
), grp AS (
	SELECT norm, min(id::text) FILTER (WHERE rn = 1) AS keeper_id FROM ranked GROUP BY norm HAVING count(*) > 1
)
UPDATE "users" k SET union_id = COALESCE(
		k.union_id,
		(SELECT u2.union_id FROM "users" u2
		 JOIN ranked r2 ON r2.id = u2.id
		 WHERE r2.norm = g.norm AND r2.rn > 1 AND u2.union_id IS NOT NULL
		 LIMIT 1)
	)
FROM grp g
WHERE k.id::text = g.keeper_id AND k.union_id IS NULL;
--> statement-breakpoint
WITH ranked AS (
	SELECT id, lower(email) AS norm,
		row_number() OVER (PARTITION BY lower(email) ORDER BY created_at ASC, id ASC) AS rn
	FROM "users"
	WHERE lower(email) LIKE '%@wechat.user'
), grp AS (
	SELECT norm FROM ranked GROUP BY norm HAVING count(*) > 1
)
UPDATE "users" u SET union_id = NULL
FROM ranked r JOIN grp g ON g.norm = r.norm
WHERE u.id = r.id AND r.rn > 1;
--> statement-breakpoint
-- ── 2) 业务数据迁移：报名（同活动先去重）──────────────────────────────────
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
DELETE FROM joins l
USING joins k, pairs p
WHERE l.user_id = p.loser AND k.user_id = p.keeper AND l.activity_id = k.activity_id;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE joins j SET user_id = p.keeper FROM pairs p WHERE j.user_id = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE joins j SET invited_by = p.keeper FROM pairs p WHERE j.invited_by = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE submissions s SET user_id = p.keeper FROM pairs p WHERE s.user_id = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE invite_events e SET inviter_id = p.keeper FROM pairs p WHERE e.inviter_id = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE invite_events e SET invitee_id = p.keeper FROM pairs p WHERE e.invitee_id = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE activities a SET owner_id = p.keeper FROM pairs p WHERE a.owner_id = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE wechat_login_codes c SET user_id = p.keeper FROM pairs p WHERE c.user_id = p.loser;
--> statement-breakpoint
-- 代理商申请一人一份：keeper 已有就删 loser 的
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
DELETE FROM agent_applications a USING pairs p, agent_applications k
WHERE a.user_id = p.loser AND k.user_id = p.keeper;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE agent_applications a SET user_id = p.keeper FROM pairs p WHERE a.user_id = p.loser;
--> statement-breakpoint
-- 黑名单按 email 存：keeper 已有条目就删 loser 的，否则把 email 改成 keeper 的
-- 判重必须看 **keeper 自己的原始 email**，不能用归一化后的 norm ——
-- loser 的黑名单行本身就可能正好是 norm 的拼写，用它判重会把要迁的那条删掉。
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
DELETE FROM user_blacklist b USING pairs p, users l, users k
WHERE l.id = p.loser AND b.email = l.email AND k.id = p.keeper AND k.email = b.email;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE user_blacklist b SET email = k.email FROM pairs p
JOIN users k ON k.id = p.keeper
JOIN users l ON l.id = p.loser
WHERE b.email = l.email;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE user_blacklist b SET created_by = p.keeper FROM pairs p WHERE b.created_by = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE user_blacklist b SET revoked_by = p.keeper FROM pairs p WHERE b.revoked_by = p.loser;
--> statement-breakpoint
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE agent_applications a SET reviewed_by = p.keeper FROM pairs p WHERE a.reviewed_by = p.loser;
--> statement-breakpoint
-- 昵称/头像/角色：keeper 缺的从 loser 补；角色只升不降
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
), pairs AS (
	SELECT ids[1] AS keeper, unnest(ids[2:array_length(ids, 1)]) AS loser FROM dup
)
UPDATE "users" k SET
	"name" = COALESCE(k."name", sub.best_name),
	"image" = COALESCE(k."image", sub.best_image),
	"role" = CASE WHEN sub.has_admin THEN 'admin' ELSE k."role" END
FROM (
	SELECT p.keeper,
		(SELECT u2."name" FROM "users" u2 JOIN pairs p2 ON u2.id = p2.loser
		 WHERE p2.keeper = p.keeper AND u2."name" IS NOT NULL LIMIT 1) AS best_name,
		(SELECT u2."image" FROM "users" u2 JOIN pairs p2 ON u2.id = p2.loser
		 WHERE p2.keeper = p.keeper AND u2."image" IS NOT NULL LIMIT 1) AS best_image,
		EXISTS (SELECT 1 FROM "users" u3 JOIN pairs p3 ON u3.id = p3.loser
			WHERE p3.keeper = p.keeper AND u3."role" = 'admin') AS has_admin
	FROM pairs p GROUP BY p.keeper
) sub
WHERE k.id = sub.keeper;
--> statement-breakpoint
-- ── 3) 删除重复行（数据已迁完）────────────────────────────────────────────
WITH dup AS (
	SELECT array_agg(id ORDER BY created_at ASC, id ASC) AS ids
	FROM "users" WHERE lower(email) LIKE '%@wechat.user' GROUP BY lower(email) HAVING count(*) > 1
)
DELETE FROM "users" WHERE id IN (
	SELECT unnest(ids[2:array_length(ids, 1)]) FROM dup
);
--> statement-breakpoint
-- ── 4) 最后统一转小写 ──────────────────────────────────────────────────────
UPDATE "users" SET email = lower(email)
WHERE lower(email) LIKE '%@wechat.user' AND email <> lower(email);
--> statement-breakpoint
/**
 * 黑名单表也必须一起转小写。
 *
 * `requireNotBlacklisted()` 用会话里的 email（**已转小写**）去精确匹配
 * `user_blacklist.email`。如果这里留着 `zzDupCase@...` 这种混合大小写，
 * 被拉黑的人只是换个大小写登录就能绕过限制 —— 这不是展示问题，是权限漏洞。
 * 顺带把所有历史条目（不止 wechat 占位邮箱）都归一化，避免同类问题。
 */
UPDATE "user_blacklist" SET email = lower(email)
WHERE email <> lower(email);
