-- 审计日志是 append-only（0009 的触发器拒绝 UPDATE/DELETE），因此它不能持有指向业务表的
-- 外键：删除用户时 ON DELETE SET NULL 会对 audit_logs 发出 UPDATE，被触发器拦下，
-- 结果是"有过审计记录的用户永远删不掉"。追溯靠的是行内的 user_email 文本，不依赖外键。
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_users_id_fk";