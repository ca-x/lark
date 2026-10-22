# 客户端部署与端口指南 / Client deployment and ports

服务端 0.17.0+ 和桌面端 0.2.0+ 支持自动协商 Connect、gRPC-Web 和 gRPC。所有接口同端口，无需额外发布 50051。关闭「桌面客户端接口」会同时禁用三种协议，不影响网页。

## 端口与 Docker

| 地址/端口 | 用途 | 发布方式 |
| --- | --- | --- |
| 容器 TCP 8080 | 网页、API、全部桌面协议 | 容器内固定监听 |
| 宿主 TCP 8080，或自选 18080 | 转发到容器 8080 | Compose 的 `LARK_PORT` |
| 公网 HTTPS TCP 443 | 用户访问域名 | 直连反代开放；Tunnel 不需要路由器入站映射 |
| cloudflared 出站 TCP/UDP 7844 | 建立 Tunnel | 允许出站，不是入站端口映射 |

```sh
# LAN: host 18080 -> container 8080
LARK_PORT=18080 docker compose up -d

# Bind the published origin port to host loopback
LARK_BIND_IP=127.0.0.1 LARK_PORT=18080 docker compose up -d

# Inspect the resolved configuration
LARK_BIND_IP=127.0.0.1 LARK_PORT=18080 docker compose config
```

默认绑定 `0.0.0.0`，可通过宿主机 IP 访问。仅供宿主机反代使用时推荐绑定 `127.0.0.1`。Compose 的 `LARK_PORT` 是**宿主发布端口**，容器内监听保持 8080，不能一起改成 18080。直接运行服务端二进制时，`LARK_PORT` 则是程序监听端口。

局域网明文连接使用 `http://私有IP:18080`，桌面端显式勾选「允许局域网 HTTP」。仅允许 localhost、`.local`、回环或私有 IP。公网必须 HTTPS，自动协商不会跳过 TLS 校验或自动改用 HTTP。不要把 DLNA/SSDP 的发现端口发布到公网。

## Cloudflare Tunnel

宿主机运行 cloudflared，百灵通过 Docker 发布为本机 18080 时：

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /etc/cloudflared/YOUR_TUNNEL_UUID.json
ingress:
  - hostname: music.example.com
    service: http://127.0.0.1:18080
  - service: http_status:404
```

控制台管理的 Tunnel 添加等效的 Published application route 即可，无需重复配置 credentials file。不要将 Tunnel token 或 credentials JSON 提交到 Git。

cloudflared 在另一容器中时，`127.0.0.1` 指 cloudflared 自身。将二者放入同一 Docker network，使用 `http://lark:8080`。可以省略百灵的宿主机 `ports`，容器服务名始终使用容器端口 8080，而不是宿主端口 18080。

客户端填写 `https://music.example.com`，不要加 `/api` 或子路径。自动协商先进行无凭据探测，再发送一次登录请求。设置中显示实际协议；后续启动优先探测上次可用协议，手动检查连接可在传输失效后重新协商。公开主机名仍不支持原生 gRPC，但 Connect/gRPC-Web 不要求 WARP。需要原生 gRPC 时可选私网路由 + WARP。

Cloudflare Access/WAF 的浏览器登录页或挑战不能代替桌面认证；客户端没有 Access service-token 设置。为受信任设备配置合适的策略或使用 WARP 私网，并保留百灵账号认证。

## Caddy：支持全部协议

```caddyfile
music.example.com {
    reverse_proxy h2c://127.0.0.1:18080
}
```

域名直接到达 Caddy 才能使用原生 gRPC。如果外层仍是 Tunnel 公开主机名，自动选择 HTTP 兼容协议。

## Nginx：HTTP 兼容协议

在已经配置好 HTTPS 证书的 server 中添加：

```nginx
location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

此配置用于 Connect/gRPC-Web，不声称支持原生 gRPC。不要把整个 `/lark.desktop.v1.DesktopService/` 路径仅交给 `grpc_pass`，否则会阻断相同路径上的 Connect 请求。

## 故障排查

| 症状 | 检查 |
| --- | --- |
| Docker 改端口后无法访问 | `docker compose config` 中宿主端口、容器目标 8080 与容器内 `LARK_PORT=8080` |
| 网页可打开但桌面不通 | 升级两端版本、桌面接口开关、根地址、Access/WAF、代理 POST 和服务路径 |
| 登录成功但音频或定位失败 | 代理是否缓冲/截断流、媒体 Range、音频格式；不要只检查登录 |
| TLS 报错 | 域名、信任链、证书有效期、主机时间；不关闭证书校验 |
| gRPC-Web/gRPC 状态 | 正常的自动协商结果，无需用户手动选择 |

## English quick reference

- Use server 0.17.0+ and desktop 0.2.0+. Enter the web app's HTTPS **root URL**, without `/api` or a path prefix.
- The client probes Connect, gRPC-Web, then native gRPC without credentials and signs in once. Restored sessions prefer the last working protocol. TLS, authentication and protocol-version errors do not cause credential retries or an HTTP downgrade.
- Web, desktop and media streams share container port 8080. Compose `LARK_PORT=18080` publishes host 18080 to container 8080; `LARK_BIND_IP=127.0.0.1` binds that published port to host loopback. In a separate cloudflared container, use `http://lark:8080` on the same Docker network.
- A Tunnel public hostname uses the HTTP-compatible transport, without WARP or extra inbound ports. Native gRPC requires a suitable direct HTTP/2 reverse proxy or private networking with WARP. Interactive Cloudflare Access challenges are not supported by the desktop RPC client.
- Disable proxy response buffering for streaming. Verify playback and seeking, not just login. The supplied Nginx example is for Connect/gRPC-Web; Caddy's h2c upstream also supports native gRPC.

参考：[Cloudflare gRPC](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/grpc/)、[Tunnel firewall requirements](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)、[Connect Go](https://connectrpc.com/docs/go/getting-started/)。HTTP/1.1-only 回归测试不等同于已在用户的生产 Tunnel/Access 策略中验证。
