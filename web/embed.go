// Package web holds the browser app. It is embedded in the crux binary.
package web

import "embed"

//go:embed index.html app.css app.js util.js graph.js map.js search.js blueprint.js flow.js vendor
var FS embed.FS
