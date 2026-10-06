// Package skills holds the agent skills shipped with crux, for `crux skill install`.
package skills

import "embed"

//go:embed crux crux-adopt crux-design crux-model crux-build answer-me-with-html
var FS embed.FS
