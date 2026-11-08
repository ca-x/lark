# MyGo 市场逐项检查（2026-11-08）

## 先找到入口

1. 管理员进入「设置 → 插件管理」，开启「启用mygo插件」。
2. 在「已安装」启用对应插件，再点击卡片上的「打开音乐源」。
3. 也可以进入「曲库 → 音乐源」，在下拉框选择插件；登录按钮在音乐源页面内。

v0.18.14 新增卡片直达入口与未启用原因说明；有 home 导出的源会自动加载首页。安装不会自动启用。没有流媒体浏览能力的插件不生成音乐源页面。

## 范围与边界

- 市场快照：GitHub 查询 `topic:mygo-music-plugin archived:false`，50 个仓库，无搜索截断；检查发生于 2026-11-07 UTC / 2026-11-08 UTC+8。
- 在独立空数据实例中逐项尝试，37 个原始包完成安装和启用，13 个因原生能力或包体积限制被拒绝；没有修改实际用户的数据，没有重写第三方插件代码或降低宿主安全限制。
- 首轮使用市场仓库预览；批量请求触发 GitHub 匿名 API 限额后，通过已认证下载取得作者原始包，再走同一上传预览、确认安装和启用路径。表格给出固定 release/commit，上传后的界面结果不是市场限额已解除的证明。
- 37 个可安装包逐一在真实浏览器中打开并切换，检查来源选择、页面内容或明确的登录/配置错误、控件及横向溢出。无 home 的插件检查搜索/导航，不假造首页内容。桌面、手机、总开关关闭、默认停用、非首个源直达与首页自动加载另有浏览器回归。
- 对 17 个取得公开搜索结果的源，以首条非 unavailable 曲目做歌词与音频 Range 抽样：4 个返回 206 与 1024 字节音频响应，其余为登录、试听/歌曲/地区权限或上游不可用。音频响应不等于所有曲目、解码格式或持续播放均兼容。
- 没有扫描二维码、授权个人账号或填写私人服务器凭据；未验证收藏/歌单的真实账号写入，也未替用户开通会员。首次批量探测中缺少 page 的 browse 调用不计为插件不兼容，实际页面检查使用合法导航。
- 不同作者可能使用相同插件 ID，不能同时安装；测试仅在隔离实例中显式移除旧包再安装另一来源，不静默覆盖用户插件。安装成功不代表所有方法均可用，原生窗口登录、进程执行、远程播放与私网访问仍不支持。

## v0.18.15 登录后播放补测

以下 50 仓库表格保留为 v0.18.14 的历史快照，不表示全部功能或真实账号播放均通过。此前网易云未授权个人账号，未覆盖登录后返回公共 CDN 的路径。

用户反馈后，对照 MyGo `Plugin.Stream` / `HeadersFor` / 播放器实现，确认 Lark 错把插件 API 网络权限用于 `music.126.net` 等音频 CDN，修复前原始 v0.1.3、v0.1.6 ZIP 在模拟登录后均复现 `media host is outside network permission`。修复后两个原包的登录、账号隔离与两类曲目 ID 的 CDN 地址/头部断言通过；`fetch`/任意图片代理权限、私网校验和跨源凭据剥离保持不变。

真实浏览器另用模拟源和有效 WAV 验证账号持续显示、查询失败不误报退出、音频 HTTP 错误停止缓冲，以及底部播放按钮重试后重新请求并推进播放进度。上述不等于真实扫码授权或私人云盘全流程测试；未新增原插件没有导出的云盘浏览入口。

## 逐项结果

“首页内容可见”仅表示匿名页面可加载；“需要配置/登录”表示入口可用且错误明确，不表示私人服务或完整登录已测试。二维码提示只验证生成和展示，不表示扫码授权成功。

| 仓库 | 固定版本/commit | 安装结果 | 浏览器入口/首页 | 登录探测 | 首条曲目音频抽样 |
| --- | --- | --- | --- | --- | --- |
| `djyde/mygo-lizhi` | `87b97fd99a8453c56af5a768ce48a3454305f869` | 安装启用成功 | 首页内容可见 | 无登录导出 | 未抽样 |
| `egoist/mygo-music-youtube-music` | `eb4e42abc22e5fbd04df691aa0633cdaa1ad7a63` | 需要原生进程 | — | — | — |
| `GentleM4dman/mygo-music-bilibili` | `efa2d00dced597c54853a82e6e45db100cf1b2a5` | 需要原生进程 | — | — | — |
| `sogud/mygo-music-netease` | `v0.1.6` | 安装启用成功 | 首页内容可见 | 二维码提示 | 上游未提供音频 |
| `hubandad/mygo-music-netease` | `v1.0.0` | 安装启用成功 | 首页内容可见 | 二维码提示 | 账号/歌曲权限限制 |
| `AkinoKaede/mygo-music-netease-cloud-music` | `v0.1.11` | 安装启用成功 | 首页内容可见 | 二维码提示 | 上游未提供音频 |
| `xingkaixin/mygo-music-spotify` | `573e98e54c0231b3d62b2dffc6bec895a98dcbd8` | 需要原生/远程播放 | — | — | — |
| `bitbyte404/mygo-music-kugou-lite` | `ec1a51f6f563dcf774c89c0c1633a16f119153f7` | 安装启用成功 | 上游网络超时 | 二维码提示 | 需登录 |
| `DaviRain-Su/mygo-music-qishui` | `v0.4.5` | 需要原生进程 | — | — | — |
| `SixWa12138/mygo-music-netease-music` | `v0.4.0` | 安装启用成功 | 首页内容可见 | 二维码提示 | 上游未提供音频 |
| `r0k1s-i/mygotify` | `b3ae3da88c9497f96c2568704ecc059b8db8472b` | 需要原生进程 | — | — | — |
| `Amamiya23/mygo-music-qq-plugin` | `e341a3b03c5da68397ce02e0994367c1a16b3a7e` | 安装启用成功 | 首页内容可见 | 二维码提示 | 未抽样 |
| `benhaotang/mygo-music-Ampache` | `6d7ff882d8ceff896272317b7002ffa14493fdef` | 安装启用成功 | 需要服务器/账号配置 | 需配置或未取得提示 | 未抽样 |
| `KirishimaRin/mygo-music-netease-cloud-music` | `v0.1.5` | 安装启用成功 | 首页内容可见 | 需配置或未取得提示 | 未抽样 |
| `popeyelau/mygo-queyue` | `11d0964442b4e8886ef4fcf03626ebb9ebec880b` | 安装启用成功 | 首页内容可见 | 二维码提示 | 未抽样 |
| `LYJW131/mygo-music-apple-music` | `v0.1.0` | 需要原生进程 | — | — | — |
| `shensl4499/mygo-music-xiaoyuzhou` | `045cff05f0d418362eaffe9bd3fdb4ad193950be` | 安装启用成功 | 首页内容可见 | 二维码提示 | 未抽样 |
| `yusgsysh/mygo-music-fnos-plugin` | `v1.1.2` | 安装启用成功 | 需要服务器/账号配置 | 需配置或未取得提示 | 未抽样 |
| `yunforge/mygo-music-download` | `v0.2.0` | 安装启用成功 | 搜索/导航可见 | 无登录导出 | 206 / 1024 字节 |
| `biaobiaobiao108/mygo-yun-music` | `68b898377d32a3ac9c71d142b378f01222b93536` | 安装启用成功 | 需要服务器/账号配置 | 需配置或未取得提示 | 未抽样 |
| `InkCitrus/mygo-music-apple-music` | `afc54a0c72a447c7875c5d3d12faf6dbf4ffd2b3` | 需要原生/远程播放 | — | — | — |
| `lane128/mygo-music-qishui` | `v1.0.7` | 解压体积超限 | — | — | — |
| `Arteiimis/mygo-music-netease` | `7c15ed9294999c530d45173951e8204d2e467902` | 安装启用成功 | 首页内容可见 | 二维码提示 | 上游未提供音频 |
| `louisgreen0726/mygo-music-pocket-casts` | `v0.1.2` | 需要原生进程 | — | — | — |
| `TexasOct/mygo-subsonic` | `v0.1.5` | 安装启用成功 | 需要服务器/账号配置 | 文本提示 | 未抽样 |
| `satyawikananda/soundgo` | `3a5b3e6bd2f6e5bb833be1f1a658a4e4095fc7fe` | 需要原生进程 | — | — | — |
| `dddaniel1/mygo-plugin-kugou` | `v0.1.0` | 安装启用成功 | 首页内容可见 | 二维码提示 | 未抽样 |
| `hx23840/mygo-apple-music` | `v0.3.3` | 需要原生/远程播放 | — | — | — |
| `liuxiaofengone/synology-DSAudio-mygo-music-plugin` | `v0.1.1` | 安装启用成功 | 需要登录 | 需配置或未取得提示 | 未抽样 |
| `jfeng018/mygo-music-lx-source` | `v0.2.2` | 安装启用成功 | 首页内容可见 | 文本提示 | 上游未提供音频 |
| `specialhua/mygo-ximalaya` | `5084fa6ed17ff2b698fb7ccd554d028c6630bc1c` | 安装启用成功 | 首页内容可见 | 文本提示 | 206 / 1024 字节 |
| `nimrc/mygo-chensheng` | `042976866e7abef834987638ac7b40916dab1c2a` | 安装启用成功 | 首页内容可见 | 无登录导出 | 未抽样 |
| `MaYunFei/mygo-music-feiniu` | `8b821cdad563c5a637922d5d556c70c20bdb4032` | 安装启用成功 | 需要登录 | 需配置或未取得提示 | 未抽样 |
| `rocona/mygo-navidrome` | `0.1.0` | 安装启用成功 | 需要服务器/账号配置 | 需配置或未取得提示 | 未抽样 |
| `TengYangTuoHai/mygo-music-navidrome` | `aeafff6bfa86d906c99241722c81f984409bd8a4` | 安装启用成功 | 需要服务器/账号配置 | 需配置或未取得提示 | 未抽样 |
| `craigary/mygo-music-kugou-lite` | `29c2ee6258f84c37178ac6d7228e3679d67c5938` | 安装启用成功 | 首页内容可见 | 需配置或未取得提示 | 上游未提供音频 |
| `hiSlowMo/neteaseXqqmusic` | `v0.1.1` | 安装启用成功 | 首页内容可见 | 二维码提示 | 账号/歌曲权限限制 |
| `amqsy/mygo-music-bodian` | `01462ff122211d23b655f2f39eac4836d2c38e4e` | 安装启用成功 | 首页内容可见 | 二维码提示 | 上游未提供音频 |
| `Jimmyzzt/mygo-music-incompetech` | `56e9a1257d3ed28738a9de1cb08b3c82e0f55e4a` | 安装启用成功 | 首页内容可见 | 无登录导出 | 未抽样 |
| `dddaniel1/mygo-plugin-qqmusic` | `v0.2.4` | 安装启用成功 | 首页内容可见 | 原生登录不支持 | 206 / 1024 字节 |
| `AsperaUlt/mygo-netease` | `v1.0.14` | 安装启用成功 | 首页内容可见 | 二维码提示 | 账号/歌曲权限限制 |
| `YeeYeung/mygo-music-overcast` | `5ee48fd2214ace960b424a947984fccab201c81a` | 安装启用成功 | 首页内容可见 | 文本提示 | 未抽样 |
| `AdkinsHan/mygo-local-lyrics` | `v1.1.1` | 需要原生进程 | — | — | — |
| `bxb100/mygo-music-navidrome-plugin` | `268880159142414871451f73859863e04b0c1f26` | 需要原生进程 | — | — | — |
| `Guyu23/mygo-music-qqmusic` | `a4145c5363117bacbdd79cd2998d66f77fe38ee0` | 安装启用成功 | 需要登录 | 二维码提示 | 上游未提供音频 |
| `Lorpaves/mygo-music-qqmusic` | `v0.3.2` | 安装启用成功 | 首页内容可见 | 文本提示 | 需登录 |
| `pingfury108/mygo-music-sonust` | `v0.1.0` | 安装启用成功 | 需要服务器/账号配置 | 无登录导出 | 未抽样 |
| `LANMIN-X/mygo-plugin-ximalaya` | `v0.1.5` | 安装启用成功 | 首页内容可见 | 二维码提示 | 206 / 1024 字节 |
| `Guyu23/mygo-music-qishui` | `dd4b334c5ce95d84c65747f0381ad3b93f2a37fb` | 安装启用成功 | 需要登录 | 二维码提示 | 未抽样 |
| `fcmfcm1999/mygo-music-kugou` | `v1.0.0` | 安装启用成功 | 首页内容可见 | 需配置或未取得提示 | 未抽样 |

## 本次修复与回归

- 安装卡片直接打开选定源，明确区分生态总开关、单插件状态和界面能力；两种开关都不会自动打开。
- 音乐源首次进入/切换自动加载其 home，避免只有操作栏却没有内容。
- ZIP 采用唯一最浅层清单，兼容根清单与 dist/test fixture 共存；QQ 仓库包已重新安装并打开，Apple Music 包继续因原生/远程播放限制被拒绝。
- 保留同层歧义、重复条目、危险路径、原生能力及体积上限拒绝测试。运行 `go test ./...`、`go vet ./...`、`go mod verify`、插件/API race、真实 NetEase/Li Zhi fixture 回归，以及前端 build/lint、`test:mygo`、`test:plugin-workspace` 和 `test:settings`。

第三方接口和包版本会变化。本记录是上述快照的检查结果，不是对后续版本、付费曲目或所有市场插件的兼容保证；不随仓库再分发第三方包、账号信息或扫码凭据。

