---
crux: convention
id: errors
applies_to: [services/**]
summary: wrap errors with context; map to gRPC codes at the edge only
---
# Errors

- Wrap with `fmt.Errorf("create order: %w", err)`; never log and return.
- Domain errors are typed (`ErrOutOfStock`); the gRPC layer maps them to codes.
- HTTP handlers return problem+json.
