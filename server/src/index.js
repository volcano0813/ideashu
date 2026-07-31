import { createService } from './service.js'

const host = '127.0.0.1'
const port = Number(process.env.IDEASHU_PORT || 3210)
const service = createService()
const server = service.app.listen(port, host, () => {
  console.error(`[ideashu] running at http://${host}:${port}`)
})

function shutdown() {
  server.close(() => {
    service.db.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
