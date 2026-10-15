# 通过 Cloudflare Tunnel 连接桌面端

百灵音乐的桌面客户端使用 gRPC（HTTP/2）。服务端 gRPC 与网页共用地址和端口，默认开启；管理员可在「设置 → 服务与连接」中关闭。

截至 2026 年 10 月，Cloudflare 官方文档说明：**Cloudflare Tunnel 的公开主机名暂不支持 gRPC**。因此，使用 `cloudflared` 把网页发布为 `https://music.example.com` 后，网页可以打开，不代表桌面客户端能通过同一公开主机名连接。修改 `http2Origin` 也不能改变这项公开主机名限制。

## 通过 Cloudflare 私有网络连接

1. 在 Cloudflare Zero Trust 中创建或编辑 Tunnel，为百灵音乐服务器的私有 IP 或网段配置 private network route。
2. 在桌面设备安装并登录 Cloudflare One（WARP）客户端，按 Cloudflare 文档配置 Split Tunnels，使服务器私有 IP 走 WARP。
3. 确认桌面设备通过 WARP 能访问服务器，并在百灵音乐桌面端输入该私有地址及账号密码。客户端连接的是 gRPC 服务，不使用网页公开主机名。
4. 若使用纯 HTTP 私有地址，在首次连接界面显式启用「允许局域网 HTTP」。建议使用可信私网或为该地址配置 TLS。

Cloudflare 官方步骤：[gRPC over Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/grpc/)。

## 无需 WARP 的公网连接

使用支持 gRPC/HTTP/2 的反向代理。例如 Caddy 可以通过 h2c 连接百灵音乐服务端：

```caddyfile
music.example.com {
    reverse_proxy h2c://127.0.0.1:8080
}
```

将该域名直接指向 Caddy，并用 `https://music.example.com` 在桌面端登录。若域名仍经过 Cloudflare Tunnel 的公开主机名，限制依然存在。
