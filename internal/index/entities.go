package index

import (
	"path"
	"regexp"
	"sort"
	"strings"
)

// Candidate is a record type that looks like a domain entity: it is stored, or it lives where a
// project keeps its models. The score and reasons say why, so a person or an agent can judge it
// without opening the file.
type Candidate struct {
	Name   string   `json:"name"`
	Unit   string   `json:"unit"`
	File   string   `json:"file"`
	Line   int      `json:"line"`
	Table  string   `json:"table,omitempty"` // named by the code (TableName()), else ""
	Score  int      `json:"score"`
	Why    []string `json:"why"`
	Fields []Field  `json:"fields"`
}

// ormTags: a struct tag key that maps a field to storage.
var ormTags = []string{"gorm", "db", "bson", "sql", "orm", "xorm", "pg", "column", "dynamodbav", "firestore", "datastore", "ent", "table"}

var modelDirs = map[string]bool{"model": true, "models": true, "entity": true, "entities": true, "domain": true, "schema": true, "schemas": true,
	"aggregate": true, "aggregates": true, "record": true, "records": true, "dao": true, "po": true}

// notEntity: names that say a type carries a request, a setting or a behaviour, not a record.
var notEntity = regexp.MustCompile(`(Request|Response|Reply|Req|Resp|Config|Configuration|Options?|Params?|Args|Filter|Query|Command|Handler|Service|Client|Server|Endpoint|Middleware|Builder|Factory|Manager|Mock|Stub|Test|Error)$`)

// wireDirs: folders of request/response shapes, never entities.
var wireDirs = map[string]bool{"request": true, "requests": true, "response": true, "responses": true, "dto": true, "dtos": true,
	"payload": true, "payloads": true, "view": true, "views": true, "transport": true, "api": true}

var idField = regexp.MustCompile(`^(ID|Id|UUID|Uuid|Key)$`)

// Candidates scores the program's record types and returns the likely entities, best first.
func Candidates(p *Program) []Candidate {
	var out []Candidate
	for _, t := range p.Types {
		name := t.ID[strings.LastIndex(t.ID, ".")+1:]
		if notEntity.MatchString(name) || len(t.Fields) < 2 || inWireDir(t.File) {
			continue
		}
		var why []string
		score := 0
		tagged := map[string]bool{}
		hasID := false
		for _, f := range t.Fields {
			if idField.MatchString(f.Name) {
				hasID = true
			}
			if f.Embedded && strings.HasSuffix(f.Type, "gorm.Model") {
				score += 3
				why = append(why, "embeds gorm.Model")
			}
			if strings.HasSuffix(f.Type, "gorm.DeletedAt") {
				tagged["gorm.DeletedAt"] = true
			}
			for _, k := range ormTags {
				if strings.Contains(f.Tag, k+`:"`) {
					tagged[k] = true
				}
			}
		}
		if len(tagged) > 0 {
			score += 3
			var ks []string
			for k := range tagged {
				ks = append(ks, k)
			}
			sort.Strings(ks)
			why = append(why, "storage tags: "+strings.Join(ks, ", "))
		}
		if t.Table != "" {
			score += 3
			why = append(why, "TableName() = "+t.Table)
		}
		for _, seg := range strings.Split(path.Dir(t.File), "/") {
			if modelDirs[strings.ToLower(seg)] {
				score += 2
				why = append(why, "in a "+seg+" folder")
				break
			}
		}
		if hasID {
			score++
			why = append(why, "has an id")
		}
		if score < 3 {
			continue
		}
		fields := t.Fields
		if len(fields) > 40 {
			fields = fields[:40]
		}
		out = append(out, Candidate{Name: name, Unit: t.Unit, File: t.File, Line: t.Line, Table: t.Table, Score: score, Why: why, Fields: fields})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].File+out[i].Name < out[j].File+out[j].Name
	})
	return out
}

func inWireDir(file string) bool {
	for _, seg := range strings.Split(path.Dir(file), "/") {
		if wireDirs[strings.ToLower(seg)] {
			return true
		}
	}
	return false
}
