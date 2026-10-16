package scan

import (
	"os"
	"path"
	"regexp"
	"strings"

	"github.com/abtinokhovat/crux/internal/catalog"
	"github.com/abtinokhovat/crux/internal/config"
	"gopkg.in/yaml.v3"
)

var (
	composeName = regexp.MustCompile(`^(docker-)?compose(\.[\w-]+)?\.ya?ml$`)
	tfResource  = regexp.MustCompile(`^\s*resource\s+"(\w+)"\s+"([\w-]+)"`)
	tfTech      = map[string]string{
		"aws_db_instance": "postgres", "aws_rds_cluster": "postgres", "aws_elasticache_cluster": "redis", "aws_elasticache_replication_group": "redis",
		"aws_sqs_queue": "sqs", "aws_sns_topic": "sns", "aws_msk_cluster": "kafka", "aws_s3_bucket": "s3", "aws_dynamodb_table": "dynamodb",
		"aws_lambda_function": "lambda", "aws_opensearch_domain": "opensearch", "aws_kinesis_stream": "kinesis", "aws_api_gateway_rest_api": "apigateway",
		"google_sql_database_instance": "postgres", "google_pubsub_topic": "pubsub", "google_storage_bucket": "gcs", "google_redis_instance": "redis", "google_cloud_run_service": "cloudrun", "google_cloud_run_v2_service": "cloudrun",
		"azurerm_postgresql_flexible_server": "postgres", "azurerm_redis_cache": "redis", "azurerm_servicebus_queue": "azure",
		"cloudflare_r2_bucket": "r2", "cloudflare_worker_script": "workers",
	}
	k8sKinds = map[string]string{"Deployment": "service", "StatefulSet": "service", "DaemonSet": "service", "CronJob": "job", "Job": "job"}
)

// kindOfTech: which element kind a technology suggests for a piece of infrastructure.
func kindOfTech(cat *catalog.Catalog, id string) string {
	t := cat.Tech[id]
	if t == nil {
		return "infra"
	}
	switch t.Category {
	case "store", "kv", "search", "blob":
		return "store"
	case "cache":
		return "cache"
	case "broker", "workflow":
		return "broker"
	case "gateway":
		return "gateway"
	}
	return "infra"
}

func infraAdapter(cfg *config.Config, cat *catalog.Catalog, files []string, f *Facts) {
	for _, p := range files {
		base := path.Base(p)
		dir := path.Dir(p)
		low := strings.ToLower(base)
		switch {
		case composeName.MatchString(low):
			composeFile(cfg, cat, p, f)
		case base == "Dockerfile" || strings.HasPrefix(base, "Dockerfile.") || strings.HasSuffix(base, ".Dockerfile"):
			name := path.Base(dir)
			if dir == "." {
				name = path.Base(cfg.Root)
			}
			f.Services = append(f.Services, Candidate{Name: name, Dir: dir, Kind: "service", Evidence: []string{p}})
		case strings.HasSuffix(low, ".tf"):
			b, err := os.ReadFile(cfg.Abs(p))
			if err != nil {
				continue
			}
			for _, line := range strings.Split(string(b), "\n") {
				if m := tfResource.FindStringSubmatch(line); m != nil {
					if id, ok := tfTech[m[1]]; ok {
						f.Infra = append(f.Infra, Infra{Name: m[2], Tech: id, Kind: kindOfTech(cat, id), File: p})
						f.Tech = append(f.Tech, TechHit{ID: id, Via: m[1], Dir: dir, Evidence: p})
					}
				}
			}
		case (strings.HasSuffix(low, ".yaml") || strings.HasSuffix(low, ".yml")) && !strings.Contains(p, "/templates/"):
			k8sFile(cfg, cat, p, f)
		}
	}
}

func composeFile(cfg *config.Config, cat *catalog.Catalog, p string, f *Facts) {
	b, err := os.ReadFile(cfg.Abs(p))
	if err != nil {
		return
	}
	var doc struct {
		Services map[string]struct {
			Image string `yaml:"image"`
			Build any    `yaml:"build"`
		} `yaml:"services"`
	}
	if yaml.Unmarshal(b, &doc) != nil {
		return
	}
	dirs := map[string]string{}
	defer func() {
		var root yaml.Node
		if yaml.Unmarshal(b, &root) == nil && len(root.Content) > 0 {
			composeWiring(p, root.Content[0], dirs, f)
		}
	}()
	for name, s := range doc.Services {
		if s.Build != nil {
			ctx, dockerfile := "", ""
			switch x := s.Build.(type) {
			case string:
				ctx = x
			case map[string]any:
				ctx, _ = x["context"].(string)
				dockerfile, _ = x["dockerfile"].(string)
			}
			d := path.Clean(path.Join(path.Dir(p), ctx))
			if dockerfile != "" && path.Dir(dockerfile) != "." {
				d = path.Clean(path.Join(d, path.Dir(dockerfile)))
			}
			dirs[name] = d
			f.Services = append(f.Services, Candidate{Name: name, Dir: d, Kind: "service", Evidence: []string{p + " services." + name}})
			continue
		}
		if s.Image == "" {
			continue
		}
		ids := cat.DetectImage(s.Image)
		in := Infra{Name: name, Image: s.Image, Kind: "infra", File: p}
		if len(ids) > 0 {
			in.Tech, in.Kind = ids[0], kindOfTech(cat, ids[0])
			f.Tech = append(f.Tech, TechHit{ID: ids[0], Via: s.Image, Dir: path.Dir(p), Evidence: p})
		}
		f.Infra = append(f.Infra, in)
	}
}

func k8sFile(cfg *config.Config, cat *catalog.Catalog, p string, f *Facts) {
	b, err := os.ReadFile(cfg.Abs(p))
	if err != nil || !strings.Contains(string(b), "kind:") || !strings.Contains(string(b), "apiVersion:") {
		return
	}
	// wiring: env, labels, Service selectors, Ingress rules
	labels := map[string]map[string]string{}
	ndec := yaml.NewDecoder(strings.NewReader(string(b)))
	for {
		var n yaml.Node
		if err := ndec.Decode(&n); err != nil {
			break
		}
		if len(n.Content) == 0 {
			continue
		}
		doc := n.Content[0]
		kind, name := "", ""
		if k := mapGet(doc, "kind"); k != nil {
			kind = k.Value
		}
		if m := mapGet(mapGet(doc, "metadata"), "name"); m != nil {
			name = m.Value
		}
		if _, ok := k8sKinds[kind]; (ok || kind == "Service" || kind == "Ingress") && name != "" {
			if l := k8sWiring(p, kind, name, doc, f); len(l) > 0 {
				labels[name] = l
			}
		}
	}
	dec := yaml.NewDecoder(strings.NewReader(string(b)))
	for {
		var doc map[string]any
		if err := dec.Decode(&doc); err != nil {
			break
		}
		kind, _ := doc["kind"].(string)
		meta, _ := doc["metadata"].(map[string]any)
		name, _ := meta["name"].(string)
		ck, ok := k8sKinds[kind]
		if !ok || name == "" {
			continue
		}
		var images []string
		var walk func(v any)
		walk = func(v any) {
			switch x := v.(type) {
			case map[string]any:
				if img, ok := x["image"].(string); ok {
					images = append(images, img)
				}
				for _, y := range x {
					walk(y)
				}
			case []any:
				for _, y := range x {
					walk(y)
				}
			}
		}
		walk(doc["spec"])
		isInfra := false
		for _, img := range images {
			if ids := cat.DetectImage(img); len(ids) > 0 {
				f.Infra = append(f.Infra, Infra{Name: name, Image: img, Tech: ids[0], Kind: kindOfTech(cat, ids[0]), File: p, Labels: labels[name]})
				f.Tech = append(f.Tech, TechHit{ID: ids[0], Via: img, Dir: path.Dir(p), Evidence: p})
				isInfra = true
			}
		}
		if !isInfra {
			f.Services = append(f.Services, Candidate{Name: name, Dir: path.Dir(p), Kind: ck, Evidence: []string{p + " " + kind + "/" + name}, Labels: labels[name]})
		}
	}
}
