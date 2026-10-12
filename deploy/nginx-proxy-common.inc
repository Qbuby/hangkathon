# 反代公共头 —— 被 hangkathon.com 与 uptime.hangkathon.com 的 vhost 以 include 引入。
#
# 为什么单独一份：这四个头原先在 3+1 个 location 里各抄一遍，改 XFF 策略时只改了两处、
# 漏了第三处（本项目真实发生过）。现在语义只在这一处定义。
#
# X-Forwarded-For 用 $remote_addr **覆盖**，不是 $proxy_add_x_forwarded_for 追加 ——
# 追加模式下客户端可以自报任意 XFF：既污染审计日志里"可溯源到真实网络地址"的可信度，
# 也让按 IP 的应用层限流能被逐请求换 IP 绕过。这条红线改一次就要想清楚。
#
# 文件扩展名故意用 .inc 而不是 .conf：宝塔的 nginx.conf 里有
#   include /www/server/panel/vhost/nginx/*.conf;
# （http 上下文）。若这份片段叫 .conf 会被当成独立配置再加载一次，而 proxy_set_header
# 在 http 上下文不合法，`nginx -t` 会直接失败。改名时请连着部署脚本一起改。
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
