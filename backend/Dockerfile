FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
WORKDIR /build/backend
RUN apk add --no-cache git ca-certificates
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend /build/backend/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -trimpath \
    -ldflags="-s -w \
      -X 'lark/backend/pkg/version.Version=${VERSION}' \
      -X 'lark/backend/pkg/version.GitCommit=${GIT_COMMIT}' \
      -X 'lark/backend/pkg/version.BuildTime=${BUILD_TIME}'" \
    -o /out/lark-server ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata ffmpeg
WORKDIR /app
COPY --from=build /out/lark-server /usr/local/bin/lark-server
RUN mkdir -p /app/data/music
ENV LARK_PORT=8080 \
    LARK_DATA_DIR=/app/data \
    LARK_LIBRARY_DIR=/app/data/music \
    LARK_DB_TYPE=sqlite \
    LARK_DB_DSN= \
    LARK_BADGER_CACHE_MB= \
    LARK_FRONTEND_ORIGIN='*' \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    FFPROBE_BIN=/usr/bin/ffprobe
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["/usr/local/bin/lark-server"]
