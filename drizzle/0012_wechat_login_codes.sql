-- 公众号验证码登录（2026-10-21）
--
-- 为什么是这张表：账号是**订阅号**，微信对订阅号限制了两条常见路径 ——
-- 带参二维码（仅认证服务号）与网页授权（仅服务号）。但「接收用户消息」是订阅号
-- 的基本能力，所以流程反过来走：
--   网页生成 6 位码 → 用户在公众号里发这个码 → 公众号把 (openid, 文本) 推给我们的
--   回调 → 后端把 openid 绑到这条码上 → 前端轮询到 bound 就换登录态。
--
-- 一次性：前端取走登录态后置 consumed_at，第二次取一律拒绝（防重放）。
-- 过期 10 分钟：够用户切到微信发消息，又不至于让泄露的码长期可用。

CREATE TABLE IF NOT EXISTS "wechat_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"open_id" text,
	"union_id" text,
	"user_id" uuid,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wechat_login_codes" ADD CONSTRAINT "wechat_login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wechat_login_codes_code_unique" ON "wechat_login_codes" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wechat_login_codes_status_idx" ON "wechat_login_codes" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wechat_login_codes_openid_idx" ON "wechat_login_codes" USING btree ("open_id");
