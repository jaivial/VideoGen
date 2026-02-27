# Build stage
FROM golang:1 AS builder

WORKDIR /app

# Install dependencies (Debian-based golang image uses apt)
RUN apt-get update && apt-get install -y --no-install-recommends gcc musl-dev && rm -rf /var/lib/apt/lists/*

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build
RUN CGO_ENABLED=1 GOOS=linux go build -o /video-generator

# Runtime stage
FROM alpine:3.20

RUN apk add --no-cache ffmpeg yt-dlp ca-certificates nodejs npm

WORKDIR /app

COPY --from=builder /video-generator .

# Copy and install Node.js dependencies
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --production; else npm install --production; fi

EXPOSE 8080

CMD ["./video-generator"]
