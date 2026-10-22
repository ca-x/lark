module github.com/ca-x/lark/desktop

go 1.27.1

require (
	connectrpc.com/connect v1.19.1
	github.com/ca-x/lark/protocol v0.0.0
	github.com/egoist/mygo v0.6.2
	google.golang.org/grpc v1.84.0
	google.golang.org/protobuf v1.36.12
)

require (
	github.com/ebitengine/purego v0.11.1 // indirect
	github.com/hajimehoshi/go-mp3 v0.3.4 // indirect
	github.com/jfreymuth/oggvorbis v1.0.5 // indirect
	github.com/jfreymuth/vorbis v1.0.2 // indirect
	golang.org/x/net v0.59.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	golang.org/x/text v0.43.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260706201446-f0a921348800 // indirect
)

replace github.com/ca-x/lark/protocol => ../protocol

tool github.com/egoist/mygo/cmd/mygo
