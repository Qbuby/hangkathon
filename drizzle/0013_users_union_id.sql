-- 微信 unionid 落到 users（2026-10-21）
--
-- 为什么需要它：手机端走公众号验证码登录，微信只给 openid（对公众号唯一）与
-- unionid（对开放平台唯一）。同一个人在电脑上用「网站应用扫码」登录过时，
-- users 里已经有一行 `<网站应用的 openid>@wechat.user`，但**当时没有存 unionid**
-- （那时觉得用不上）。结果手机登录只能按公众号 openid 另建一行，同一个人裂成两个号，
-- 昵称也就丢了。
--
-- 现在把 unionid 存在 users 上：
--   · 扫码登录时写入（auth.ts 的 profile 回调走 lib/server/wechat-identity.ts）；
--   · 手机登录时先按 unionid 认人，命中就复用老账号（连同昵称、报名、作品）。
--
-- 回填：wechat_login_codes 里已经存过 unionid 的历史行可以补到 users 上。
-- 先按 user_id / union_id 双向去重（每个用户只取一个 unionid、每个 unionid 只认一个用户），
-- 再只补"当前还没有 unionid"的行 —— 否则唯一索引建不起来。

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "union_id" text;
--> statement-breakpoint
WITH ranked AS (
	SELECT c."union_id", c."user_id",
		row_number() OVER (PARTITION BY c."user_id" ORDER BY c."created_at" DESC) AS rn_user,
		row_number() OVER (PARTITION BY c."union_id" ORDER BY c."created_at" DESC) AS rn_union
	FROM "wechat_login_codes" c
	WHERE c."union_id" IS NOT NULL AND c."user_id" IS NOT NULL
), pick AS (
	SELECT "union_id", "user_id" FROM ranked WHERE rn_user = 1 AND rn_union = 1
)
UPDATE "users" u SET "union_id" = pick."union_id"
FROM pick
WHERE u."id" = pick."user_id" AND u."union_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_union_id_unique" ON "users" USING btree ("union_id");
