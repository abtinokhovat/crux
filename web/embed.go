// Package web holds the browser app. It is embedded in the crux binary.
package web

import "embed"

//go:embed index.html *.css *.js vendor
var FS embed.FS
