# crux share server — meeting notes and team review for ADRs.
#   docker build -t crux .
#   docker run -d -p 8080:8080 -v crux-data:/data \
#     -e CRUX_TOKENS="you:$(openssl rand -hex 24)" -e CRUX_PASSCODE="team-secret" \
#     -e CRUX_PUBLIC_URL="https://crux.example.com" crux
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /crux ./cmd/crux

FROM alpine:3.20
RUN adduser -D -H crux && mkdir -p /data && chown crux /data
COPY --from=build /crux /usr/local/bin/crux
USER crux
ENV PORT=8080 HOST=0.0.0.0 CRUX_DATA=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["crux", "server"]
