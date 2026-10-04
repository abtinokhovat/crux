package share

import (
	"bytes"
	"embed"
	"html/template"
	"net/http"
)

//go:embed assets
var assets embed.FS

var tmpl = template.Must(template.ParseFS(assets, "assets/*.html"))

type pageOpts struct {
	Slug                       string
	NeedPass, Landing, Missing bool
}

// page writes the page teammates open: /i/<slug>. Notes mode and review mode share it.
func page(w http.ResponseWriter, o pageOpts) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	body, script := "review.html", "review.js"
	switch {
	case o.Landing:
		body, script = "landing.html", ""
	case o.Missing:
		body, script = "missing.html", ""
	case o.NeedPass:
		body, script = "gate.html", "gate.js"
	}
	var inner bytes.Buffer
	_ = tmpl.ExecuteTemplate(&inner, body, o)
	_ = tmpl.ExecuteTemplate(w, "page.html", map[string]any{"Body": template.HTML(inner.String()), "Script": script})
}
