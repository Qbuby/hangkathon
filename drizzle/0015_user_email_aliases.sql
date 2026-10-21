-- 账号合并后的旧 email 别名（2026-10-21）
--
-- 合并两个 users 行时，被并掉那行的 email 会消失，但浏览器里还握着用那个 email
-- 签发的 JWT（Auth.js 的 JWT 无服务端吊销）。旧代码按 email upsert，查不到就新建，
-- 于是"合并瞬间持有会话的人"会静默变成空号 —— 线上真实发生过：
-- 手机端显示「微信用户 · 6B1B67」，而带昵称的真账号是 OnlyBlue。
--
-- 这张表记录「旧 email → 存活用户」，ensureUser() 先查别名再 upsert。
-- 只增不改：别名是历史事实。

CREATE TABLE IF NOT EXISTS "user_email_aliases" (
	"email" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_email_aliases" ADD CONSTRAINT "user_email_aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_email_aliases_user_idx" ON "user_email_aliases" USING btree ("user_id");
--> statement-breakpoint

/**
 * ── 回填空号产生的别名 ────────────────────────────────────────────────────
 *
 * 症状：同一个人的占位邮箱在 users 里有**两行**，一行是 unionid 命中的真账号
 * （有昵称/报名），另一行是后续请求按旧 email 新建的空号（无 unionid、无数据）。
 *
 * 判定依据只有一条是可靠的：`wechat_login_codes` 里同一个 openid **明确绑定过**
 * 某个 userId。若该 openid 的占位邮箱现在指向另一行，那另一行就是空号。
 *
 * 这里只处理"空号"：昵称为空、没有 unionid、且没有任何业务数据。
 * 有数据的行一律不动 —— 宁可留一个可疑账号，也不能把用户数据并错人。
 */
CREATE TEMP TABLE "_alias_candidates" ON COMMIT DROP AS
SELECT DISTINCT
	lower(c."open_id" || '@wechat.user') AS email,
	c."user_id" AS canonical_user_id
FROM "wechat_login_codes" c
WHERE c."open_id" IS NOT NULL AND c."user_id" IS NOT NULL;
--> statement-breakpoint

INSERT INTO "user_email_aliases" ("email", "user_id")
SELECT cand.email, cand.canonical_user_id
FROM "_alias_candidates" cand
JOIN "users" u ON lower(u."email") = cand.email
WHERE u."id" <> cand.canonical_user_id
  AND u."name" IS NULL
  AND u."union_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM joins j WHERE j.user_id = u."id")
  AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.user_id = u."id")
  AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.owner_id = u."id")
  AND NOT EXISTS (SELECT 1 FROM invite_events i WHERE i.inviter_id = u."id" OR i.invitee_id = u."id")
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint

-- 这些空号已被别名覆盖，删掉它们（否则 users 里仍留着同名占位邮箱，
-- 下次 ensureUser 的 upsert 会优先命中它，而不是走别名）。
DELETE FROM "users" u
USING "_alias_candidates" cand
WHERE lower(u."email") = cand.email
  AND u."id" <> cand.canonical_user_id
  AND u."name" IS NULL
  AND u."union_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM joins j WHERE j.user_id = u."id")
  AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.user_id = u."id")
  AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.owner_id = u."id")
  AND NOT EXISTS (SELECT 1 FROM invite_events i WHERE i.inviter_id = u."id" OR i.invitee_id = u."id");
--> statement-breakpoint

DROP TABLE "_alias_candidates";
