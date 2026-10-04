package adr

import "testing"

func TestOptionsTable(t *testing.T) {
	tb := ParseTable("| Option | Pros | Cons | Verdict |\n|---|---|---|---|\n| A — Kafka | Replay. | Ops. | ok |\n| B — Rabbit | Easy. | No replay. | no |")
	o := OptionsFromTable(tb)
	if len(o) != 2 || *o[0].Key != "A" || o[0].Name != "Kafka" || o[0].Verdict.Kind != "ok" || o[1].Verdict.Kind != "no" {
		t.Fatalf("unexpected options: %+v", o)
	}
	if o[0].Fields[0].Role != "pro" || o[0].Fields[1].Role != "con" {
		t.Fatalf("roles: %+v", o[0].Fields)
	}
}

func TestFrontmatterTolerant(t *testing.T) {
	meta, body, _ := SplitFrontmatter("---\ntitle: A: b\ntags: [x, y]\n---\nbody")
	if Str(meta["title"]) != "A: b" || len(AsList(meta["tags"])) != 2 || body != "body" {
		t.Fatalf("got %v %q", meta, body)
	}
}

func TestPanelsSkipFencedHeadings(t *testing.T) {
	_, ps := Panels("## Decision\n```callout ok Decision\nUse X.\n```\n## Code\n```md\n## not a panel\n```\n")
	if len(ps) != 2 || ps[0].ID != "A" || ps[1].Title != "Code" {
		t.Fatalf("panels: %+v", ps)
	}
	f := ExtractFacts(ps)
	if f.Decision == nil || *f.Decision != "Use X." {
		t.Fatalf("decision: %v", f.Decision)
	}
}

func TestStatusKey(t *testing.T) {
	for in, want := range map[string]string{"In review": "review", "Superseded by 0004": "superseded", "": "proposed", "Accepted": "accepted"} {
		if got := StatusKey(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}
