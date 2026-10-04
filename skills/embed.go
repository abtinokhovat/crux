// Package skills holds the agent skills shipped with crux, for `crux skill install`.
package skills

import "embed"

//go:embed crux answer-me-with-html
var FS embed.FS
