package web

import "embed"

// DistFS contains built frontend assets.
//go:embed all:dist
var DistFS embed.FS
