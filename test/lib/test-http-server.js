var fs = require('fs')
var http = require('http')
var path = require('path')
var url = require('url')

var tempDir = 'temp'
  , killCmd = 'halt'

function onServerListening() {
  var port = this.address().port
  console.log("LISTENING ON", port)
}

function onServerError(err) {
  if (err.code === 'EADDRINUSE') {
    console.warn('Port', this.address().port, 'in use; trying another...')
    this.close()
    this.listen(0).once('listening', onServerListening)
      .once('error', onServerError)
  }
  else {
    console.error(err.message, '- exiting.')
    process.exit(1)
  }
}

http.createServer(function(req, res) {

  // Have not seen error ECONNRESET from this server like have seen from the
  // tcp server; but just in case, let's have an error handler
  res.on('error', function(err) {
    console.error('While responding:', err.message)
  })

  var q = url.parse(decodeURI(req.url), true).query
  if ('asset' in q) {
    var fpath = path.join('test', tempDir, q.asset)
    fs.createReadStream(fpath)
      .once('error', function(err) {
        res.statusCode = 500
        res.end('Server Error:' + err.message)
      })
      .once('open', function() {
        res.statusCode = 200
        this.pipe(res)
      })
  }
  else if (killCmd in q) {
    res.setHeader('Connection', 'close')
    res.end('Goodbye.')
    this.close()
  }
  else {
    res.writeHead(404);
    res.end('This is not the page you are looking for.')
  }
}).listen(0).once('listening', onServerListening)
  .once('error', onServerError)
  .once('close', function() {
    console.log("'close' event; trying to exit now...")
    process.exit()
  })

