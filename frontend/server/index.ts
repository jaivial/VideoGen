import { createServer } from 'http'
import { parse } from 'url'
import { createReadStream } from 'fs'
import { join, extname } from 'path'
import httpProxy from 'http-proxy'
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT || 3000
const API_TARGET = process.env.API_TARGET || 'http://localhost:8080'
const WS_TARGET = process.env.WS_TARGET || 'ws://localhost:8080'

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
}

const DIST_DIR = join(process.cwd(), 'dist')
const IS_DEV = process.env.NODE_ENV !== 'production'

// Create HTTP proxy
const httpProxyServer = httpProxy.createProxyServer({
  target: API_TARGET,
  changeOrigin: true,
})

// Handle proxy errors
httpProxyServer.on('error', (err, req, res) => {
  console.error('Proxy error:', err)
  if (!res.writableEnded) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Bad gateway')
  }
})

async function startServer() {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    const pathname = parsedUrl.pathname

    // Handle API proxy
    if (pathname?.startsWith('/api')) {
      httpProxyServer.web(req, res)
      return
    }

    // Skip WebSocket upgrade handling here (handled below)
    if (pathname?.startsWith('/ws')) {
      return
    }

    if (IS_DEV) {
      // In dev mode, redirect to Vite dev server
      res.writeHead(302, { Location: 'http://localhost:5173' + (pathname || '/') })
      res.end()
      return
    }

    // Serve static files from dist
    let filePath = join(DIST_DIR, pathname || '/index.html')

    // Handle client-side routing - serve index.html for non-file paths
    const ext = extname(filePath)
    if (!ext) {
      filePath = join(DIST_DIR, 'index.html')
    }

    try {
      const stream = createReadStream(filePath)
      const contentType = MIME_TYPES[extname(filePath)] || 'application/octet-stream'

      res.writeHead(200, { 'Content-Type': contentType })
      stream.pipe(res)
    } catch (err) {
      // Fallback to index.html for SPA routing
      try {
        const indexPath = join(DIST_DIR, 'index.html')
        const stream = createReadStream(indexPath)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        stream.pipe(res)
      } catch (e) {
        res.writeHead(404)
        res.end('Not found')
      }
    }
  })

  // Handle WebSocket upgrades
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const pathname = parse(req.url || '/', true).pathname

    if (pathname?.startsWith('/ws')) {
      // Create WebSocket connection to backend
      const target = WS_TARGET + req.url

      const ws = new (WebSocket as any)(target, {
        headers: req.headers,
      })

      ws.on('open', () => {
        console.log('WS proxy connected to:', target)
      })

      ws.on('message', (data: Buffer) => {
        socket.write(data)
      })

      ws.on('close', () => {
        socket.destroy()
      })

      ws.on('error', (err: Error) => {
        console.error('WebSocket error:', err)
        socket.destroy()
      })

      socket.on('close', () => {
        ws.close()
      })

      socket.on('error', (err) => {
        console.error('Socket error:', err)
        ws.close()
      })
    } else {
      socket.destroy()
    }
  })

  server.listen(PORT, () => {
    console.log(`
============================================
  Server running at http://localhost:${PORT}
  - SSR enabled
  - API proxy: ${API_TARGET}
  - WebSocket proxy: ${WS_TARGET}
============================================
    `)
  })
}

startServer().catch(console.error)
