package jsruntime

import (
	"context"
	"testing"
)

// TestAwaitProbe_CanceledLeftoverDoesNotLeakIntoNextCall 复现并防止歌曲串号
// （songloft-org/songloft#286）：
//
// 慢速插件解析(歌曲 A)在客户端切歌/重试时被 ctx 取消，ExecuteJS 提前返回，但 A 的
// Promise 仍存活于 VM。下一次解析(歌曲 B)复用同一组 await-probe 全局变量；A 的 Promise
// 在 B 的事件循环里 settle 时，其遗留 .then 会抢先写入全局结果——旧实现会让 B 读到 A 的值。
//
// 加 generation 守卫后，A 的遗留 .then 因 gen 已过期而作废，B 只读到自己的值。
// 本测试用纯 JS(Promise + setTimeout)复现该时序，无需真实插件/HTTP。
func TestAwaitProbe_CanceledLeftoverDoesNotLeakIntoNextCall(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-await-gen-leak"
	if err := manager.CreateEnv(envID, polyfillJS, int64(1)); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	// 调用 1（歌曲 A）：返回一个由 __r1 控制、迟迟不 settle 的 Promise，
	// 用极短超时把它逼进 wall-clock timeout —— 模拟被取消，留下挂在 __p1 上的遗留 .then。
	call1 := `globalThis.__p1 = new Promise(function(res){ globalThis.__r1 = res; }); globalThis.__p1`
	if _, err := manager.ExecuteJS(context.Background(), envID, call1, 30); err == nil {
		t.Fatal("调用 1 预期因超时返回错误（模拟被取消），却成功了")
	}

	// 调用 2（歌曲 B）：
	//   - 5ms 先 settle 遗留的 __p1（写入 "STALE"）——旧实现会把它串写进本次结果；
	//   - 200ms 才 settle 本次自己的 Promise（"FRESH"）。
	// 事件循环 ~50ms 的 tick 会在 __p1 到期、而本次 Promise 尚未到期的迭代里推进 __p1，
	// 从而在旧实现下确定性地读到 "STALE"。加守卫后应读到 "FRESH"。
	call2 := `globalThis.__p2 = new Promise(function(resolve){
		setTimeout(function(){ if (globalThis.__r1) { globalThis.__r1("STALE"); } }, 5);
		setTimeout(function(){ resolve("FRESH"); }, 200);
	}); globalThis.__p2`

	res, err := manager.ExecuteJS(context.Background(), envID, call2, 3000)
	if err != nil {
		t.Fatalf("调用 2 失败: %v", err)
	}
	if res.Result != "FRESH" {
		t.Fatalf("调用 2 被上一次(被取消)解析的遗留结果串写：期望 %q，得到 %q", "FRESH", res.Result)
	}
}
