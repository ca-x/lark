# 百灵音乐 / Lark Music

[English](README.md)

百灵是一个面向个人高清曲库的自托管 Web 音乐播放器。后端使用 Go + Echo v5 + Ent ORM，默认 SQLite，前端使用 React/Vite，生产构建会嵌入到 Go 服务中统一启动。

---

## 用户可以做什么

### 播放本地高清音乐

- 在「曲库」页面扫描本地音乐目录。
- 在「曲库」页面上传单首音频。
- 后端使用 HTTP Range 流式传输，浏览器拖动进度条和跳播更稳定。
- 浏览器友好格式直接原样播放：MP3、FLAC、WAV、M4A/AAC、OGG/Vorbis、OPUS。
- AIFF、APE、DSF、DFF、DST 等较少见高清格式可以入库；浏览器不能稳定直放时，安装可选 `ffmpeg` 后可实时转码为 MP3 流。
- 元数据和封面优先使用纯 Go `github.com/dhowden/tag` 读取；可选 `ffprobe` 用于增强时长、采样率、位深和更多内嵌歌词标签识别。

### 管理专辑、歌单和播放队列

- 浏览全部歌曲、歌手、专辑和歌单。
- 点击歌手、专辑或歌单会进入独立详情页，不再跳回整张曲库列表。
- 点击歌曲歌手或专辑歌手会进入歌手页，展示音乐库中该歌手的全部歌曲。
- 歌手、专辑和歌单详情页支持一键全部播放。
- 支持收藏歌曲和专辑。
- 支持创建歌单并把歌曲加入歌单。
- 底部播放控制区可打开当前播放列表。
- 曲库里支持把单首歌曲插入为下一首，也支持多选后批量插入为下一批播放。
- 底部播放控制区支持顺序播放、随机播放、单曲循环。

### 歌词和播放体验

- 优先读取音频文件中的内嵌歌词。
- 如果没有内嵌歌词，会自动按歌曲名和艺人从配置的在线渠道匹配；界面不暴露渠道名称、链接、ID 或手动粘贴入口。
- 点击底部播放控制区的专辑封面/黑胶封面即可切换全屏歌词。
- LRC 解析支持 offset 标签、一行多个时间戳、毫秒精度，以及同一时间戳的原文/翻译分组，自动滚动会定位到正确的播放行。
- 定时关闭是底部播放器里的临时选项，只影响当前播放会话，不作为系统设置持久化。

### 个性化界面

- 支持简体中文和英文。中文界面显示 **百灵**，英文界面显示 **Lark**。
- 主题按你提供的播放器方案实现：五套深色主题（深空极夜、琥珀胶片、霓虹珊瑚、冰川极光、碳黑燃绿）和五套浅色主题（奶白陶瓷、燕麦拿铁、薄荷苏打、樱花宣纸、黄昏琥珀）。
- 主题选择只放在「设置」页，保持主界面简洁。
- 每套主题都会同步调整播放器配色、封面处理、进度/音量样式和动效语言。
- 支持桌面端、Pad 和移动端自适应布局：桌面侧栏、Pad 图标侧栏、手机底部导航。

---

## 技术概览

### 技术栈

- 后端：Go、Echo v5、Ent ORM
- 数据库：默认 SQLite（通过 `github.com/lib-x/entsqlite`），也可通过环境变量选择 PostgreSQL / MySQL
- 前端：React、TypeScript、Vite
- 音频元数据：`github.com/dhowden/tag`
- 可选媒体工具：`ffprobe` 读取增强元数据，`ffmpeg` 处理兜底转码
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

默认 compose 会把应用数据和上传音乐保存在 `lark_data` volume 中。如果你的运行环境已经把音乐目录暴露到了容器内部，请把 `LARK_LIBRARY_DIR` 设置成这个容器内路径；否则保持默认 `/app/data/music`，通过应用数据 volume 使用上传/扫描。发布的 Docker 镜像已经内置 `ffmpeg`/`ffprobe`，默认转码和元数据探测不需要在 compose 里额外配置路径。 递归扫描只会跳过名为 `.shared-center` 的平台辅助目录，然后继续扫描同级其他目录；不会改写你配置的曲库根路径。

```bash
LARK_LIBRARY_DIR=/lzcapp/run/mnt/home docker compose up -d
```

默认使用 SQLite。如需自定义 SQLite 文件位置，请设置 `LARK_DB_DSN`：

```bash
LARK_DB_TYPE=sqlite \
LARK_DB_DSN='file:/app/data/lark.db?cache=shared&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(10000)&_pragma=cache_size(-10000)&_pragma=temp_store(FILE)&_pragma=mmap_size(0)' \
docker compose up -d
```

SQLite 也支持直接写普通路径，例如 `LARK_DB_DSN=/app/data/lark.db`；百灵会自动扩展为上面带调优参数的 `file:` DSN。

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
