# 通过 Cloudflare Tunnel 连接桌面端

适用于服务端 0.17.0+、桌面端 0.2.0+。新版桌面客户端自动协商 **Connect → gRPC-Web → gRPC**，所有协议与网页共用地址和端口，默认开启。管理员可在「设置 → 服务与连接 → 桌面客户端接口」中同时关闭三种协议。

Cloudflare Tunnel 公开主机名仍不支持**原生 gRPC**，但新版桌面端会选择 HTTP 兼容协议，**可以直接填写网页 HTTPS 根地址，无需 WARP 或额外的 gRPC 端口**。旧版桌面端需要升级。修改 `http2Origin` 不是必需条件，也不能让 Tunnel 的公开主机名支持原生 gRPC。

## 推荐：公开主机名 + 自动协商

1. 将 Tunnel 的公开主机名上游设为 `http://127.0.0.1:8080`；若宿主发布端口为 18080，则使用 `http://127.0.0.1:18080`。
2. 若 cloudflared 在另一容器中，加入同一 Docker network，上游使用 `http://lark:8080`，不要使用 `localhost` 或宿主发布端口访问服务名 `lark`。
3. 桌面端输入 `https://music.example.com`，不要附加 `/api` 或子路径，然后登录。连接设置显示实际协议。
4. 客户端仅对无凭据的 GetServerInfo 进行协议探测，登录只发送一次；密码错误、拒绝访问、服务关闭、证书错误和协议版本不匹配不会触发凭据重试或改用明文 HTTP。

Cloudflare Access 的交互式浏览器挑战不会自动在桌面 RPC 内完成；客户端没有内置 Access service-token 配置。需要按受信任设备调整 Access 策略或使用 WARP 私网，同时保留百灵账号认证。不要关闭 TLS 校验。

完整的 Docker 发布端口、Tunnel 配置、Caddy/Nginx 例子和故障排查见[客户端部署与端口指南](client-deployment.md)。

## 可选：通过 Cloudflare 私有网络使用原生 gRPC

1. 在 Cloudflare Zero Trust 中创建或编辑 Tunnel，为百灵音乐服务器的私有 IP 或网段配置 private network route。
2. 在桌面设备安装并登录 Cloudflare One（WARP）客户端，按 Cloudflare 文档配置 Split Tunnels，使服务器私有 IP 走 WARP。
3. 确认桌面设备通过 WARP 能访问服务器，并在百灵音乐桌面端输入该私有地址及账号密码，不使用网页公开主机名。客户端仍会自动协商协议；WARP 私网路由允许原生 gRPC，但不会强制客户端选择它，以连接设置显示的实际协议为准。
4. 若使用纯 HTTP 私有地址，在首次连接界面显式启用「允许局域网 HTTP」。建议使用可信私网或为该地址配置 TLS。

Cloudflare 官方步骤：[gRPC over Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/grpc/)。

## 可选：直接公网反向代理

使用支持 gRPC/HTTP/2 的反向代理。例如 Caddy 可以通过 h2c 连接百灵音乐服务端：

```caddyfile
music.example.com {
    reverse_proxy h2c://127.0.0.1:8080
}
```

将该域名直接指向 Caddy，并用 `https://music.example.com` 在桌面端登录。若域名仍经过 Cloudflare Tunnel 的公开主机名，限制依然存在。
