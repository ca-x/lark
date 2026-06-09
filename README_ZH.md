# 百灵音乐 / Lark Music

[English](README.md)

百灵是一个面向个人音乐库的自托管 Web 音乐播放器。它优先服务本地高清曲库，同时补上歌词、元信息修正、离线缓存、公开分享、在线电台、网络曲库和第三方客户端这些日常会用到的能力。

后端使用 Go + Echo v5 + Ent ORM，默认 SQLite。前端使用 React + TypeScript + Vite，生产构建会嵌入 Go 服务中，因此可以作为一个服务直接运行。

更新日志见 [CHANGELOG.md](CHANGELOG.md)。

## 致谢

感谢 [LinuxDo 社区](https://linux.do) 的讨论与反馈。

---

## 百灵能做什么

### 本地曲库与播放

- 扫描一个或多个本地音乐目录，上传音频文件，并按歌曲、专辑、歌手、歌单、文件夹和来源浏览曲库。
- 浏览器友好格式直接原样播放，包括 MP3、FLAC、WAV、M4A/AAC、OGG/Vorbis 和 OPUS。
- AIFF、APE、DSF、DFF、DST 等浏览器不一定能直放的格式也可以入库；直放不稳定时，可通过可选 `ffmpeg` 按需转码播放。
- 后端使用 HTTP Range 流式传输，浏览器拖动进度条和跳播更稳定。
- 元数据和内嵌封面使用 `github.com/dhowden/tag` 读取；可选 `ffprobe` 用于增强时长、采样率、位深和歌词识别。
- 支持 CUE 整轨专辑解析，并能跳过异常的非音频 CUE，避免坏 CUE 拦截真实音频文件。
- 自动归一部分异常歌手名，保存歌手首字母，并支持 A-Z / # 筛选。

### 曲库整理

- 歌曲、专辑、歌手和歌单列表都支持分页，适合较大的本地曲库。
- 专辑、歌手和歌单详情页支持一键播放。
- 专辑艺人筛选、歌手首字母筛选、文件夹浏览和来源标签页可以帮助整理不规则曲库。
- 收藏按用户独立保存，覆盖歌曲、专辑、歌手和电台。
- 歌单支持创建、添加歌曲和详情页播放。
- 智能歌单可以自动整理最近播放、最近入库、收藏、未播放、Hi-Res 和待补歌词的歌曲。
- 每日推荐会结合收藏、播放历史和当天种子生成。

### 播放历史与续播

- 播放历史页按收听事件展示时间线，支持日历和日期筛选，可以快速回到某一天的播放记录。
- 站点设置可以配置播放历史保留天数；设置为 `0` 时表示永久保留。
- 播放队列、来源上下文、续播位置和播放历史可以跨会话保留；播放历史也可以按设备隔离，跨设备继续收听会恢复保存的队列，而不是只剩最近一首。
- 曲库库存和播放行为保持分离：最近播放不会改变曲库“最新入库”的排序。

### 歌词与元信息

- 优先读取音频文件内嵌歌词；缺少内嵌歌词时，再自动匹配在线歌词。
- 自动匹配不准时，可以手动选择歌词候选。
- LRC 解析支持 offset 标签、一行多个时间戳、毫秒精度，以及同一时间戳下的原文/翻译分组。
- 歌词支持偏移调整；开启后，在线匹配或手动选择的歌词可以自动保存为同名 `.lrc` 文件。
- 单曲和专辑元信息编辑器支持在线候选、文件路径候选、手动输入、封面 URL 和上传封面。
- 支持把修正后的 Tag 和封面直接回写到源音频文件；写入前有确认流程，写入后会显示逐文件结果。
- 路径辅助元信息可以在扫描时修正坏 Tag；只有开启 Tag 回写时才会写回源文件。

### 播放体验

- 桌面首页播放样式包括黑胶唱机、磁带卡座、iPod、蓝调音箱、唱片封套、锤子唱机和复古唱机。
- 移动端播放样式包括精密音频、复古唱机、独立蓝调、iPod、柔光唱片、舞台玻璃、蓝色光环和锤子经典。
- 底部播放器提供播放队列、播放模式、音量、进度、收藏、定时关闭和全屏歌词入口。
- 定时关闭支持按时长、按播放首数，或当前专辑结束后停止。
- EQ 预设适用于本地音乐、网络曲库和电台播放。
- 可选界面音效会给播放、收藏和分享动作提供轻量反馈。
- 布局适配桌面侧栏、Pad 图标侧栏和手机底部导航。

### 离线、电台与网络曲库

- 歌曲可以准备为浏览器侧离线缓存，百灵会显示缓存状态和占用空间。
- 可以把听过的歌自动缓存到本机；断网或开启离线模式时优先播放缓存音频。
- 在线电台包括内置 cliamp 播放源、自定义播放列表来源、Radio Browser 热门/搜索和电台收藏。
- 网络曲库可以连接 Navidrome/Subsonic、Jellyfin 和 Plex，用于搜索和串流播放。
- 转码策略和默认码率可以按本地网络、移动流量或低性能设备调整。

### 分享与外部客户端

- 可以为歌曲、专辑、歌手或歌单创建公开播放链接，访问者不需要登录。
- 分享链接可以永久有效，也可以设置 1 小时、1 天、7 天或 30 天过期；用户可以管理自己创建的分享。
- 可选 Subsonic 兼容服务提供 `/rest/*.view` 接口，供 Subsonic/Navidrome 客户端连接，并使用单独的 Subsonic 账户。
- 百灵提供 MCP SSE 接口给 AI 客户端使用。可用工具包括列出歌手和专辑、搜索歌曲、查看收藏、切换收藏、获取歌词和准备播放 URL。
- 播放记录可以同步到 ListenBrainz 或 Last.fm，并支持配置提交阈值。

### 管理与个性化

- 首次启动可创建第一个管理员账号；管理员也可以开启注册。
- 设置项覆盖语言、主题、曲库路径、目录状态、目录监控、诊断开关、字体上传、歌词字体和转码策略。
- 支持简体中文和英文。中文界面显示 **百灵**，英文界面显示 **Lark**。
- 主题系统共 21 套：原创深色/浅色主题，Apple Music、Spotify、网易云、Winamp、Foobar2000 致敬深浅主题，以及锤子音乐经典主题。
- 上传的 Web 字体可以应用到整个界面，也可以只用于歌词。
- 健康信息会显示运行版本、提交、构建时间、Go 版本和媒体后端状态。

---

## 截图

<img width="1338" height="407" alt="百灵播放器主题" src="https://github.com/user-attachments/assets/5060aa84-964b-4ce8-a544-868d4dd87daa" />

<img width="2516" height="1371" alt="百灵曲库界面" src="https://github.com/user-attachments/assets/de8653f7-c166-4fc2-ae31-6f5bc4648646" />

<img width="2520" height="1370" alt="百灵专辑界面" src="https://github.com/user-attachments/assets/7bc38bbe-9003-436c-bd16-14d9e94be07c" />

---

## 技术概览

### 技术栈

- 后端：Go、Echo v5、Ent ORM
- 数据库：默认 SQLite（通过 `github.com/lib-x/entsqlite`），也可通过环境变量选择 PostgreSQL / MySQL
- 前端：React、TypeScript、Vite
- 音频元数据：`github.com/dhowden/tag` 读取，`go.senan.xyz/taglib` 回写 Tag/封面，内置 WAV INFO 写入器处理 WAV 文本字段
- 可选媒体工具：`ffprobe` 读取增强元数据，`ffmpeg` 处理兜底转码和离线准备
- 前端部署：构建产物通过 `go:embed` 嵌入 Go 服务
- 自动化：GitHub Actions 覆盖 CI、Release 二进制和 Docker 镜像发布

### 音频策略

百灵默认保持无 CGO 构建：

- `/api/songs/:id/stream?mode=raw` 使用 `http.ServeFile` 原样输出文件并保留 Range 请求。
- 前端默认使用 `mode=auto`，浏览器兼容格式直接播放。
- 浏览器不兼容格式可通过可选 `ffmpeg` 实时转码。
- 默认构建不引入 `go-astiav`/FFmpeg 绑定，因为它需要 CGO 和系统 `libav*` 开发包，会破坏当前多平台无 CGO 二进制发布链路。

---

## 本地开发

### 依赖

- Go 1.25+，推荐 1.26
- Node.js 22+
- pnpm 10+
- 可选：`ffmpeg` 和 `ffprobe`

### 后端

```bash
cd backend
go test ./...
go run ./cmd/server
```

常用环境变量：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LARK_PORT` | `8080` | HTTP 端口 |
| `LARK_DATA_DIR` | `./data` | 应用数据目录 |
| `LARK_LIBRARY_DIR` | `./data/music` | 曲库扫描/上传目录 |
| `LARK_DB_TYPE` | `sqlite` | 数据库类型：`sqlite` / `sqlite3`、`postgres` / `postgresql` 或 `mysql` / `mariadb` |
| `LARK_DB_DSN` | 空 | 数据库连接字符串。SQLite 留空时使用 `./data/lark.db`，也可以填写 `file:` DSN 或普通文件路径；PostgreSQL/MySQL 必填。 |
| `LARK_FRONTEND_ORIGIN` | `*` | CORS 来源 |
| `LARK_ADMIN_USERNAME` | 空 | 数据库暂无用户时，自动创建首个管理员 |
| `LARK_ADMIN_PASSWORD` | 空 | 首个管理员密码；必须和用户名一起设置 |
| `LARK_ADMIN_NICKNAME` | 空 | 自动创建管理员的可选昵称 |
| `FFMPEG_BIN` | `ffmpeg` | 可选转码工具 |
| `FFPROBE_BIN` | `ffprobe` | 可选元数据探测工具 |
| `LARK_CACHE_BACKEND` | `badger` | 缓存后端：`badger`、`redis`、`memory` 或 `none`。未设置时如果检测到 Redis 环境变量，会自动使用 Redis。 |
| `LARK_CACHE_TTL_SECONDS` | `120` | 曲库列表/查询响应的缓存 TTL |
| `LARK_CACHE_DIR` | `./data/cache/badger` | 使用内置 KV 后端时的 Badger 缓存目录 |
| `LARK_BADGER_CACHE_MB` | 空 | 内置 Badger 缓存内存预算的高级覆盖参数，单位 MB。留空时会按物理内存自动调整。 |
| `LARK_REDIS_URL` | 空 | 可选 Redis URL，例如 `redis://:password@redis:6379/0`，优先级高于地址/密码/DB 配置。 |
| `LARK_REDIS_ADDR` | 空 | Redis 地址。设置该环境变量且未显式指定缓存后端时，会启用 Redis；如果显式选择 Redis 但未配置地址，运行时回退到 `localhost:6379`。 |
| `LARK_REDIS_PASSWORD` | 空 | Redis 密码 |
| `LARK_REDIS_DB` | 空 | Redis 数据库编号；启用 Redis 后运行时默认 `0` |
| `LARK_REDIS_KEY_PREFIX` | 空 | Redis 中百灵缓存 key 的前缀；启用 Redis 后运行时默认 `lark:cache:` |
| `LARK_SQLITE_MAX_OPEN_CONNS` | `4` | SQLite 连接池大小。低内存设备（例如 NAS、Raspberry Pi）可降到 `2`。 |
| `LARK_SQLITE_MAX_IDLE_CONNS` | `4` | SQLite 保留的空闲连接数，建议与 `LARK_SQLITE_MAX_OPEN_CONNS` 保持一致。 |

发布构建会通过 Go `-ldflags` 注入 `lark/backend/pkg/version` 的版本、提交和构建时间；Web 设置页会从 `/api/health` 显示当前运行版本。

### 前端

```bash
cd frontend
pnpm install
pnpm dev
```

如果要以生产嵌入方式启动：

```bash
cd frontend
pnpm build   # writes embedded assets to ../backend/web/dist
cd ../backend
go run ./cmd/server
```

---

## Docker

```bash
docker compose up -d
```

如果要首次运行时无人值守创建管理员，可以在第一次启动前传入：

```bash
LARK_ADMIN_USERNAME=admin \
LARK_ADMIN_PASSWORD='change-me-now' \
LARK_ADMIN_NICKNAME='百灵管理员' \
docker compose up -d
```

默认 compose 会把应用数据和上传音乐保存在 `lark_data` volume 中。如果你的运行环境已经把音乐目录暴露到了容器内部，请把 `LARK_LIBRARY_DIR` 设置成这个容器内路径；否则保持默认 `/app/data/music`，通过应用数据 volume 使用上传/扫描。发布的 Docker 镜像已经内置 `ffmpeg`/`ffprobe`，默认转码和元数据探测不需要在 compose 里额外配置路径。递归扫描只会跳过名为 `.shared-center` 的平台辅助目录，然后继续扫描同级其他目录；不会改写你配置的曲库根路径。

```bash
LARK_LIBRARY_DIR=/lzcapp/run/mnt/home docker compose up -d
```

默认使用 SQLite。百灵会自动应用调优后的 DSN；只有需要修改数据库文件位置时才需要设置 `LARK_DB_DSN`：

```bash
LARK_DB_DSN=/app/data/lark.db docker compose up -d
```

### 推荐 SQLite 配置

百灵默认 DSN 会启用 WAL 模式、外键和内存映射 I/O。连接池默认 4 个连接，通常足够支撑 9000+ FLAC 曲库。低内存设备（例如 Raspberry Pi 或 1 GB RAM 以内的 NAS）可以调低连接池：

```bash
LARK_SQLITE_MAX_OPEN_CONNS=2
LARK_SQLITE_MAX_IDLE_CONNS=2
LARK_DB_DSN='file:/app/data/lark.db?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)&_pragma=cache_size(-8000)&_pragma=temp_store(MEMORY)&_pragma=mmap_size(134217728)'
```

普通 SQLite 路径会自动扩展为带这些 pragma 的 DSN：

| Pragma | 值 | 作用 |
| --- | --- | --- |
| `foreign_keys` | `1` | 启用引用完整性 |
| `journal_mode` | `WAL` | 支持并发读取 + 单写入，并保持崩溃安全 |
| `synchronous` | `NORMAL` | 在 WAL 下兼顾耐久性和速度，比 FULL 更快 |
| `busy_timeout` | `5000` | 写入竞争超过 5 秒后快速失败 |
| `cache_size` | `-20000` | 每个连接约 20 MB 共享页缓存 |
| `temp_store` | `MEMORY` | 临时表放在内存中 |
| `mmap_size` | `268435456` | 256 MB 读取内存映射 I/O |

如果你在自定义 `LARK_DB_DSN` 中写了 `?` 参数，百灵会原样使用，不再追加默认参数。这适合需要按特定负载细调的部署。

如需使用其他数据库，请同时设置 `LARK_DB_TYPE` 和 `LARK_DB_DSN`：

```bash
LARK_DB_TYPE=postgres \
LARK_DB_DSN='postgres://lark:secret@postgres:5432/lark?sslmode=disable' \
docker compose up -d

LARK_DB_TYPE=mysql \
LARK_DB_DSN='lark:secret@tcp(mysql:3306)/lark?parseTime=true&charset=utf8mb4&loc=Local' \
docker compose up -d
```

### 缓存后端

默认情况下百灵使用内置 Badger KV 缓存，数据位于 `LARK_CACHE_DIR`，不需要任何外部服务。Badger 内存会按物理内存自动调整，`LARK_BADGER_CACHE_MB` 只是给受限设备或超大库准备的高级覆盖参数。只有当你显式配置 Redis 相关环境变量，或设置 `LARK_CACHE_BACKEND=redis` 时，才会启用 Redis。

使用外部 Redis：

```bash
LARK_REDIS_URL='redis://:password@redis.example.com:6379/0' docker compose up -d
# 或
LARK_REDIS_ADDR='redis.example.com:6379' \
LARK_REDIS_PASSWORD='password' \
LARK_REDIS_DB=0 \
docker compose up -d
```

启动 `docker-compose.yml` 中附带的可选 Redis 服务：

```bash
LARK_REDIS_ADDR=redis:6379 docker compose --profile redis up -d
```

如果没有设置任何 `LARK_REDIS_*` 变量，compose 只会启动百灵服务，并继续使用内置 Badger KV 缓存。

然后访问：

```text
http://localhost:8080
```

---

## GitHub Actions

- `.github/workflows/ci.yml`：安装前端依赖，执行前端 lint/build，同步嵌入产物，校验 Go modules，运行 `go test` 和 `go vet`，构建后端服务，并验证 Docker 镜像构建。
- `.github/workflows/binary.yml`：推送 `v*` tag 时生成 Linux、macOS、Windows Release 草稿附件；也支持手动构建 artifact。
- `.github/workflows/docker.yml`：发布多架构 Docker 镜像到 GHCR；如果配置了 Docker Hub secrets，也会发布到 Docker Hub。

Docker Hub 发布需要配置：

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

GHCR 发布使用仓库自带的 `GITHUB_TOKEN`。

---

## 致谢与声明

- 锤子音乐经典主题参考并致谢 [DE105/SmartisanMusic-Revived](https://github.com/DE105/SmartisanMusic-Revived)。其中引用的 Smartisan Music 视觉资产、商标、产品名和界面设计归各自权利人所有，本项目仅用于学习、研究与保存目的。
- 歌词匹配与本地元信息处理思路参考 [guohuiyuan/go-music-dl](https://github.com/guohuiyuan/go-music-dl)。百灵的源文件元信息回写流程为独立实现。
